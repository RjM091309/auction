/**
 * CRUD for the Bidder Registration page (admin tab).
 *
 * Layered on top of the existing `members` table. Each row also carries a
 * `password` (defaults to the row id when not provided), used for future
 * bidder-side login.
 */

import crypto from 'node:crypto';
import {
  appendBidderAuditLog,
  buildBidderEditDetails,
  loadBidderAuditLog,
} from './bidderAuditLog.js';

/** Constant-time string comparison to avoid timing-based password leaks. */
function timingSafeEqualStr(a, b) {
  const A = Buffer.from(String(a ?? ''), 'utf8');
  const B = Buffer.from(String(b ?? ''), 'utf8');
  if (A.length !== B.length) {
    // Burn the same work so attackers can't distinguish length mismatch
    // from value mismatch via timing.
    crypto.timingSafeEqual(A, A);
    return false;
  }
  return crypto.timingSafeEqual(A, B);
}

function clientError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

/* --------------------------------------------------------------------------
 * Bidder-tab auth sessions (in-memory, server-process-scoped).
 *
 * The Bidder Registration page is gated behind a lightweight login: users
 * pick an IGN with role Officer/Admin/Developer and enter the password from
 * the `members` table. On success the server hands out a random token that
 * the client sends in `Authorization: Bearer <token>` on subsequent calls.
 *
 * Sessions live in process memory only — restarts force re-login, which is
 * fine for an internal admin tool.
 * ----------------------------------------------------------------------- */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const actorSessions = new Map();

function pruneSessions() {
  const now = Date.now();
  for (const [token, sess] of actorSessions.entries()) {
    if (sess.expiresAt <= now) actorSessions.delete(token);
  }
}

function generateSessionToken() {
  return crypto.randomBytes(24).toString('base64url');
}

const PRIVILEGED_ROLES = new Set(['Officer', 'Admin', 'Developer']);
const DELETE_ROLES = new Set(['Admin', 'Developer']);

/**
 * Role hierarchy. An actor can only edit a row whose role rank is strictly
 * lower than their own.
 *   Developer > Admin > Officer > Member
 */
const ROLE_RANK = { Member: 1, Officer: 2, Admin: 3, Developer: 4 };

/**
 * Can `actorRole` edit a row whose role is `targetRole`?
 *   - Developer rows: never (protected even from other Developers).
 *   - Admin rows:     only Developer.
 *   - Otherwise:      actor rank must be >= target rank (peers may edit peers).
 */
function canEditRow(actorRole, targetRole) {
  if (targetRole === 'Developer') return false;
  if (targetRole === 'Admin') return actorRole === 'Developer';
  return (ROLE_RANK[actorRole] ?? 0) >= (ROLE_RANK[targetRole] ?? 0);
}

/**
 * Can an actor assign `assignedRole` to a row? Actors can assign any role at
 * or below their own rank:
 *   Officer   → Member, Officer
 *   Admin     → Member, Officer, Admin
 *   Developer → Member, Officer, Admin, Developer
 */
function canAssignRole(actorRole, assignedRole) {
  return (ROLE_RANK[actorRole] ?? 0) >= (ROLE_RANK[assignedRole] ?? 0);
}

function sanitizeName(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim();
}

function sanitizeRole(raw) {
  if (raw === 'Developer') return 'Developer';
  if (raw === 'Admin') return 'Admin';
  if (raw === 'Officer' || raw === 'Leader') return 'Officer';
  return 'Member';
}

function sanitizePassword(raw) {
  if (raw == null) return '';
  return String(raw).trim();
}

function coerceId(raw) {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = parseInt(raw.trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function sanitizeApprovalStatus(raw) {
  if (raw === 'pending') return 'pending';
  if (raw === 'rejected') return 'rejected';
  return 'approved';
}

function rowToBidder(row) {
  let role = 'Member';
  if (row.role === 'Officer') role = 'Officer';
  else if (row.role === 'Developer') role = 'Developer';
  else if (row.role === 'Admin') role = 'Admin';
  return {
    id: Number(row.id),
    name: String(row.name ?? ''),
    role,
    password: String(row.password ?? ''),
    active: Number(row.active) === 1,
    approvalStatus: sanitizeApprovalStatus(row.approval_status ?? row.approvalStatus),
  };
}

/* --------------------------------------------------------------------------
 * Brute-force throttle for the auth endpoint.
 *
 * Tracks failed-attempt counts per key (IP and/or IGN). After
 * MAX_FAILS_BEFORE_LOCKOUT, the key is locked out for LOCKOUT_MS. Successful
 * authentication clears the counter. Memory-only and bounded by login rate.
 * ----------------------------------------------------------------------- */
const MAX_FAILS_BEFORE_LOCKOUT = 5;
const LOCKOUT_MS = 5 * 60 * 1000;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const authFailures = new Map();

function pruneAuthFailures(now = Date.now()) {
  for (const [key, info] of authFailures.entries()) {
    if (info.lockedUntil && info.lockedUntil > now) continue;
    if (info.firstFailAt && now - info.firstFailAt > FAIL_WINDOW_MS) {
      authFailures.delete(key);
    }
  }
}

function checkAuthRateLimit(key) {
  if (!key) return;
  const info = authFailures.get(key);
  if (!info) return;
  const now = Date.now();
  if (info.lockedUntil && info.lockedUntil > now) {
    const remainingSec = Math.ceil((info.lockedUntil - now) / 1000);
    throw clientError(
      429,
      `Too many failed attempts. Try again in ${remainingSec}s.`
    );
  }
}

function recordAuthFailure(key) {
  if (!key) return;
  const now = Date.now();
  const info = authFailures.get(key) ?? { fails: 0, firstFailAt: now, lockedUntil: 0 };
  if (now - info.firstFailAt > FAIL_WINDOW_MS) {
    info.fails = 0;
    info.firstFailAt = now;
    info.lockedUntil = 0;
  }
  info.fails += 1;
  if (info.fails >= MAX_FAILS_BEFORE_LOCKOUT) {
    info.lockedUntil = now + LOCKOUT_MS;
  }
  authFailures.set(key, info);
}

function clearAuthFailure(key) {
  if (key) authFailures.delete(key);
}

/**
 * Authenticate a bidder for access to the registration page. Only members
 * with a privileged role (Officer/Admin/Developer) may sign in.
 *
 * `meta.ip` is optional — when present, failed attempts are tracked per-IP
 * AND per-IGN so a malicious actor can't grind through one account from one
 * IP, or one IP through every account.
 */
export async function authBidder(pool, body, meta = {}) {
  pruneAuthFailures();
  const name = sanitizeName(body?.name);
  const password = sanitizePassword(body?.password);
  const ipKey = meta.ip ? `ip:${meta.ip}` : null;
  const nameKey = name ? `name:${name.toLowerCase()}` : null;
  checkAuthRateLimit(ipKey);
  checkAuthRateLimit(nameKey);
  if (!name) throw clientError(400, 'Name is required');
  if (!password) throw clientError(400, 'Password is required');

  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE name = ? LIMIT 1`,
    [name]
  );
  const recordFail = () => {
    recordAuthFailure(ipKey);
    recordAuthFailure(nameKey);
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    recordFail();
    throw clientError(401, 'Invalid credentials');
  }
  const row = rows[0];
  if (row.approval_status === 'pending') {
    recordFail();
    throw clientError(403, 'Your registration is still pending admin approval.');
  }
  if (row.approval_status === 'rejected') {
    recordFail();
    throw clientError(403, 'Your registration was rejected by an admin.');
  }
  if (Number(row.active) !== 1) {
    recordFail();
    throw clientError(403, 'This account is inactive');
  }
  if (!timingSafeEqualStr(row.password ?? '', password)) {
    recordFail();
    throw clientError(401, 'Invalid credentials');
  }
  if (!PRIVILEGED_ROLES.has(row.role)) {
    recordFail();
    throw clientError(403, 'You do not have access to the Bidders page');
  }

  clearAuthFailure(ipKey);
  clearAuthFailure(nameKey);
  pruneSessions();
  const token = generateSessionToken();
  const actor = {
    id: Number(row.id),
    name: String(row.name),
    role: row.role,
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  actorSessions.set(token, actor);
  return {
    token,
    actor: { id: actor.id, name: actor.name, role: actor.role },
  };
}

/** Resolve a bearer token to the actor cached at sign-in time. Does NOT
 * verify the actor's current DB state — use `getFreshActor` for that on any
 * protected request. */
export function resolveActor(token) {
  if (!token || typeof token !== 'string') return null;
  pruneSessions();
  const sess = actorSessions.get(token);
  if (!sess) return null;
  if (sess.expiresAt <= Date.now()) {
    actorSessions.delete(token);
    return null;
  }
  return { id: sess.id, name: sess.name, role: sess.role };
}

/**
 * Resolve a bearer token and re-validate the actor against the live DB row.
 *
 * Closes off two privilege-escalation holes:
 *   1. **Stale role** — if an Admin was demoted to Member while their token
 *      is still alive, the cached role would otherwise let them keep Admin
 *      powers for up to 8h.
 *   2. **Disabled accounts** — if a user is set `active=0` or deleted, their
 *      session is immediately invalidated.
 */
export async function getFreshActor(pool, token) {
  const cached = resolveActor(token);
  if (!cached) return null;
  const [rows] = await pool.query(
    `SELECT id, name, role, active FROM members WHERE id = ? LIMIT 1`,
    [cached.id]
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    actorSessions.delete(token);
    return null;
  }
  const row = rows[0];
  if (Number(row.active) !== 1 || !PRIVILEGED_ROLES.has(row.role)) {
    actorSessions.delete(token);
    return null;
  }
  // Refresh the cached session so subsequent sync `resolveActor` callers see
  // the latest name/role (e.g. after a rename or promotion).
  const sess = actorSessions.get(token);
  if (sess) {
    sess.name = String(row.name);
    sess.role = row.role;
  }
  return {
    id: Number(row.id),
    name: String(row.name),
    role: row.role,
  };
}

export function signOutActor(token) {
  if (token) actorSessions.delete(token);
}

/**
 * Invalidate every active session for a given member id. Call this whenever a
 * privileged user is demoted, deactivated, or deleted so they cannot continue
 * using an existing token.
 */
export function invalidateSessionsForMember(memberId) {
  if (!memberId) return;
  for (const [token, sess] of actorSessions.entries()) {
    if (sess.id === memberId) actorSessions.delete(token);
  }
}

/**
 * Verify a member's credentials WITHOUT minting a session. Used by the
 * self-service "Join queue" flow on the auction list where any active member
 * (regardless of role) should be able to prove their identity before being
 * added to a queue. Rate-limited identically to `authBidder` to prevent
 * brute-force attacks.
 *
 * Returns `{ id, name, role }` on success. Throws `clientError` on failure so
 * the caller can forward the status code straight to the HTTP response.
 */
export async function verifyMemberCredentials(pool, body, meta = {}) {
  pruneAuthFailures();
  const name = sanitizeName(body?.name);
  const password = sanitizePassword(body?.password);
  const ipKey = meta.ip ? `ip:${meta.ip}` : null;
  const nameKey = name ? `name:${name.toLowerCase()}` : null;
  checkAuthRateLimit(ipKey);
  checkAuthRateLimit(nameKey);
  if (!name) throw clientError(400, 'Name is required');
  if (!password) throw clientError(400, 'Password is required');

  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE name = ? LIMIT 1`,
    [name]
  );
  const recordFail = () => {
    recordAuthFailure(ipKey);
    recordAuthFailure(nameKey);
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    recordFail();
    throw clientError(401, 'Invalid IGN or password');
  }
  const row = rows[0];
  if (row.approval_status === 'pending') {
    recordFail();
    throw clientError(403, 'Your registration is still pending admin approval.');
  }
  if (row.approval_status === 'rejected') {
    recordFail();
    throw clientError(403, 'Your registration was rejected by an admin.');
  }
  if (Number(row.active) !== 1) {
    recordFail();
    throw clientError(403, 'This account is inactive');
  }
  if (!timingSafeEqualStr(row.password ?? '', password)) {
    recordFail();
    throw clientError(401, 'Invalid IGN or password');
  }
  clearAuthFailure(ipKey);
  clearAuthFailure(nameKey);
  return {
    id: Number(row.id),
    name: String(row.name),
    role: row.role,
  };
}

/**
 * List every active member (any role) for the auction self-service "Join
 * queue" dropdown. Returns `{ id, name, role }` so the UI can show role
 * badges next to each IGN.
 */
export async function listActiveMembers(pool) {
  const [rows] = await pool.query(
    `SELECT id, name, role FROM members
     WHERE active = 1
     ORDER BY FIELD(role, 'Developer', 'Admin', 'Officer', 'Member'), name ASC`
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    role: r.role,
  }));
}

/**
 * List members eligible to sign in on the Bidders page (active rows whose
 * role grants access). Used to populate the IGN dropdown on the gate.
 */
export async function listEligibleActors(pool) {
  const [rows] = await pool.query(
    `SELECT id, name, role FROM members
     WHERE active = 1 AND role IN ('Officer', 'Admin', 'Developer')
     ORDER BY FIELD(role, 'Developer', 'Admin', 'Officer'), name ASC`
  );
  return (Array.isArray(rows) ? rows : []).map((r) => ({
    id: Number(r.id),
    name: String(r.name),
    role: r.role,
  }));
}

function requireActor(actor) {
  if (!actor) throw clientError(401, 'You must sign in to perform this action');
}

function requireEditPermission(actor) {
  requireActor(actor);
  if (!PRIVILEGED_ROLES.has(actor.role)) {
    throw clientError(403, 'You do not have permission to edit bidders');
  }
}

function requireDeletePermission(actor) {
  requireActor(actor);
  if (!DELETE_ROLES.has(actor.role)) {
    throw clientError(403, 'Only Admin or Developer can delete bidders');
  }
}

/**
 * Strip the password from a bidder row unless the viewer is allowed to edit
 * that row. This prevents an Officer (or anyone else) from reading a higher-
 * ranked user's password via the API even though the UI masks it visually.
 */
function redactPasswordForActor(bidder, actor) {
  if (!actor) return { ...bidder, password: '' };
  if (canEditRow(actor.role, bidder.role)) return bidder;
  return { ...bidder, password: '' };
}

export async function listBidders(pool, actor) {
  requireActor(actor);
  // Pending registrations are surfaced via the dedicated `listPendingBidders`
  // call, so the main Bidders table only shows approved + rejected rows.
  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status
     FROM members
     WHERE approval_status <> 'pending'
     ORDER BY active DESC, name ASC`
  );
  return (Array.isArray(rows) ? rows : [])
    .map(rowToBidder)
    .map((b) => redactPasswordForActor(b, actor));
}

/**
 * List every bidder whose public registration is awaiting approval. Returns
 * the same shape as `listBidders` so the admin UI can reuse the row renderer.
 */
export async function listPendingBidders(pool, actor) {
  requireEditPermission(actor);
  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status
     FROM members
     WHERE approval_status = 'pending'
     ORDER BY id ASC`
  );
  return (Array.isArray(rows) ? rows : [])
    .map(rowToBidder)
    .map((b) => redactPasswordForActor(b, actor));
}

/**
 * Approve a pending registration: marks `approval_status='approved'` and
 * reactivates the row (`active=1`) so it shows up in active-member queries
 * and the user can sign in / be bid on their behalf.
 */
export async function approvePendingBidder(pool, idRaw, actor) {
  requireEditPermission(actor);
  const id = coerceId(idRaw);
  if (id == null) throw clientError(400, 'Invalid bidder id');

  const [existing] = await pool.query(
    `SELECT id, name, role, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(existing) || existing.length === 0) {
    throw clientError(404, 'Bidder not found');
  }
  const pending = existing[0];
  if (pending.approval_status !== 'pending') {
    throw clientError(409, 'This registration is no longer pending');
  }
  // Only roles the actor could otherwise create count here. Public
  // registrations are always `Member`, so this never trips for non-priv
  // actors. Still belt-and-suspenders for forged ENUM values.
  if (!canEditRow(actor.role, pending.role)) {
    throw clientError(403, `You are not allowed to approve ${pending.role} bidders`);
  }

  await pool.query(
    `UPDATE members SET approval_status = 'approved', active = 1 WHERE id = ?`,
    [id]
  );
  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  const bidder = redactPasswordForActor(rowToBidder(rows[0]), actor);
  await appendBidderAuditLog(pool, {
    action: 'approve',
    actor,
    targetMemberId: id,
    targetName: String(pending.name ?? bidder.name),
    targetRole: pending.role,
    details: { approvalStatus: 'approved' },
  });
  return bidder;
}

/**
 * Reject a pending registration: marks `approval_status='rejected'` and
 * forces `active=0`. The row is kept (not hard-deleted) so the IGN stays
 * reserved and the audit trail is preserved; an admin can still hard-delete
 * via the existing Delete action if they want to free the IGN.
 */
export async function rejectPendingBidder(pool, idRaw, actor) {
  requireEditPermission(actor);
  const id = coerceId(idRaw);
  if (id == null) throw clientError(400, 'Invalid bidder id');

  const [existing] = await pool.query(
    `SELECT id, name, role, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(existing) || existing.length === 0) {
    throw clientError(404, 'Bidder not found');
  }
  const pending = existing[0];
  if (pending.approval_status !== 'pending') {
    throw clientError(409, 'This registration is no longer pending');
  }
  if (!canEditRow(actor.role, pending.role)) {
    throw clientError(403, `You are not allowed to reject ${pending.role} bidders`);
  }

  await pool.query(
    `UPDATE members SET approval_status = 'rejected', active = 0 WHERE id = ?`,
    [id]
  );
  invalidateSessionsForMember(id);
  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  const bidder = redactPasswordForActor(rowToBidder(rows[0]), actor);
  await appendBidderAuditLog(pool, {
    action: 'reject',
    actor,
    targetMemberId: id,
    targetName: String(pending.name ?? bidder.name),
    targetRole: pending.role,
    details: { approvalStatus: 'rejected' },
  });
  return bidder;
}

export async function createBidder(pool, body, actor) {
  requireEditPermission(actor);
  const name = sanitizeName(body?.name);
  if (!name) throw clientError(400, 'Name is required');
  const role = sanitizeRole(body?.role);
  if (!canAssignRole(actor.role, role)) {
    throw clientError(403, `You are not allowed to assign the ${role} role`);
  }
  const rawPassword = sanitizePassword(body?.password);
  if (!rawPassword) throw clientError(400, 'Password is required');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.query(
      `INSERT INTO members (name, role, password, active) VALUES (?, ?, ?, 1)`,
      [name, role, rawPassword]
    );
    const id = Number(ins.insertId);
    await conn.commit();
    const [rows] = await conn.query(
      `SELECT id, name, role, password, active, approval_status FROM members WHERE id = ? LIMIT 1`,
      [id]
    );
    const bidder = redactPasswordForActor(rowToBidder(rows[0]), actor);
    await appendBidderAuditLog(conn, {
      action: 'create',
      actor,
      targetMemberId: id,
      targetName: bidder.name,
      targetRole: bidder.role,
      details: { role: bidder.role, approvalStatus: bidder.approvalStatus },
    });
    return bidder;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateBidder(pool, idRaw, body, actor) {
  requireEditPermission(actor);
  const id = coerceId(idRaw);
  if (id == null) throw clientError(400, 'Invalid bidder id');

  const [existing] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!Array.isArray(existing) || existing.length === 0) {
    throw clientError(404, 'Bidder not found');
  }
  const before = rowToBidder(existing[0]);
  const targetRole = before.role;
  const isDeveloper = targetRole === 'Developer';
  if (!canEditRow(actor.role, targetRole)) {
    if (isDeveloper) {
      throw clientError(403, 'Developer accounts are protected and cannot be modified');
    }
    if (targetRole === 'Admin') {
      throw clientError(403, 'Only Developer can edit Admin bidders');
    }
    throw clientError(403, `You are not allowed to edit ${targetRole} bidders`);
  }

  const sets = [];
  const args = [];
  if (body && typeof body === 'object') {
    if (Object.prototype.hasOwnProperty.call(body, 'name')) {
      if (isDeveloper) {
        throw clientError(403, 'Developer accounts are protected and cannot be modified');
      }
      const name = sanitizeName(body.name);
      if (!name) throw clientError(400, 'Name cannot be empty');
      sets.push('name = ?');
      args.push(name);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'role')) {
      if (isDeveloper) {
        throw clientError(403, 'Developer accounts are protected and cannot be modified');
      }
      const nextRole = sanitizeRole(body.role);
      if (!canAssignRole(actor.role, nextRole)) {
        throw clientError(
          403,
          `You are not allowed to assign the ${nextRole} role`
        );
      }
      sets.push('role = ?');
      args.push(nextRole);
    }
    if (Object.prototype.hasOwnProperty.call(body, 'password')) {
      if (isDeveloper) {
        throw clientError(403, 'Developer accounts are protected and cannot be modified');
      }
      const pw = sanitizePassword(body.password);
      sets.push('password = ?');
      args.push(pw || String(id));
    }
    if (Object.prototype.hasOwnProperty.call(body, 'active')) {
      sets.push('active = ?');
      args.push(body.active ? 1 : 0);
    }
  }
  if (sets.length === 0) {
    return redactPasswordForActor(before, actor);
  }

  args.push(id);
  await pool.query(`UPDATE members SET ${sets.join(', ')} WHERE id = ?`, args);
  const [rows] = await pool.query(
    `SELECT id, name, role, password, active, approval_status FROM members WHERE id = ? LIMIT 1`,
    [id]
  );
  const updated = rowToBidder(rows[0]);
  const editDetails = buildBidderEditDetails(before, updated, body ?? {});
  if (editDetails) {
    await appendBidderAuditLog(pool, {
      action: 'edit',
      actor,
      targetMemberId: id,
      targetName: updated.name,
      targetRole: updated.role,
      details: editDetails,
    });
  }
  // If we just demoted, deactivated, or stripped the target of access, kill
  // any active sessions they hold so the change takes effect immediately.
  if (!PRIVILEGED_ROLES.has(updated.role) || !updated.active) {
    invalidateSessionsForMember(id);
  }
  return redactPasswordForActor(updated, actor);
}

/**
 * Hard-delete a bidder. Removes the row from `members` (the `item_queue` FK
 * has ON DELETE CASCADE, so queue rows are removed automatically). Historical
 * log tables (`bidder_state_log`, `winner_mark_log`) keep their entries — the
 * `member_id` column is nullable + un-FK'd so the audit trail survives.
 */
export async function deleteBidder(pool, idRaw, actor) {
  requireDeletePermission(actor);
  const id = coerceId(idRaw);
  if (id == null) throw clientError(400, 'Invalid bidder id');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.query(
      `SELECT id, name, role FROM members WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!Array.isArray(found) || found.length === 0) {
      await conn.rollback();
      throw clientError(404, 'Bidder not found');
    }
    const deletedName = String(found[0].name ?? '');
    const deletedRole = found[0].role;
    const targetRole = deletedRole;
    if (!canEditRow(actor.role, targetRole)) {
      await conn.rollback();
      if (targetRole === 'Developer') {
        throw clientError(403, 'Developer accounts are protected and cannot be deleted');
      }
      if (targetRole === 'Admin') {
        throw clientError(403, 'Only Developer can delete Admin bidders');
      }
      throw clientError(403, `You are not allowed to delete ${targetRole} bidders`);
    }
    await conn.query(`DELETE FROM members WHERE id = ?`, [id]);
    await appendBidderAuditLog(conn, {
      action: 'delete',
      actor,
      targetMemberId: id,
      targetName: deletedName,
      targetRole: deletedRole,
    });
    await conn.commit();
    invalidateSessionsForMember(id);
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return { ok: true, id };
}

/** List persisted admin audit entries (newest first). Public read — no sign-in. */
export async function listBidderAuditLog(pool) {
  return loadBidderAuditLog(pool);
}

/* --------------------------------------------------------------------------
 * Public (unauthenticated) registration — used by the `/registration` page.
 *
 * Anyone can create a `Member`-role row by supplying an IGN and a password.
 * Privileged roles (Officer / Admin / Developer) must still be created from
 * the admin Bidders tab, so a malicious public submission can't escalate.
 *
 * Throttle: per-IP rate limit so the endpoint can't be spammed to seed
 * thousands of throwaway accounts.
 * ----------------------------------------------------------------------- */
const REGISTER_RATE_WINDOW_MS = 60 * 60 * 1000;
const REGISTER_RATE_MAX_HITS = 8;
const registerHits = new Map();

function pruneRegisterHits(now = Date.now()) {
  for (const [key, info] of registerHits.entries()) {
    if (now - info.firstAt > REGISTER_RATE_WINDOW_MS) registerHits.delete(key);
  }
}

function checkRegisterRateLimit(ipKey) {
  if (!ipKey) return;
  pruneRegisterHits();
  const info = registerHits.get(ipKey);
  if (!info) return;
  const now = Date.now();
  if (now - info.firstAt > REGISTER_RATE_WINDOW_MS) {
    registerHits.delete(ipKey);
    return;
  }
  if (info.hits >= REGISTER_RATE_MAX_HITS) {
    const remainingMin = Math.ceil(
      (info.firstAt + REGISTER_RATE_WINDOW_MS - now) / 60000
    );
    throw clientError(
      429,
      `Too many registrations from this address. Try again in ${remainingMin}m.`
    );
  }
}

function recordRegisterHit(ipKey) {
  if (!ipKey) return;
  const now = Date.now();
  const info = registerHits.get(ipKey) ?? { hits: 0, firstAt: now };
  if (now - info.firstAt > REGISTER_RATE_WINDOW_MS) {
    info.hits = 0;
    info.firstAt = now;
  }
  info.hits += 1;
  registerHits.set(ipKey, info);
}

/**
 * True if an IGN is already taken by an existing active or pending member
 * (case-insensitive).
 *
 * A `rejected` row keeps the IGN reserved as far as the public form goes —
 * an admin can hard-delete the rejected row first if they want to free it.
 * `inactive + approved` rows (soft-deleted) also reserve the IGN so a later
 * reactivation won't collide with a brand-new public signup.
 */
async function isIgnTakenForRegistration(pool, name) {
  const [rows] = await pool.query(
    `SELECT id FROM members
     WHERE LOWER(name) = LOWER(?)
       AND (active = 1 OR approval_status IN ('pending', 'rejected'))
     LIMIT 1`,
    [name]
  );
  return Array.isArray(rows) && rows.length > 0;
}

/** Public IGN-availability probe (used by the registration form's live check). */
export async function publicCheckIgnAvailability(pool, rawIgn) {
  const name = sanitizeName(rawIgn);
  if (!name) return { ign: '', available: false, reason: 'IGN is required' };
  if (name.length < 2) {
    return { ign: name, available: false, reason: 'IGN must be at least 2 characters' };
  }
  if (name.length > 32) {
    return { ign: name, available: false, reason: 'IGN must be at most 32 characters' };
  }
  const taken = await isIgnTakenForRegistration(pool, name);
  return taken
    ? { ign: name, available: false, reason: 'IGN already registered' }
    : { ign: name, available: true };
}

/**
 * Create a new `Member` row from the public registration form.
 *
 * New public registrations are inserted as:
 *     role             = 'Member'
 *     active           = 0
 *     approval_status  = 'pending'
 *
 * They will not appear in `getFullState`'s `members` list, can't sign in to
 * the Bidders page, and the IGN cannot be reactivated by the anonymous queue
 * flow until an Officer / Admin / Developer explicitly approves them from
 * the Bidder Registration page.
 */
export async function publicRegisterMember(pool, body, meta = {}) {
  const ipKey = meta.ip ? `ip:${meta.ip}` : null;
  checkRegisterRateLimit(ipKey);

  const name = sanitizeName(body?.name);
  const password = sanitizePassword(body?.password);
  if (!name) throw clientError(400, 'IGN is required');
  if (name.length < 2) throw clientError(400, 'IGN must be at least 2 characters');
  if (name.length > 32) throw clientError(400, 'IGN must be at most 32 characters');
  if (!password) throw clientError(400, 'Password is required');
  if (password.length < 4) {
    throw clientError(400, 'Password must be at least 4 characters');
  }
  if (password.length > 128) {
    throw clientError(400, 'Password is too long');
  }

  if (await isIgnTakenForRegistration(pool, name)) {
    throw clientError(409, 'This IGN is already registered. Please pick another.');
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    // Re-check uniqueness inside the transaction so two concurrent submits
    // can't both insert the same IGN.
    const [dupe] = await conn.query(
      `SELECT id FROM members
       WHERE LOWER(name) = LOWER(?)
         AND (active = 1 OR approval_status IN ('pending', 'rejected'))
       LIMIT 1`,
      [name]
    );
    if (Array.isArray(dupe) && dupe.length > 0) {
      await conn.rollback();
      throw clientError(409, 'This IGN is already registered. Please pick another.');
    }
    const [ins] = await conn.query(
      `INSERT INTO members (name, role, password, active, approval_status)
       VALUES (?, 'Member', ?, 0, 'pending')`,
      [name, password]
    );
    const id = Number(ins.insertId);
    await conn.commit();
    recordRegisterHit(ipKey);
    return { id, name, role: 'Member', approvalStatus: 'pending' };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}
