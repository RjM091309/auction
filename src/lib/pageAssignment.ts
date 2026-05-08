import type { GuildRank, ItemType } from '../types';

/**
 * Current game rank page pool (confirmed by user):
 * Bronze => LND=30 pages, TNS=50 pages, CARD(Fragment)=2 pages.
 */
export const GUILD_RANK_OPTIONS: GuildRank[] = ['Bronze', 'Silver', 'Gold'];

const TOTAL_ITEMS_BY_RANK_AND_TYPE: Record<GuildRank, Record<ItemType, number>> = {
  Bronze: {
    'Fragment Card': 2,
    LND: 30,
    TNS: 50,
    'Ancient Item': 1,
    Other: 1,
  },
  Silver: {
    'Fragment Card': 2,
    LND: 35,
    TNS: 60,
    'Ancient Item': 1,
    Other: 1,
  },
  Gold: {
    'Fragment Card': 4,
    LND: 40,
    TNS: 70,
    'Ancient Item': 1,
    Other: 1,
  },
};

export function totalItemsForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  return TOTAL_ITEMS_BY_RANK_AND_TYPE[rank]?.[type] ?? 1;
}

/** Game rule: 4 items per page. */
export function totalPagesForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  const items = totalItemsForTypeByRank(type, rank);
  if (type === 'LND' || type === 'TNS') {
    // Feathers: only full pages count as winner slots.
    return Math.max(0, Math.floor(items / 4));
  }
  return Math.max(1, Math.ceil(items / 4));
}

export function freeItemsForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  if (type !== 'LND' && type !== 'TNS') return 0;
  const items = totalItemsForTypeByRank(type, rank);
  return Math.max(0, items % 4);
}

export function freePageInfoForTypeByRank(
  type: ItemType,
  rank: GuildRank = 'Bronze',
  pageStart = 1
): { pageLabel: string; freeItems: number } | null {
  const freeItems = freeItemsForTypeByRank(type, rank);
  if (freeItems <= 0) return null;
  const fullPages = totalPagesForTypeByRank(type, rank);
  const freePage = pageStart + fullPages;
  return { pageLabel: `P${freePage}`, freeItems };
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

  if (type === 'LND' || type === 'TNS') {
    // Feathers: page pool is fixed by rank; if bidders are fewer,
    // divide pages across available winning bidders.
    const totalPages = totalPagesForTypeByRank(type, rank);
    const winningBidders =
      bidders == null ? totalPages : Math.min(totalPages, bidders);
    if (winningBidders <= 0) return [];
    const ranges = computeWinnerPageRanges(totalPages, winningBidders);
    return ranges.map((r) =>
      r.start === r.end
        ? `P${pageStart + r.start - 1}`
        : `P${pageStart + r.start - 1}-${pageStart + r.end - 1}`
    );
  }

  if (type === 'Fragment Card') {
    // Rule: 1 winner per item (not page).
    const totalItems = totalItemsForTypeByRank(type, rank);
    const winners =
      bidders == null ? Math.max(0, totalItems) : Math.min(Math.max(0, totalItems), bidders);
    return Array.from({ length: winners }, (_v, i) => `I${i + 1}`);
  }

  // Fallback: page-based single page labels.
  const totalPages = totalPagesForTypeByRank(type, rank);
  const winners =
    bidders == null ? Math.max(0, totalPages) : Math.min(Math.max(0, totalPages), bidders);
  return Array.from({ length: winners }, (_v, i) => `P${pageStart + i}`);
}

