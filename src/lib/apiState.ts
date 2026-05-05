import type {
  AuctionItem,
  AuctionState,
  BidderStateLogEntry,
  GuildMember,
  WeeklyTypeWin,
  WinnerMarkLogEntry,
} from '../types';
import { AUCTION_DATA_VERSION } from '../data/auctionDefaults';
import { sortBidderStateLogNewestFirst } from './bidderStateLogUi';

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

  const members: GuildMember[] = (o.members as unknown[]).map((row) => {
    if (!row || typeof row !== 'object') return null;
    const m = row as Record<string, unknown>;
    const idRaw = m.id;
    const id =
      typeof idRaw === 'number' && Number.isInteger(idRaw)
        ? idRaw
        : typeof idRaw === 'string' && /^\d+$/.test(idRaw.trim())
          ? parseInt(idRaw.trim(), 10)
          : NaN;
    const name = typeof m.name === 'string' ? m.name : '';
    const role = m.role === 'Leader' || m.role === 'Member' ? m.role : 'Member';
    if (!Number.isInteger(id) || id <= 0 || !name) return null;
    return { id, name, role };
  }).filter((m): m is GuildMember => m != null);

  if (
    Array.isArray(o.members) &&
    o.members.length > 0 &&
    members.length === 0
  ) {
    return null;
  }

  const items = (o.items as AuctionItem[]).map((it) => {
    let recordedWinnerNames: string[] | undefined;
    if (Array.isArray(it.recordedWinnerNames)) {
      const r = it.recordedWinnerNames
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean);
      if (r.length > 0) recordedWinnerNames = r;
    }
    return {
      ...it,
      ...(recordedWinnerNames ? { recordedWinnerNames } : {}),
      interestedMemberIds: Array.isArray(it.interestedMemberIds)
        ? (it.interestedMemberIds as unknown[])
            .map((x) => {
              if (typeof x === 'number' && Number.isInteger(x) && x > 0) return x;
              if (typeof x === 'string' && /^\d+$/.test(x.trim())) {
                const n = parseInt(x.trim(), 10);
                return Number.isInteger(n) && n > 0 ? n : null;
              }
              return null;
            })
            .filter((x): x is number => x != null)
        : [],
      createdAt:
        typeof it.createdAt === 'number'
          ? it.createdAt
          : Number(it.createdAt) || Date.now(),
    };
  });

  const dv = o.dataVersion;
  const dataVersion =
    typeof dv === 'number' && !Number.isNaN(dv) ? dv : AUCTION_DATA_VERSION;

  /** Opt-in: `undefined`/absent = off (iwas lumang API o JSON na walang field). */
  const winnerShortlistUiEnabled = o.winnerShortlistUiEnabled === true;
  const shuffleLocked = o.shuffleLocked === true;

  let weeklyTypeWins: WeeklyTypeWin[] = [];
  const rawWins = o.weeklyTypeWins;
  if (Array.isArray(rawWins)) {
    for (const row of rawWins) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const ign =
        typeof r.ign === 'string' ? r.ign.trim().toLowerCase() : '';
      const t = typeof r.t === 'string' ? r.t : '';
      if (ign && t) weeklyTypeWins.push({ ign, t });
    }
  }

  let winnerMarkLog: WinnerMarkLogEntry[] | undefined;
  const rawLog = o.winnerMarkLog;
  if (Array.isArray(rawLog)) {
    const log: WinnerMarkLogEntry[] = [];
    for (const row of rawLog) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const at = typeof r.at === 'number' ? r.at : Number(r.at);
      const ign = typeof r.ign === 'string' ? r.ign.trim() : '';
      const itemId = typeof r.itemId === 'string' ? r.itemId.trim() : '';
      const itemName = typeof r.itemName === 'string' ? r.itemName : '';
      const itemType = typeof r.itemType === 'string' ? r.itemType : '';
      if (!Number.isFinite(at) || !ign || !itemId) continue;
      let id: number | undefined;
      const rawId = r.id;
      if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
        id = rawId;
      } else if (typeof rawId === 'string') {
        const n = parseInt(rawId, 10);
        if (Number.isInteger(n) && n > 0) id = n;
      }
      log.push(
        id != null
          ? { id, at, ign, itemId, itemName, itemType }
          : { at, ign, itemId, itemName, itemType }
      );
    }
    if (log.length > 0) winnerMarkLog = log;
  }

  let bidderStateLog: BidderStateLogEntry[] | undefined;
  const rawBidder = o.bidderStateLog;
  if (Array.isArray(rawBidder)) {
    const blog: BidderStateLogEntry[] = [];
    for (const row of rawBidder) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const at = typeof r.at === 'number' ? r.at : Number(r.at);
      const ign = typeof r.ign === 'string' ? r.ign.trim() : '';
      const itemId = typeof r.itemId === 'string' ? r.itemId.trim() : '';
      const itemName = typeof r.itemName === 'string' ? r.itemName : '';
      const itemType = typeof r.itemType === 'string' ? r.itemType : '';
      const stateNum = typeof r.state === 'number' ? r.state : Number(r.state);
      if (!Number.isFinite(at) || !ign || !itemId) continue;
      if (stateNum !== 0 && stateNum !== 1 && stateNum !== 2) continue;
      let id: number | undefined;
      const rawId = r.id;
      if (typeof rawId === 'number' && Number.isInteger(rawId) && rawId > 0) {
        id = rawId;
      } else if (typeof rawId === 'string') {
        const n = parseInt(rawId, 10);
        if (Number.isInteger(n) && n > 0) id = n;
      }
      let memberId: number | null | undefined;
      const rawMid = r.memberId;
      if (rawMid == null) memberId = null;
      else if (typeof rawMid === 'number' && Number.isInteger(rawMid) && rawMid > 0) {
        memberId = rawMid;
      } else if (typeof rawMid === 'string' && /^\d+$/.test(rawMid.trim())) {
        const n = parseInt(rawMid.trim(), 10);
        memberId = Number.isInteger(n) && n > 0 ? n : null;
      } else memberId = null;

      let poolCap: number | null | undefined;
      if (r.poolCap != null && r.poolCap !== '') {
        const p = Number(r.poolCap);
        poolCap = Number.isFinite(p) ? p : null;
      } else poolCap = null;

      let queuePosition: number | null | undefined;
      if (r.queuePosition != null && r.queuePosition !== '') {
        const p = Number(r.queuePosition);
        queuePosition = Number.isFinite(p) ? p : null;
      } else queuePosition = null;

      let shuffleBatchAtMs: number | null | undefined;
      if (r.shuffleBatchAtMs != null && r.shuffleBatchAtMs !== '') {
        const p = Number(r.shuffleBatchAtMs);
        shuffleBatchAtMs = Number.isFinite(p) ? p : null;
      } else shuffleBatchAtMs = null;

      blog.push(
        id != null
          ? {
              id,
              at,
              ign,
              itemId,
              itemName,
              itemType,
              state: stateNum,
              memberId,
              poolCap,
              queuePosition,
              shuffleBatchAtMs,
            }
          : {
              at,
              ign,
              itemId,
              itemName,
              itemType,
              state: stateNum,
              memberId,
              poolCap,
              queuePosition,
              shuffleBatchAtMs,
            }
      );
    }
    if (blog.length > 0) bidderStateLog = sortBidderStateLogNewestFirst(blog);
  }

  return {
    items,
    members,
    dataVersion,
    winnerShortlistUiEnabled,
    shuffleLocked,
    weeklyTypeWins,
    ...(winnerMarkLog ? { winnerMarkLog } : {}),
    ...(bidderStateLog ? { bidderStateLog } : {}),
  };
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
/** Persists admin state; returns latest server snapshot (includes `winnerMarkLog`). */
export async function persistAuctionState(
  state: AuctionState
): Promise<AuctionState | null> {
  const body = {
    items: state.items,
    members: state.members,
    dataVersion: state.dataVersion ?? AUCTION_DATA_VERSION,
    winnerShortlistUiEnabled: state.winnerShortlistUiEnabled === true,
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
  try {
    const json: unknown = await res.json();
    return parseAuctionState(json);
  } catch {
    return null;
  }
}

/** Soft-delete a member on the server (DB `active = 0`, queues cleared); returns latest state. */
export async function deactivateMemberOnServer(memberId: number): Promise<AuctionState> {
  const res = await fetch(apiUrl(`/api/members/${encodeURIComponent(String(memberId))}`), {
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
