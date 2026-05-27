/**
 * Persisted admin audit trail: Bidder Registration + auction dashboard actions.
 */

export const MAX_BIDDER_AUDIT_LOG_ROWS = 1000;

/**
 * @typedef {
 *   | 'approve'|'reject'|'create'|'edit'|'delete'
 *   | 'shuffle_start'|'shuffle_reset'|'event_mode_change'|'winner_limits_set'|'clear_all_queues'
 *   | 'queue_remove'
 * } AdminAuditAction
 */

/**
 * Queue removals in a state PUT (member removed from one item's bid list).
 * @param {Record<string, unknown>} prev
 * @param {Record<string, unknown>} body
 */
export function collectQueueRemoveAudits(prev, body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return [];
  if (!prev || !Array.isArray(prev.items) || !Array.isArray(prev.members)) return [];
  const prevMemberById = new Map(prev.members.map((m) => [m.id, m]));
  const prevItemById = new Map(prev.items.map((i) => [i.id, i]));
  const removals = [];
  for (const it of body.items) {
    if (!it || typeof it !== 'object') continue;
    const itemId = typeof it.id === 'string' ? it.id : '';
    const pi = prevItemById.get(itemId);
    if (!pi) continue;
    const before = Array.isArray(pi.interestedMemberIds) ? pi.interestedMemberIds : [];
    const after = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    const afterSet = new Set(after);
    for (const mid of before) {
      if (afterSet.has(mid)) continue;
      const member = prevMemberById.get(mid);
      removals.push({
        targetMemberId: Number(mid),
        targetName: member?.name ? String(member.name) : String(mid),
        details: {
          itemId,
          itemName: String(pi.name ?? it.name ?? itemId),
          itemType: String(pi.type ?? it.type ?? ''),
        },
      });
    }
  }
  return removals;
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {{
 *   action: BidderAuditAction;
 *   actor: { id: number; name: string; role: string };
 *   targetMemberId?: number | null;
 *   targetName: string;
 *   targetRole?: string | null;
 *   details?: Record<string, unknown> | null;
 * }} entry
 */
/** @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q */
export async function recordAdminAudit(q, { action, actor, targetName, details = null }) {
  await appendBidderAuditLog(q, {
    action,
    actor,
    targetMemberId: null,
    targetName,
    targetRole: null,
    details,
  });
}

export async function appendBidderAuditLog(q, entry) {
  const at = Date.now();
  const detailsJson =
    entry.details && Object.keys(entry.details).length > 0
      ? JSON.stringify(entry.details)
      : null;
  await q.query(
    `INSERT INTO bidder_audit_log (
       at_ms, logged_at, action, target_member_id, target_name, target_role,
       actor_id, actor_name, actor_role, details_json
     ) VALUES (?, FROM_UNIXTIME(? / 1000.0), ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      at,
      at,
      entry.action,
      entry.targetMemberId ?? null,
      entry.targetName,
      entry.targetRole ?? null,
      entry.actor.id,
      entry.actor.name,
      entry.actor.role,
      detailsJson,
    ]
  );
  await trimBidderAuditLog(q);
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 */
async function trimBidderAuditLog(q) {
  await q.query(
    `DELETE FROM bidder_audit_log WHERE id NOT IN (
       SELECT id FROM (
         SELECT id FROM bidder_audit_log ORDER BY at_ms DESC, id DESC LIMIT ?
       ) AS keep_ids
     )`,
    [MAX_BIDDER_AUDIT_LOG_ROWS]
  );
}

function parseDetailsJson(raw) {
  if (raw == null) return null;
  const text =
    typeof raw === 'string'
      ? raw
      : typeof Buffer !== 'undefined' && Buffer.isBuffer(raw)
        ? raw.toString('utf8')
        : String(raw);
  if (!text.trim()) return null;
  try {
    const j = JSON.parse(text);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @returns {Promise<Array<{
 *   id: number;
 *   at: number;
 *   action: string;
 *   targetMemberId: number | null;
 *   targetName: string;
 *   targetRole: string | null;
 *   actorId: number;
 *   actorName: string;
 *   actorRole: string;
 *   details: Record<string, unknown> | null;
 * }>>}
 */
export async function loadBidderAuditLog(pool) {
  const [rows] = await pool.query(
    `SELECT id, at_ms AS atMs, action, target_member_id AS targetMemberId,
            target_name AS targetName, target_role AS targetRole,
            actor_id AS actorId, actor_name AS actorName, actor_role AS actorRole,
            details_json AS detailsJson
     FROM bidder_audit_log
     ORDER BY at_ms DESC, id DESC
     LIMIT ?`,
    [MAX_BIDDER_AUDIT_LOG_ROWS]
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id),
    at: Number(r.atMs),
    action: String(r.action ?? ''),
    targetMemberId:
      r.targetMemberId == null ? null : Number(r.targetMemberId),
    targetName: String(r.targetName ?? ''),
    targetRole: r.targetRole == null ? null : String(r.targetRole),
    actorId: Number(r.actorId),
    actorName: String(r.actorName ?? ''),
    actorRole: String(r.actorRole ?? ''),
    details: parseDetailsJson(r.detailsJson),
  }));
}

/**
 * Build a safe change list for edit audit entries (no password values).
 * @param {Record<string, unknown>} before
 * @param {Record<string, unknown>} after
 * @param {Record<string, unknown>} body
 */
export function buildBidderEditDetails(before, after, body) {
  const changes = [];
  if (Object.prototype.hasOwnProperty.call(body, 'name') && before.name !== after.name) {
    changes.push({ field: 'name', from: before.name, to: after.name });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'role') && before.role !== after.role) {
    changes.push({ field: 'role', from: before.role, to: after.role });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'active') && before.active !== after.active) {
    changes.push({
      field: 'active',
      from: before.active ? 'active' : 'inactive',
      to: after.active ? 'active' : 'inactive',
    });
  }
  if (Object.prototype.hasOwnProperty.call(body, 'password')) {
    changes.push({ field: 'password', from: '(hidden)', to: '(changed)' });
  }
  return changes.length > 0 ? { changes } : null;
}

/**
 * @param {Record<string, unknown>} prev
 * @param {Record<string, unknown>} body
 */
export function buildWinnerLimitsDetails(prev, body) {
  const changes = [];
  const prevRank = String(prev?.rewardRank ?? '');
  const nextRank =
    typeof body.rewardRank === 'string' ? body.rewardRank : prevRank;
  if (prevRank !== nextRank) {
    changes.push({ field: 'rank', from: prevRank, to: nextRank });
  }
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const a = prev?.rewardItemCounts ?? {};
  const b = body.rewardItemCounts ?? {};
  if (!b || typeof b !== 'object') {
    return changes.length > 0 ? { changes } : null;
  }
  if (num(a.fragment) !== num(b.fragment)) {
    changes.push({
      field: 'fragment',
      from: String(num(a.fragment)),
      to: String(num(b.fragment)),
    });
  }
  if (num(a.feathers) !== num(b.feathers)) {
    changes.push({
      field: 'feathers',
      from: String(num(a.feathers)),
      to: String(num(b.feathers)),
    });
  }
  const aMap =
    a.fragmentByItemId && typeof a.fragmentByItemId === 'object'
      ? a.fragmentByItemId
      : {};
  const bMap =
    b.fragmentByItemId && typeof b.fragmentByItemId === 'object'
      ? b.fragmentByItemId
      : {};
  const keys = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);
  for (const k of keys) {
    if (num(aMap[k]) !== num(bMap[k])) {
      changes.push({
        field: `fragment:${k}`,
        from: String(num(aMap[k])),
        to: String(num(bMap[k])),
      });
    }
  }
  return changes.length > 0 ? { changes } : null;
}
