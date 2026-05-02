import type { AuctionItem, AuctionState, GuildMember } from '../types';
import { AUCTION_DATA_VERSION } from '../data/auctionDefaults';

/** Absolute API origin, or empty string to use same origin (Vite `/api` proxy in dev). */
export function apiUrl(path: string): string {
  const raw = import.meta.env.VITE_API_ORIGIN as string | undefined;
  const base = raw?.replace(/\/$/, '') ?? '';
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

export function parseAuctionState(json: unknown): AuctionState | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (!Array.isArray(o.items) || !Array.isArray(o.members)) return null;

  const members = o.members as GuildMember[];
  const items = (o.items as AuctionItem[]).map((it) => ({
    ...it,
    interestedMemberIds: Array.isArray(it.interestedMemberIds)
      ? it.interestedMemberIds
      : [],
    createdAt:
      typeof it.createdAt === 'number'
        ? it.createdAt
        : Number(it.createdAt) || Date.now(),
  }));

  const dv = o.dataVersion;
  const dataVersion =
    typeof dv === 'number' && !Number.isNaN(dv) ? dv : AUCTION_DATA_VERSION;

  const winnerShortlistUiEnabled = o.winnerShortlistUiEnabled !== false;
  const shuffleLocked = o.shuffleLocked === true;

  return { items, members, dataVersion, winnerShortlistUiEnabled, shuffleLocked };
}

const cred: RequestInit = { credentials: 'include' };

/** Session check (HttpOnly cookie set by POST /api/auth/login). */
export async function fetchAuthMe(): Promise<{ authed: boolean }> {
  try {
    const res = await fetch(apiUrl('/api/auth/me'), cred);
    if (!res.ok) return { authed: false };
    const j = (await res.json()) as { authed?: boolean };
    return { authed: Boolean(j.authed) };
  } catch {
    return { authed: false };
  }
}

export async function loginRequest(
  username: string,
  password: string
): Promise<{ ok: true } | { error: string }> {
  const res = await fetch(apiUrl('/api/auth/login'), {
    ...cred,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (res.ok) return { ok: true as const };
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = (await res.json()) as { error?: string };
    if (j?.error) msg = j.error;
  } catch {
    /* ignore */
  }
  return { error: msg };
}

export async function logoutRequest(): Promise<void> {
  try {
    await fetch(apiUrl('/api/auth/logout'), { ...cred, method: 'POST' });
  } catch {
    /* ignore */
  }
}

/** Load full auction state from the API (MySQL-backed). */
export async function fetchAuctionState(): Promise<AuctionState | null> {
  try {
    const res = await fetch(apiUrl('/api/state'), cred);
    if (!res.ok) return null;
    return parseAuctionState(await res.json());
  } catch {
    return null;
  }
}

export class PublicAddBidError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly extra?: { itemName?: string; otherItemName?: string }
  ) {
    super(message);
    this.name = 'PublicAddBidError';
  }
}

/** Public POST — add IGN to an active item queue (no session). */
export async function publicAddBidToQueue(
  itemId: string,
  name: string
): Promise<AuctionState> {
  const res = await fetch(apiUrl('/api/public/queue/add'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, name }),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new PublicAddBidError(text || 'Invalid response');
  }
  if (!res.ok) {
    const o = (json && typeof json === 'object' ? json : {}) as Record<
      string,
      unknown
    >;
    throw new PublicAddBidError(
      typeof o.error === 'string' ? o.error : res.statusText,
      typeof o.code === 'string' ? o.code : undefined,
      o.extra as PublicAddBidError['extra'] | undefined
    );
  }
  const parsed = parseAuctionState(json);
  if (!parsed) throw new PublicAddBidError('Invalid auction state from server');
  return parsed;
}

/**
 * Replace server state (members, items, queues). Called after local edits;
 * server maps this to `members`, `auction_items`, and `item_queue` rows.
 */
export async function persistAuctionState(state: AuctionState): Promise<void> {
  const body = {
    items: state.items,
    members: state.members,
    dataVersion: state.dataVersion ?? AUCTION_DATA_VERSION,
    winnerShortlistUiEnabled: state.winnerShortlistUiEnabled !== false,
    shuffleLocked: state.shuffleLocked === true,
  };
  const res = await fetch(apiUrl('/api/state'), {
    ...cred,
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
}

/** Soft-delete a member on the server (DB `active = 0`, queues cleared); returns latest state. */
export async function deactivateMemberOnServer(memberId: string): Promise<AuctionState> {
  const res = await fetch(apiUrl(`/api/members/${encodeURIComponent(memberId)}`), {
    ...cred,
    method: 'DELETE',
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new Error(text || `${res.status} ${res.statusText}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    throw new Error('Invalid JSON from server');
  }
  const parsed = parseAuctionState(json);
  if (!parsed) throw new Error('Invalid auction state from server');
  return parsed;
}
