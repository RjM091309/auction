import type {
  AuctionItem,
  AuctionState,
  BidderStateLogEntry,
  RewardItemCounts,
  GuildMember,
  WeeklyTypeWin,
  WeeklyEventType,
  WinnerMarkLogEntry,
} from '../types';
import { AUCTION_DATA_VERSION } from '../data/auctionDefaults';
import { sortBidderStateLogNewestFirst } from './bidderStateLogUi';
import { dedupeRosterMembersByIgn } from './dedupeRosterMembersByIgn';
import { normalizeQueuesForEventMode } from './dedupeIgnAcrossQueues';
import { parseGuildRank } from './pageAssignment';
import { stripEmperiumCardQueuesAfterFragmentWeeklyWin } from './queueEligibility';
import { pruneExpiredEmperiumWins } from './emperiumWinCooldown';
import {
  migrateFeatherItems,
  parseRewardItemCounts,
} from './featherMigration';

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
    const role =
      m.role === 'Officer' ||
      m.role === 'Member' ||
      m.role === 'Developer' ||
      m.role === 'Admin'
        ? m.role
        : m.role === 'Leader'
          ? 'Officer'
          : 'Member';
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
    let revokedWinnerNames: string[] | undefined;
    if (Array.isArray(it.revokedWinnerNames)) {
      const r = it.revokedWinnerNames
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter(Boolean);
      if (r.length > 0) revokedWinnerNames = r;
    }
    const winnerPoolCapRaw = (it as unknown as Record<string, unknown>).winnerPoolCap;
    const winnerPoolCap =
      winnerPoolCapRaw == null || winnerPoolCapRaw === ''
        ? null
        : Number.isFinite(Number(winnerPoolCapRaw))
          ? Math.max(0, Math.floor(Number(winnerPoolCapRaw)))
          : null;
    return {
      ...it,
      ...(recordedWinnerNames ? { recordedWinnerNames } : {}),
      ...(revokedWinnerNames ? { revokedWinnerNames } : {}),
      winnerPoolCap,
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
      const ign = typeof r.ign === 'string' ? r.ign.trim().toLowerCase() : '';
      const t = typeof r.t === 'string' ? r.t.trim() : '';
      if (!ign || !t) continue;
      const entry: WeeklyTypeWin = { ign, t };
      if (typeof r.itemId === 'string' && r.itemId.trim()) {
        entry.itemId = r.itemId.trim();
      }
      const at =
        typeof r.at === 'number' ? r.at : r.at != null ? Number(r.at) : NaN;
      if (Number.isFinite(at) && at > 0) entry.at = at;
      weeklyTypeWins.push(entry);
    }
    weeklyTypeWins = pruneExpiredEmperiumWins(weeklyTypeWins);
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

  const parseEventType = (v: unknown): WeeklyEventType =>
    v === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
  const eventMode = parseEventType(o.eventMode);
  const rewardRank = parseGuildRank(o.rewardRank);
  const rewardItemCounts: RewardItemCounts = parseRewardItemCounts(
    o.rewardItemCounts,
    rewardRank
  );

  let freeDrawChosenByItemId: Record<string, number> | undefined;
  const rawFd = o.freeDrawChosenByItemId;
  if (rawFd && typeof rawFd === 'object' && !Array.isArray(rawFd)) {
    const fd: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawFd as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k) continue;
      const id =
        typeof v === 'number' && Number.isInteger(v) && v > 0
          ? v
          : typeof v === 'string' && /^\d+$/.test(v.trim())
            ? parseInt(v.trim(), 10)
            : NaN;
      if (Number.isInteger(id) && id > 0) fd[k] = id;
    }
    freeDrawChosenByItemId = fd;
  }

  let shuffleWinnerSlotsByItemId: Record<string, number> | undefined;
  const rawSw = o.shuffleWinnerSlotsByItemId;
  if (rawSw && typeof rawSw === 'object' && !Array.isArray(rawSw)) {
    const sw: Record<string, number> = {};
    for (const [k, v] of Object.entries(rawSw as Record<string, unknown>)) {
      if (typeof k !== 'string' || !k) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) sw[k] = Math.floor(n);
    }
    shuffleWinnerSlotsByItemId = sw;
  }

  return normalizeQueuesForEventMode(
    stripEmperiumCardQueuesAfterFragmentWeeklyWin(
      dedupeRosterMembersByIgn({
        items: migrateFeatherItems(items),
        members,
        dataVersion,
        winnerShortlistUiEnabled,
        shuffleLocked,
        weeklyTypeWins,
        eventMode,
        rewardRank,
        rewardItemCounts,
        ...(winnerMarkLog ? { winnerMarkLog } : {}),
        ...(bidderStateLog ? { bidderStateLog } : {}),
        ...(freeDrawChosenByItemId !== undefined
          ? { freeDrawChosenByItemId }
          : {}),
        ...(shuffleWinnerSlotsByItemId !== undefined
          ? { shuffleWinnerSlotsByItemId }
          : {}),
      })
    )
  );
}

const cred: RequestInit = { credentials: 'include' };

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
    public readonly extra?: {
      itemName?: string;
      otherItemName?: string;
      expiresAt?: number;
    }
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

export class PublicMoveQueueError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly extra?: {
      itemName?: string;
      otherItemName?: string;
      expiresAt?: number;
    }
  ) {
    super(message);
    this.name = 'PublicMoveQueueError';
  }
}

export type PublicMoveQueuePayload = {
  fromItemId: string;
  toItemId: string;
  memberId: number;
  insertBeforeMemberId: number | null;
};

/** Public POST — drag-and-drop queue move (no session, no full-state PUT). */
export async function publicMoveQueueMember(
  payload: PublicMoveQueuePayload
): Promise<AuctionState> {
  const res = await fetch(apiUrl('/api/public/queue/move'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new PublicMoveQueueError(text || 'Invalid response');
  }
  if (!res.ok) {
    const o = (json && typeof json === 'object' ? json : {}) as Record<
      string,
      unknown
    >;
    throw new PublicMoveQueueError(
      typeof o.error === 'string' ? o.error : res.statusText,
      typeof o.code === 'string' ? o.code : undefined,
      o.extra as PublicMoveQueueError['extra'] | undefined
    );
  }
  const parsed = parseAuctionState(json);
  if (!parsed) throw new PublicMoveQueueError('Invalid auction state from server');
  return parsed;
}

/**
 * Replace server state (members, items, queues). Called after local edits;
 * server maps this to `members`, `auction_items`, and `item_queue` rows.
 */
/**
 * Persists admin state; returns latest server snapshot (includes `winnerMarkLog`).
 *
 * `opts.bearerToken` is optional — pass it when the change includes a
 * privileged transition the server gates per-action (currently:
 * `shuffleLocked` false → true, which requires Officer/Admin/Developer).
 */
export async function persistAuctionState(
  state: AuctionState,
  opts: { bearerToken?: string } = {}
): Promise<AuctionState | null> {
  const body = {
    items: state.items,
    members: state.members,
    dataVersion: state.dataVersion ?? AUCTION_DATA_VERSION,
    winnerShortlistUiEnabled: state.winnerShortlistUiEnabled === true,
    shuffleLocked: state.shuffleLocked === true,
    eventMode: state.eventMode ?? 'Emperium Overrun',
    rewardRank: state.rewardRank ?? 'Bronze',
    rewardItemCounts: state.rewardItemCounts ?? { fragment: 2, feathers: 80 },
    freeDrawChosenByItemId: state.freeDrawChosenByItemId ?? {},
    shuffleWinnerSlotsByItemId: state.shuffleWinnerSlotsByItemId ?? {},
  };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearerToken) headers.Authorization = `Bearer ${opts.bearerToken}`;
  const res = await fetch(apiUrl('/api/state'), {
    ...cred,
    method: 'PUT',
    headers,
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

/** Remove a member from one item queue only (admin). Requires a privileged
 *  Bidders-tab session — pass the token returned by `/api/bidders/auth`. */
export async function removeMemberFromItemQueueOnServer(
  itemId: string,
  memberId: number,
  bearerToken: string
): Promise<AuctionState> {
  const headers: Record<string, string> = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const res = await fetch(
    apiUrl(
      `/api/items/${encodeURIComponent(itemId)}/queue/${encodeURIComponent(String(memberId))}`
    ),
    { ...cred, method: 'DELETE', headers }
  );
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    // Surface the server message verbatim so the caller can detect 401
    // ("You must sign in...") and re-prompt for credentials.
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

/**
 * Privileged bulk-clear of every active item queue. Requires an
 * Admin/Developer Bearer token; server rejects Officer / unauthenticated
 * callers with 401 / 403.
 */
export async function clearAllActiveQueuesOnServer(
  bearerToken: string
): Promise<AuctionState> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const res = await fetch(apiUrl('/api/state/clear-queues'), {
    ...cred,
    method: 'POST',
    headers,
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

/**
 * Privileged event-mode toggle. Requires an Admin/Developer Bearer token
 * (the same kind issued by `/api/bidders/auth`). Server rejects Officer
 * or unauthenticated callers with 401/403.
 */
export async function setEventModeOnServer(
  eventMode: 'Guild League' | 'Emperium Overrun',
  bearerToken: string
): Promise<AuctionState> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;
  const res = await fetch(apiUrl('/api/state/event-mode'), {
    ...cred,
    method: 'POST',
    headers,
    body: JSON.stringify({ eventMode }),
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
