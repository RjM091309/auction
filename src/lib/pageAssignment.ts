import type { GuildRank, ItemType } from '../types';

/**
 * Current game reward presets by rank:
 * Bronze => Card=2, LND=30, TNS=50 items; Emperium overrun => Card=20, LND=150, TNS=170.
 */
/** Ranks shown in Winner set limit (Bronze guild rewards vs Emperium overrun). */
export const GUILD_RANK_OPTIONS: GuildRank[] = ['Bronze', 'Emperium overrun'];

const TOTAL_ITEMS_BY_RANK_AND_TYPE: Record<GuildRank, Record<ItemType, number>> = {
  Bronze: {
    'Fragment Card': 2,
    LND: 30,
    TNS: 50,
    'Ancient Item': 1,
    Other: 1,
  },
  'Emperium overrun': {
    'Fragment Card': 20,
    LND: 150,
    TNS: 170,
    'Ancient Item': 1,
    Other: 1,
  },
};

/** Normalize persisted / API rank strings (legacy Silver/Gold → Bronze). */
export function parseGuildRank(v: unknown): GuildRank {
  if (v === 'Emperium overrun') return 'Emperium overrun';
  return 'Bronze';
}

export function totalItemsForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  return TOTAL_ITEMS_BY_RANK_AND_TYPE[rank]?.[type] ?? 1;
}

/** LND/TNS: items per full winner slot (page unit). Emperium overrun uses 8; guild rank uses 4. */
export function featherItemsPerWinnerUnit(rank: GuildRank): number {
  return rank === 'Emperium overrun' ? 8 : 4;
}

/** Game rule: feather types use 4 (Bronze) or 8 (Emperium overrun) items per winner slot. */
export function totalPagesForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  const items = totalItemsForTypeByRank(type, rank);
  if (type === 'LND' || type === 'TNS') {
    const u = featherItemsPerWinnerUnit(rank);
    return Math.max(0, Math.floor(items / u));
  }
  return Math.max(1, Math.ceil(items / 4));
}

export function freeItemsForTypeByRank(type: ItemType, rank: GuildRank = 'Bronze'): number {
  if (type !== 'LND' && type !== 'TNS') return 0;
  const items = totalItemsForTypeByRank(type, rank);
  const u = featherItemsPerWinnerUnit(rank);
  return Math.max(0, items % u);
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

export function winnerSlotsFromTotalItems(
  type: ItemType,
  totalItems: number,
  rank: GuildRank = 'Bronze'
): number {
  const n = Math.max(0, Math.floor(totalItems));
  if (type === 'LND' || type === 'TNS') {
    const u = featherItemsPerWinnerUnit(rank);
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
  rank: GuildRank = 'Bronze'
): number {
  if (type !== 'LND' && type !== 'TNS') return 0;
  const n = Math.max(0, Math.floor(totalItems));
  const u = featherItemsPerWinnerUnit(rank);
  return n % u;
}

/** Tooltip for shortlist badges (LND/TNS page ranges, Fragment I# per page + general P#, etc.). */
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
  if (s.startsWith('P')) {
    return `Assigned page ${s.slice(1)}`;
  }
  return s;
}

export function computeWinnerAssignmentLabelsFromItems(
  type: ItemType,
  totalItems: number,
  bidderCount: number,
  pageStart = 1,
  rank: GuildRank = 'Bronze'
): string[] {
  const bidders = Math.max(0, Math.floor(bidderCount));
  if (bidders <= 0) return [];
  if (type === 'LND' || type === 'TNS') {
    const totalPages = winnerSlotsFromTotalItems(type, totalItems, rank);
    const winningBidders = Math.min(totalPages, bidders);
    if (winningBidders <= 0) return [];
    const ranges = computeWinnerPageRanges(totalPages, winningBidders);
    return ranges.map((r) =>
      r.start === r.end
        ? `P${pageStart + r.start - 1}`
        : `P${pageStart + r.start - 1}-${pageStart + r.end - 1}`
    );
  }
  if (type === 'Fragment Card') {
    const winners = Math.min(winnerSlotsFromTotalItems(type, totalItems, rank), bidders);
    if (winners <= 0) return [];
    return Array.from({ length: winners }, (_v, i) => {
      const slotOnPage = (i % 4) + 1;
      const pageRel = Math.floor(i / 4);
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
    const totalItems = totalItemsForTypeByRank(type, rank);
    const winners =
      bidders == null ? Math.max(0, totalItems) : Math.min(Math.max(0, totalItems), bidders);
    if (winners <= 0) return [];
    return Array.from({ length: winners }, (_v, i) => {
      const slotOnPage = (i % 4) + 1;
      const pageRel = Math.floor(i / 4);
      return `I${slotOnPage} - P${pageStart + pageRel}`;
    });
  }

  // Fallback: page-based single page labels.
  const totalPages = totalPagesForTypeByRank(type, rank);
  const winners =
    bidders == null ? Math.max(0, totalPages) : Math.min(Math.max(0, totalPages), bidders);
  return Array.from({ length: winners }, (_v, i) => `P${pageStart + i}`);
}

