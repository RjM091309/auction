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

  return { items, members, dataVersion, winnerShortlistUiEnabled };
}

/** Load full auction state from the API (MySQL-backed). */
export async function fetchAuctionState(): Promise<AuctionState | null> {
  try {
    const res = await fetch(apiUrl('/api/state'));
    if (!res.ok) return null;
    return parseAuctionState(await res.json());
  } catch {
    return null;
  }
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
  };
  const res = await fetch(apiUrl('/api/state'), {
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
  const res = await fetch(
    apiUrl(`/api/members/${encodeURIComponent(memberId)}`),
    { method: 'DELETE' }
  );
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
