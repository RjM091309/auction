import type { AuctionItem, BidderStateLogEntry, GuildMember } from '../types';
import {
  formatInstantInAuctionWeekTz,
  getAuctionWeekTimezone,
} from './auctionWeek';

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

/** One calendar day in auction TZ, newest days first in lists built by {@link buildBidderOutcomeDaysByIgnKey}. */
export type BidderDayOutcomeGroup = {
  dateKey: string;
  weekdayShort: string;
  entries: BidderStateLogEntry[];
};

/**
 * Per-IGN history for ranking drill-down: group `bidder_state_log` rows by calendar day (auction TZ).
 * Ongoing rows are omitted here (same as the weekly log list); they stay in the DB for queue/ranking logic.
 */
export function buildBidderOutcomeDaysByIgnKey(
  entries: readonly BidderStateLogEntry[]
): Map<string, BidderDayOutcomeGroup[]> {
  const tz = getAuctionWeekTimezone();
  const byIgn = new Map<string, BidderStateLogEntry[]>();
  for (const e of entries) {
    const k = e.ign.trim().toLowerCase();
    if (!k) continue;
    const arr = byIgn.get(k) ?? [];
    arr.push(e);
    byIgn.set(k, arr);
  }

  const out = new Map<string, BidderDayOutcomeGroup[]>();
  for (const [ignKey, list] of byIgn) {
    const byDay = new Map<string, BidderStateLogEntry[]>();
    for (const e of list) {
      if (e.state === BIDDER_STATE_ONGOING) continue;
      const { dateKey } = formatInstantInAuctionWeekTz(e.at, tz);
      const dayList = byDay.get(dateKey) ?? [];
      dayList.push(e);
      byDay.set(dateKey, dayList);
    }
    const days: BidderDayOutcomeGroup[] = [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([dateKey, dayEntries]) => {
        const { weekdayShort } = formatInstantInAuctionWeekTz(dayEntries[0].at, tz);
        const sorted = [...dayEntries].sort((a, b) => b.at - a.at);
        return { dateKey, weekdayShort, entries: sorted };
      });
    out.set(ignKey, days);
  }
  return out;
}

/** Same token rules as `bidderLogEntryMatchesSearch` — IGN plus Win/Loss/Ongoing counts and labels. */
export function bidderRankingRowMatchesSearch(
  row: BidderSummaryRow,
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
    String(row.wins),
    String(row.losses),
    String(row.ongoing),
    bidderStateLabel(BIDDER_STATE_WIN),
    bidderStateLabel(BIDDER_STATE_LOSS),
    bidderStateLabel(BIDDER_STATE_ONGOING),
    'ong',
  ]
    .join(' ')
    .toLowerCase();
  return tokens.every((t) => blob.includes(t));
}

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
 * **Ongoing** = bilang ng active queue slots per IGN habang bukas ang public signup.
 * Pag sarado na ang signup dahil sa shuffle lock (Guild League pagkatapos ng shuffle),
 * ongoing = **0**; sa Emperium Overrun nananatiling bukas ang signup kaya reflected pa rin ang queue.
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
