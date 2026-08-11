import type { AuctionItem, GuildRank, ItemType, RewardItemCounts } from '../types';
import { isIllusionFragmentItem } from './hiddenAuctionItems';

/**
 * Current game reward presets by rank:
 * Bronze => Puppet=2, Illu=2, Feathers=80; Silver => Puppet=2, Illu=2, Feathers=95;
 * Gold => Puppet=4, Illu=2, Feathers=110; Platinum => Puppet=5, Illu=2, Feathers=125;
 * Emperium overrun => Card=20, Feathers=320.
 */
/** Ranks shown in Winner set limit (Guild League tiers + Emperium overrun). */
export const GUILD_RANK_OPTIONS: GuildRank[] = [
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'The Chosen One',
  'Emperium overrun',
];

/** Guild League winner-set presets. */
export const GUILD_LEAGUE_RANKS: GuildRank[] = [
  'Bronze',
  'Silver',
  'Gold',
  'Platinum',
  'The Chosen One',
];

export function isGuildLeagueRank(rank: GuildRank): boolean {
  return (
    rank === 'Bronze' ||
    rank === 'Silver' ||
    rank === 'Gold' ||
    rank === 'Platinum' ||
    rank === 'The Chosen One'
  );
}

const TOTAL_ITEMS_BY_RANK_AND_TYPE: Record<GuildRank, Record<ItemType, number>> = {
  Bronze: {
    'Fragment Card': 2,
    Feathers: 80,
    'Ancient Item': 1,
    Other: 1,
  },
  Silver: {
    'Fragment Card': 2,
    Feathers: 95,
    'Ancient Item': 1,
    Other: 1,
  },
  Gold: {
    'Fragment Card': 4,
    Feathers: 110,
    'Ancient Item': 1,
    Other: 1,
  },
  Platinum: {
    'Fragment Card': 5,
    Feathers: 125,
    'Ancient Item': 1,
    Other: 1,
  },
  'The Chosen One': {
    'Fragment Card': 19,
    Feathers: 180,
    'Ancient Item': 1,
    Other: 1,
  },
  'Emperium overrun': {
    'Fragment Card': 20,
    Feathers: 320,
    'Ancient Item': 1,
    Other: 1,
  },
};

/** Normalize persisted / API rank strings. */
export function parseGuildRank(v: unknown): GuildRank {
  if (v === 'Emperium overrun') return 'Emperium overrun';
  if (v === 'The Chosen One') return 'The Chosen One';
  if (v === 'Platinum') return 'Platinum';
  if (v === 'Gold') return 'Gold';
  if (v === 'Silver') return 'Silver';
  if (v === 'Bronze') return 'Bronze';
  return 'Bronze';
}

/** Per-card fragment preset (Puppet vs Illusion differ on Gold / Platinum). */
export function defaultFragmentCountForItem(
  rank: GuildRank,
  item: Pick<AuctionItem, 'id' | 'name'>
): number {
  if (isIllusionFragmentItem(item)) {
    if (rank === 'Gold' || rank === 'Platinum') return 2;
    if (rank === 'The Chosen One') return 5;
    return totalItemsForTypeByRank('Fragment Card', rank);
  }
  if (rank === 'Gold') return 4;
  if (rank === 'Platinum') return 5;
  if (rank === 'The Chosen One') return 19;
  return totalItemsForTypeByRank('Fragment Card', rank);
}

export function totalItemsForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  return TOTAL_ITEMS_BY_RANK_AND_TYPE[rank]?.[type] ?? 1;
}

/** Feathers: default items per winning bidder by rank preset. */
export function defaultFeathersItemsPerWinner(rank: GuildRank): number {
  if (rank === 'Emperium overrun') return 13;
  if (rank === 'The Chosen One') return 18;
  if (rank === 'Platinum') return 12;
  if (rank === 'Gold') return 10;
  if (rank === 'Silver') return 9;
  return 8;
}

/** Feathers: items per winning bidder (configurable via Winner set limit). */
export function featherItemsPerWinnerUnit(
  rank: GuildRank,
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  const override = counts?.feathersItemsPerWinner;
  if (override != null && Number.isFinite(override) && override > 0) {
    return Math.max(1, Math.floor(override));
  }
  return defaultFeathersItemsPerWinner(rank);
}

/** Fragment cards: items per winning bidder (Emperium = 1 card each). */
export function fragmentItemsPerWinner(rank: GuildRank): number {
  return rank === 'Emperium overrun' ? 1 : 1;
}

/** Game rule: Feathers winner slots = floor(totalItems / itemsPerWinner). */
export function totalPagesForTypeByRank(
  type: ItemType,
  rank: GuildRank = 'Bronze',
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  const items = totalItemsForTypeByRank(type, rank);
  if (type === 'Feathers') {
    const u = featherItemsPerWinnerUnit(rank, counts);
    return Math.max(0, Math.floor(items / u));
  }
  return Math.max(1, Math.ceil(items / 4));
}

export function freeItemsForTypeByRank(
  type: ItemType,
  rank: GuildRank = 'Bronze',
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  if (type !== 'Feathers') return 0;
  const items = totalItemsForTypeByRank(type, rank);
  const u = featherItemsPerWinnerUnit(rank, counts);
  return Math.max(0, items % u);
}

export function freePageInfoForTypeByRank(
  type: ItemType,
  rank: GuildRank = 'Bronze',
  pageStart = 1
): { pageLabel: string; freeItems: number } | null {
  const freeItems = freeItemsForTypeByRank(type, rank);
  if (freeItems <= 0) return null;
  const items = totalItemsForTypeByRank(type, rank);
  const offset = featherPageCountBeforePartialFree(type, items, rank);
  const freePage = pageStart + offset;
  return { pageLabel: `P${freePage}`, freeItems };
}

export function winnerSlotsFromTotalItems(
  type: ItemType,
  totalItems: number,
  rank: GuildRank = 'Bronze',
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  const n = Math.max(0, Math.floor(totalItems));
  if (type === 'Feathers') {
    const u = featherItemsPerWinnerUnit(rank, counts);
    return Math.max(0, Math.floor(n / u));
  }
  if (type === 'Fragment Card') return n;
  return Math.max(1, Math.ceil(n / 4));
}

/** General P slots consumed by a Fragment pool (4 item slots per page). */
export function fragmentGeneralPageSpan(totalItems: number): number {
  const n = Math.max(0, Math.floor(totalItems));
  if (n <= 0) return 0;
  return Math.ceil(n / 4);
}

export function freeItemsFromTotalItems(
  type: ItemType,
  totalItems: number,
  rank: GuildRank = 'Bronze',
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  if (type !== 'Feathers') return 0;
  const n = Math.max(0, Math.floor(totalItems));
  const u = featherItemsPerWinnerUnit(rank, counts);
  return n % u;
}

/**
 * How many general feather “P#” steps (each P = one 4-item page) come **before** the leftover partial-free block.
 * Emperium Overrun: each winner spans ceil(13/4) consecutive P-pages; Bronze: one P per 4-item slot.
 */
export function featherPageCountBeforePartialFree(
  type: ItemType,
  totalItems: number,
  rank: GuildRank,
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  if (type !== 'Feathers') return 0;
  const slots = winnerSlotsFromTotalItems(type, totalItems, rank, counts);
  if (rank === 'Emperium overrun') {
    return slots * Math.ceil(featherItemsPerWinnerUnit(rank, counts) / 4);
  }
  return slots;
}

/**
 * Consecutive general “P#” slots (each P = one 4-item page) this feather pool occupies.
 * Advances the shared Fragment+Feathers counter so the next item’s labels do not overlap.
 */
export function featherRewardSpanFourItemPages(type: ItemType, totalItems: number): number {
  if (type !== 'Feathers') return 0;
  const n = Math.max(0, Math.floor(totalItems));
  return Math.ceil(n / 4);
}

/** Tooltip for shortlist badges (Feathers page ranges, Fragment I# per page + general P#, etc.). */
export function winnerAssignmentLabelTitle(label: string): string {
  const s = label.trim();
  const fragHyphen = /^I(\d+)\s*-\s*P(\d+)$/.exec(s);
  if (fragHyphen) {
    return `Item slot ${fragHyphen[1]} on general page ${fragHyphen[2]}`;
  }
  const fragDot = /^I(\d+)\s*·\s*P(\d+)$/.exec(s);
  if (fragDot) {
    return `Item slot ${fragDot[1]} on general page ${fragDot[2]}`;
  }
  if (/^I\d+$/.test(s)) {
    return `Assigned item slot ${s.slice(1)}`;
  }
  const featherPair = /^P(\d+)-P(\d+)$/.exec(s);
  if (featherPair) {
    const lo = Number(featherPair[1]);
    const hi = Number(featherPair[2]);
    const pages = Number.isFinite(lo) && Number.isFinite(hi) ? hi - lo + 1 : 0;
    const items = pages > 0 ? pages * 4 : 0;
    return `Winner draw: general pages ${featherPair[1]}–${featherPair[2]} (${items} item slots at 4 per page; Emperium winners get 13 items when this span covers 4 pages).`;
  }
  if (s.startsWith('P')) {
    return `Assigned page ${s.slice(1)}`;
  }
  return s;
}

/**
 * Display label for the leftover partial feather page (free pool).
 * Prefix “+” so it is not mistaken for winner shortlist badges, which use plain “P#”.
 */
export function formatFreePoolPageDisplay(pageLabel: string): string {
  const t = pageLabel.trim();
  if (/^P\d+$/i.test(t)) return `+${t}`;
  return t;
}

/** Tooltip for free-pool page badge (distinct from winner “Assigned page” tooltips). */
export function freePoolPageLabelTitle(pageLabel: string): string {
  const t = pageLabel.trim();
  if (/^P\d+$/i.test(t)) {
    const n = t.slice(1);
    return `Leftover partial page on general page ${n} (${formatFreePoolPageDisplay(t)}). The “+” marks the free pool, not the same meaning as a winner row “${t}” badge on another card.`;
  }
  return `Partial free pool (${t})`;
}

export function computeWinnerAssignmentLabelsFromItems(
  type: ItemType,
  totalItems: number,
  bidderCount: number,
  pageStart = 1,
  rank: GuildRank = 'Bronze',
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): string[] {
  const bidders = Math.max(0, Math.floor(bidderCount));
  if (bidders <= 0) return [];
  if (type === 'Feathers') {
    const totalSlots = winnerSlotsFromTotalItems(type, totalItems, rank, counts);
    const winningBidders = Math.min(totalSlots, bidders);
    if (winningBidders <= 0) return [];
    if (rank === 'Emperium overrun') {
      const itemsPerWinner = featherItemsPerWinnerUnit(rank, counts);
      const pagesEach = Math.max(1, Math.ceil(itemsPerWinner / 4));
      return Array.from({ length: winningBidders }, (_, i) => {
        const pLo = pageStart + pagesEach * i;
        const pHi = pLo + pagesEach - 1;
        return pLo === pHi ? `P${pLo}` : `P${pLo}-P${pHi}`;
      });
    }
    const ranges = computeWinnerPageRanges(totalSlots, winningBidders);
    return ranges.map((r) =>
      r.start === r.end
        ? `P${pageStart + r.start - 1}`
        : `P${pageStart + r.start - 1}-${pageStart + r.end - 1}`
    );
  }
  if (type === 'Fragment Card') {
    const winners = Math.min(winnerSlotsFromTotalItems(type, totalItems, rank), bidders);
    if (winners <= 0) return [];
    const perWinner = fragmentItemsPerWinner(rank);
    return Array.from({ length: winners }, (_v, i) => {
      const pageRel = Math.floor((i * perWinner) / 4);
      if (rank === 'Emperium overrun' && perWinner === 1) {
        const slotOnPage = (i % 4) + 1;
        return `I${slotOnPage} · P${pageStart + pageRel}`;
      }
      const slotOnPage = ((i * perWinner) % 4) + 1;
      return `I${slotOnPage} - P${pageStart + pageRel}`;
    });
  }
  const totalPages = winnerSlotsFromTotalItems(type, totalItems, rank);
  const winners = Math.min(totalPages, bidders);
  return Array.from({ length: winners }, (_v, i) => `P${pageStart + i}`);
}

export function computeWinnerPageRanges(
  totalPages: number,
  winnerCount: number
): Array<{ start: number; end: number }> {
  if (totalPages <= 0 || winnerCount <= 0) return [];
  const basePages = Math.floor(totalPages / winnerCount);
  const remainder = totalPages % winnerCount;
  const out: Array<{ start: number; end: number }> = [];
  let nextPage = 1;
  for (let i = 0; i < winnerCount; i += 1) {
    const pagesForThisWinner = basePages + (i < remainder ? 1 : 0);
    const start = nextPage;
    const end = start + pagesForThisWinner - 1;
    out.push({ start, end });
    nextPage = end + 1;
  }
  return out;
}

export function computeWinnerAssignmentLabels(
  type: ItemType,
  rank: GuildRank,
  pageStart = 1,
  bidderCount?: number
): string[] {
  const bidders =
    typeof bidderCount === 'number' && Number.isFinite(bidderCount)
      ? Math.max(0, Math.floor(bidderCount))
      : null;

  if (type === 'Feathers') {
    const totalSlots = totalPagesForTypeByRank(type, rank);
    const winningBidders =
      bidders == null ? totalSlots : Math.min(totalSlots, bidders);
    if (winningBidders <= 0) return [];
    if (rank === 'Emperium overrun') {
      const itemsPerWinner = featherItemsPerWinnerUnit(rank);
      const pagesEach = Math.max(1, Math.ceil(itemsPerWinner / 4));
      return Array.from({ length: winningBidders }, (_, i) => {
        const pLo = pageStart + pagesEach * i;
        const pHi = pLo + pagesEach - 1;
        return pLo === pHi ? `P${pLo}` : `P${pLo}-P${pHi}`;
      });
    }
    const ranges = computeWinnerPageRanges(totalSlots, winningBidders);
    return ranges.map((r) =>
      r.start === r.end
        ? `P${pageStart + r.start - 1}`
        : `P${pageStart + r.start - 1}-${pageStart + r.end - 1}`
    );
  }

  if (type === 'Fragment Card') {
    const totalItems = totalItemsForTypeByRank(type, rank);
    const winners =
      bidders == null ? Math.max(0, totalItems) : Math.min(Math.max(0, totalItems), bidders);
    if (winners <= 0) return [];
    const perWinner = fragmentItemsPerWinner(rank);
    return Array.from({ length: winners }, (_v, i) => {
      const pageRel = Math.floor((i * perWinner) / 4);
      if (rank === 'Emperium overrun' && perWinner === 1) {
        const slotOnPage = (i % 4) + 1;
        return `I${slotOnPage} · P${pageStart + pageRel}`;
      }
      const slotOnPage = ((i * perWinner) % 4) + 1;
      return `I${slotOnPage} - P${pageStart + pageRel}`;
    });
  }

  // Fallback: page-based single page labels.
  const totalPages = totalPagesForTypeByRank(type, rank);
  const winners =
    bidders == null ? Math.max(0, totalPages) : Math.min(Math.max(0, totalPages), bidders);
  return Array.from({ length: winners }, (_v, i) => `P${pageStart + i}`);
}

