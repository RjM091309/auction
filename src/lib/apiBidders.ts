import { apiUrl } from './apiState';

export type BidderRole = 'Officer' | 'Member' | 'Developer' | 'Admin';
export type PrivilegedRole = 'Officer' | 'Developer' | 'Admin';

export interface Bidder {
  id: number;
  name: string;
  role: BidderRole;
  password: string;
  active: boolean;
}

export interface BidderInput {
  name: string;
  role: BidderRole;
  password?: string;
}

export interface BidderUpdate {
  name?: string;
  role?: BidderRole;
  password?: string;
  active?: boolean;
}

/** Server-issued session for the Bidders-tab gate. Stored in sessionStorage. */
export interface BidderActor {
  token: string;
  id: number;
  name: string;
  role: PrivilegedRole;
}

export interface EligibleActor {
  id: number;
  name: string;
  role: PrivilegedRole;
}

/** A member as exposed by `/api/members/active` — used to populate the
 *  searchable "Join queue" dropdown. Any active member is eligible to join a
 *  queue (regardless of role), so this can be a Member, Officer, Admin or
 *  Developer. */
export interface ActiveMember {
  id: number;
  name: string;
  role: BidderRole;
}

/** Result of `verifyMemberRequest` — a successfully-authenticated member. */
export interface VerifiedMember {
  id: number;
  name: string;
  role: BidderRole;
}

const SESSION_KEY = 'bidderActor.v1';

export function loadStoredActor(): BidderActor | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const id = typeof o.id === 'number' ? o.id : NaN;
    if (
      typeof o.token !== 'string' ||
      !o.token ||
      typeof o.name !== 'string' ||
      !Number.isInteger(id) ||
      id <= 0 ||
      (o.role !== 'Officer' && o.role !== 'Admin' && o.role !== 'Developer')
    ) {
      return null;
    }
    return { token: o.token, id, name: o.name, role: o.role };
  } catch {
    return null;
  }
}

export function storeActor(actor: BidderActor): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(actor));
}

export function clearStoredActor(): void {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(SESSION_KEY);
}

function authHeaders(): HeadersInit {
  const actor = loadStoredActor();
  if (!actor) return {};
  return { Authorization: `Bearer ${actor.token}` };
}

const cred: RequestInit = { credentials: 'include' };

function parseBidder(raw: unknown): Bidder | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const idVal = r.id;
  const id =
    typeof idVal === 'number' && Number.isInteger(idVal)
      ? idVal
      : typeof idVal === 'string' && /^\d+$/.test(idVal.trim())
        ? parseInt(idVal.trim(), 10)
        : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  return {
    id,
    name: typeof r.name === 'string' ? r.name : '',
    role:
      r.role === 'Officer'
        ? 'Officer'
        : r.role === 'Developer'
          ? 'Developer'
          : r.role === 'Admin'
            ? 'Admin'
            : 'Member',
    password: typeof r.password === 'string' ? r.password : '',
    active: r.active === true || r.active === 1,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Invalid JSON from server');
  }
}

function errorMessage(json: unknown, fallback: string): string {
  if (json && typeof json === 'object') {
    const o = json as Record<string, unknown>;
    if (typeof o.error === 'string' && o.error) return o.error;
  }
  return fallback;
}

function parseActor(raw: unknown): Omit<BidderActor, 'token'> | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const idVal = o.id;
  const id =
    typeof idVal === 'number'
      ? idVal
      : typeof idVal === 'string' && /^\d+$/.test(idVal.trim())
        ? parseInt(idVal.trim(), 10)
        : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  if (typeof o.name !== 'string' || !o.name) return null;
  if (o.role !== 'Officer' && o.role !== 'Admin' && o.role !== 'Developer') return null;
  return { id, name: o.name, role: o.role };
}

function parseActiveMember(raw: unknown): ActiveMember | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const idVal = o.id;
  const id =
    typeof idVal === 'number'
      ? idVal
      : typeof idVal === 'string' && /^\d+$/.test(idVal.trim())
        ? parseInt(idVal.trim(), 10)
        : NaN;
  if (!Number.isInteger(id) || id <= 0) return null;
  if (typeof o.name !== 'string' || !o.name) return null;
  if (
    o.role !== 'Officer' &&
    o.role !== 'Member' &&
    o.role !== 'Admin' &&
    o.role !== 'Developer'
  ) {
    return null;
  }
  return { id, name: o.name, role: o.role };
}

/** Fetch every active member (any role) for the Join-queue dropdown. */
export async function fetchActiveMembers(): Promise<ActiveMember[]> {
  const res = await fetch(apiUrl('/api/members/active'), cred);
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const arr =
    json && typeof json === 'object' && Array.isArray((json as { members?: unknown }).members)
      ? ((json as { members: unknown[] }).members)
      : [];
  return arr
    .map(parseActiveMember)
    .filter((m): m is ActiveMember => m != null);
}

/**
 * One-shot credential check (no session minted). Throws on failure so the
 * caller can `try/catch` and surface the server error string. On success the
 * caller may immediately proceed with the gated action.
 */
export async function verifyMemberRequest(
  name: string,
  password: string
): Promise<VerifiedMember> {
  const res = await fetch(apiUrl('/api/members/verify'), {
    ...cred,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const o = (json ?? {}) as { actor?: unknown };
  const actor = parseActiveMember(o.actor);
  if (!actor) throw new Error('Invalid verify response');
  return actor;
}

export async function fetchEligibleActors(): Promise<EligibleActor[]> {
  const res = await fetch(apiUrl('/api/bidders/eligible'), cred);
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const arr =
    json && typeof json === 'object' && Array.isArray((json as { actors?: unknown }).actors)
      ? ((json as { actors: unknown[] }).actors)
      : [];
  return arr
    .map((a) => parseActor(a))
    .filter((a): a is EligibleActor => a != null);
}

export async function authBidderRequest(
  name: string,
  password: string
): Promise<BidderActor> {
  const res = await fetch(apiUrl('/api/bidders/auth'), {
    ...cred,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const o = (json ?? {}) as { token?: unknown; actor?: unknown };
  const token = typeof o.token === 'string' && o.token ? o.token : null;
  const actor = parseActor(o.actor);
  if (!token || !actor) throw new Error('Invalid auth response');
  return { token, ...actor };
}

export async function signOutBidderRequest(): Promise<void> {
  try {
    await fetch(apiUrl('/api/bidders/signout'), {
      ...cred,
      method: 'POST',
      headers: { ...authHeaders() },
    });
  } finally {
    clearStoredActor();
  }
}

export async function fetchBidders(): Promise<Bidder[]> {
  const res = await fetch(apiUrl('/api/bidders'), {
    ...cred,
    headers: { ...authHeaders() },
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const arr =
    json && typeof json === 'object' && Array.isArray((json as { bidders?: unknown }).bidders)
      ? ((json as { bidders: unknown[] }).bidders)
      : [];
  return arr
    .map(parseBidder)
    .filter((b): b is Bidder => b != null);
}

export async function createBidderRequest(input: BidderInput): Promise<Bidder> {
  const res = await fetch(apiUrl('/api/bidders'), {
    ...cred,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(input),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const b = parseBidder((json as { bidder?: unknown })?.bidder);
  if (!b) throw new Error('Invalid bidder response');
  return b;
}

export async function updateBidderRequest(
  id: number,
  patch: BidderUpdate
): Promise<Bidder> {
  const res = await fetch(apiUrl(`/api/bidders/${encodeURIComponent(String(id))}`), {
    ...cred,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(patch),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const b = parseBidder((json as { bidder?: unknown })?.bidder);
  if (!b) throw new Error('Invalid bidder response');
  return b;
}

export async function deleteBidderRequest(id: number): Promise<void> {
  const res = await fetch(apiUrl(`/api/bidders/${encodeURIComponent(String(id))}`), {
    ...cred,
    method: 'DELETE',
    headers: { ...authHeaders() },
  });
  if (!res.ok) {
    const json = await readJson(res).catch(() => null);
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
}

/* --------------------------------------------------------------------------
 * Public registration (used by the standalone `/registration` page).
 *
 * No admin cookie / Bearer required. The server forces role=Member and
 * rejects duplicate IGNs case-insensitively. Live IGN-availability check
 * is exposed separately so the form can react as the user types.
 * ----------------------------------------------------------------------- */
export interface PublicIgnCheck {
  ign: string;
  available: boolean;
  reason?: string;
}

export interface PublicRegisterResult {
  ok: true;
  member: { id: number; name: string; role: 'Member' };
}

/** Live IGN-availability probe. Safe to call on every keystroke (debounced). */
export async function publicCheckIgn(ign: string): Promise<PublicIgnCheck> {
  const res = await fetch(
    apiUrl(`/api/public/registration/check?ign=${encodeURIComponent(ign)}`)
  );
  const json = (await readJson(res)) as PublicIgnCheck | null;
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  if (!json || typeof json !== 'object') {
    throw new Error('Invalid availability response');
  }
  return {
    ign: typeof json.ign === 'string' ? json.ign : ign,
    available: json.available === true,
    ...(typeof json.reason === 'string' && json.reason
      ? { reason: json.reason }
      : {}),
  };
}

/** Submit a new Member-role registration. Server enforces uniqueness. */
export async function publicRegisterRequest(
  name: string,
  password: string
): Promise<PublicRegisterResult> {
  const res = await fetch(apiUrl('/api/public/register'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, password }),
  });
  const json = await readJson(res);
  if (!res.ok) {
    throw new Error(errorMessage(json, `${res.status} ${res.statusText}`));
  }
  const member = (json as { member?: { id?: number; name?: string } })?.member;
  if (!member || typeof member.id !== 'number' || typeof member.name !== 'string') {
    throw new Error('Invalid registration response');
  }
  return { ok: true, member: { id: member.id, name: member.name, role: 'Member' } };
}
