import type { AuctionItem, BidderStateLogEntry, GuildMember } from '../types';

/** Matches DB `bidder_state_log.state` (server + types). */
export const BIDDER_STATE_LOSS = 0;
export const BIDDER_STATE_WIN = 1;
export const BIDDER_STATE_ONGOING = 2;

export function bidderStateLabel(state: number): string {
  if (state === BIDDER_STATE_WIN) return 'Win';
  if (state === BIDDER_STATE_ONGOING) return 'Ongoing';
  if (state === BIDDER_STATE_LOSS) return 'Loss';
  return `State ${state}`;
}

/** Filter for the detailed `bidder_state_log` list (public + admin). */
export type BidderLogStateFilter = 'all' | 'loss' | 'ongoing' | 'win';

export function bidderLogEntryMatchesFilter(
  row: BidderStateLogEntry,
  filter: BidderLogStateFilter
): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'loss':
      return row.state === BIDDER_STATE_LOSS;
    case 'ongoing':
      return row.state === BIDDER_STATE_ONGOING;
    case 'win':
      return row.state === BIDDER_STATE_WIN;
    default:
      return true;
  }
}

/** Case-insensitive; every whitespace-separated token must appear somewhere in the row text. */
export function bidderLogEntryMatchesSearch(
  row: BidderStateLogEntry,
  query: string
): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;
  const blob = [
    row.ign,
    row.itemName,
    row.itemType,
    row.itemId,
    String(row.state),
    bidderStateLabel(row.state),
    row.poolCap != null ? String(row.poolCap) : '',
    row.queuePosition != null ? String(row.queuePosition) : '',
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => blob.includes(t));
}

/** Newest first (latest / “today” on top); tie-break by `id` when same `at` ms. */
export function sortBidderStateLogNewestFirst(
  entries: readonly BidderStateLogEntry[]
): BidderStateLogEntry[] {
  return [...entries].sort((a, b) => {
    if (b.at !== a.at) return b.at - a.at;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

export function bidderStateBadgeClass(state: number): string {
  if (state === BIDDER_STATE_WIN) {
    return 'border-green-500/40 bg-green-500/15 text-green-300';
  }
  if (state === BIDDER_STATE_ONGOING) {
    return 'border-blue-500/40 bg-blue-500/15 text-blue-300';
  }
  if (state === BIDDER_STATE_LOSS) {
    return 'border-rose-500/40 bg-rose-500/15 text-rose-300';
  }
  return 'border-slate-600 bg-slate-800 text-slate-400';
}

export type BidderSummaryRow = {
  ign: string;
  wins: number;
  losses: number;
  ongoing: number;
};

/**
 * Active queues → normalized IGN → display name + how many cards they’re on (visible items only).
 */
export function countQueuedIgnByNormalized(
  items: readonly AuctionItem[],
  members: readonly GuildMember[],
  isItemHidden: (item: AuctionItem) => boolean
): Map<string, { ign: string; count: number }> {
  const out = new Map<string, { ign: string; count: number }>();
  for (const it of items) {
    if (it.status !== 'active') continue;
    if (isItemHidden(it)) continue;
    for (const mid of it.interestedMemberIds) {
      const raw = members.find((m) => m.id === mid)?.name?.trim();
      if (!raw) continue;
      const k = raw.toLowerCase();
      const cur = out.get(k) ?? { ign: raw, count: 0 };
      cur.count += 1;
      cur.ign = raw;
      out.set(k, cur);
    }
  }
  return out;
}

/**
 * Summary for the Logs table. Wins/losses = history from `bidder_state_log`.
 * **Ongoing** = lahat ng naka-queue habang **hindi pa** naka-shuffle (`shuffleLocked === false`):
 * bilang ng active list slots per IGN. Pag **shuffle na** (naka-lock), ongoing = **0** sa summary —
 * may “result” na ang round (loss/shortlist nasa log), hindi na “pre-shuffle waiting”.
 */
export function summarizeBidderStateLog(
  entries: BidderStateLogEntry[],
  shuffleLocked: boolean,
  queueByIgn: Map<string, { ign: string; count: number }>
): BidderSummaryRow[] {
  const map = new Map<string, BidderSummaryRow>();

  for (const row of entries) {
    const k = row.ign.trim().toLowerCase();
    if (!k) continue;
    const o = map.get(k) ?? {
      ign: row.ign.trim(),
      wins: 0,
      losses: 0,
      ongoing: 0,
    };
    if (row.state === BIDDER_STATE_WIN) {
      o.wins += 1;
    } else if (row.state === BIDDER_STATE_LOSS) {
      o.losses += 1;
    }
    map.set(k, o);
  }

  for (const [k, { ign, count }] of queueByIgn) {
    const o = map.get(k) ?? {
      ign,
      wins: 0,
      losses: 0,
      ongoing: 0,
    };
    o.ign = ign;
    o.ongoing = shuffleLocked ? 0 : count;
    map.set(k, o);
  }

  return [...map.values()].sort(
    (a, b) => b.wins + b.losses + b.ongoing - (a.wins + a.losses + a.ongoing)
  );
}
