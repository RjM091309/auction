import type {
  AuctionItem,
  AuctionState,
  GuildRank,
  ItemType,
  RewardItemCounts,
  WeeklyEventType,
} from '../types';
import { buildFragmentLimitsByItemId, activeFragmentAuctionItems } from './featherMigration';
import { isIllusionFragmentItem } from './hiddenAuctionItems';
import {
  parseGuildRank,
  isGuildLeagueRank,
  totalItemsForTypeByRank,
  winnerSlotsFromTotalItems,
  featherItemsPerWinnerUnit,
  defaultFeathersItemsPerWinner,
} from './pageAssignment';
import { maxQueueSlotsAfterShuffle } from './shuffleCaps';

/** Default winner-set rank when none saved: Guild League → Bronze; Emperium Overrun → Emperium overrun. */
export function guildRankForEventMode(
  eventMode?: WeeklyEventType
): GuildRank {
  return eventMode === 'Guild League' ? 'Bronze' : 'Emperium overrun';
}

export function isRankValidForEventMode(
  rank: GuildRank,
  eventMode?: WeeklyEventType
): boolean {
  if (eventMode === 'Guild League') return isGuildLeagueRank(rank);
  return rank === 'Emperium overrun';
}

export function presetRewardItemCounts(
  rank: GuildRank,
  items?: readonly Pick<AuctionItem, 'id' | 'type' | 'status'>[]
): RewardItemCounts {
  const fragment = totalItemsForTypeByRank('Fragment Card', rank);
  const feathers = totalItemsForTypeByRank('Feathers', rank);
  const activeItems = (items ?? []).filter(
    (it) => it.status === 'active'
  ) as AuctionItem[];
  const fragmentByItemId = buildFragmentLimitsByItemId(activeItems, {
    fragment,
    feathers,
  });
  return {
    fragment,
    feathers,
    feathersItemsPerWinner: defaultFeathersItemsPerWinner(rank),
    ...(Object.keys(fragmentByItemId).length > 0 ? { fragmentByItemId } : {}),
  };
}

export type EffectiveRewardContext = {
  rank: GuildRank;
  counts: RewardItemCounts;
  /** Persisted rewardRank matches the active event mode's preset rank. */
  matchesMode: boolean;
  requiredRank: GuildRank;
};

/** Winner badge / pool caps follow event mode when saved limits are for the other mode. */
export function resolveEffectiveRewardContext(
  state: Pick<
    AuctionState,
    'eventMode' | 'rewardRank' | 'rewardItemCounts' | 'items'
  >
): EffectiveRewardContext {
  const defaultRank = guildRankForEventMode(state.eventMode);
  const persistedRank = parseGuildRank(state.rewardRank);
  const matchesMode =
    isRankValidForEventMode(persistedRank, state.eventMode) &&
    state.rewardItemCounts != null;

  const rank = matchesMode ? persistedRank : defaultRank;
  const counts = matchesMode
    ? state.rewardItemCounts!
    : presetRewardItemCounts(defaultRank, state.items);

  return { rank, counts, matchesMode, requiredRank: defaultRank };
}

export function rankWinnerDoubleActive(
  counts: Pick<RewardItemCounts, 'rankWinnerDouble'>
): boolean {
  return counts.rankWinnerDouble === true;
}

/**
 * Older saves kept base preset numbers in DB while rankWinnerDouble applied ×2 at
 * read time. New saves store the doubled field values directly — upgrade once on load.
 */
export function upgradeLegacyRankWinnerCounts(
  counts: RewardItemCounts,
  rank: GuildRank,
  items: readonly Pick<AuctionItem, 'id' | 'name' | 'type' | 'status'>[]
): RewardItemCounts {
  if (!rankWinnerDoubleActive(counts)) return counts;

  const presetFeathers = totalItemsForTypeByRank('Feathers', rank);
  const presetFragment = totalItemsForTypeByRank('Fragment Card', rank);

  // Already stored as doubled totals (new Winner Settings flow).
  if (counts.feathers !== presetFeathers) return counts;

  const fragmentByItemId = { ...(counts.fragmentByItemId ?? {}) };
  for (const card of activeFragmentAuctionItems(items as AuctionItem[])) {
    if (isIllusionFragmentItem(card)) continue;
    const base = fragmentByItemId[card.id] ?? counts.fragment ?? presetFragment;
    if (base === presetFragment) {
      fragmentByItemId[card.id] = base * 2;
    }
  }

  return {
    ...counts,
    feathers: counts.feathers * 2,
    fragment:
      counts.fragment === presetFragment ? counts.fragment * 2 : counts.fragment,
    ...(Object.keys(fragmentByItemId).length > 0 ? { fragmentByItemId } : {}),
  };
}

/** Base fragment count for one card row (before rank-winner ×2). */
export function baseFragmentCountForItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'name'>,
  counts: RewardItemCounts
): number {
  if (item.type !== 'Fragment Card') return 0;
  return counts.fragmentByItemId?.[item.id] ?? counts.fragment ?? 0;
}

/** Fragment item count as stored (rank-winner ×2 is applied in the form fields). */
export function effectiveFragmentCountForItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'name'>,
  counts: RewardItemCounts
): number {
  return baseFragmentCountForItem(item, counts);
}

/** Feathers total as stored (rank-winner ×2 is applied in the form fields). */
export function effectiveFeathersTotal(counts: RewardItemCounts): number {
  return counts.feathers ?? 0;
}

/** Feathers items per winning bidder — not affected by rank-winner ×2. */
export function effectiveFeathersItemsPerWinner(
  rank: GuildRank,
  counts: RewardItemCounts
): number {
  return featherItemsPerWinnerUnit(rank, counts);
}

/** Counts shape passed into winner-slot math (per-winner unchanged by rank-winner). */
export function winnerSlotCountsAdjust(
  rank: GuildRank,
  counts: RewardItemCounts
): Pick<RewardItemCounts, 'feathersItemsPerWinner'> {
  return {
    feathersItemsPerWinner: effectiveFeathersItemsPerWinner(rank, counts),
  };
}

export function totalItemsForAuctionItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'name'>,
  counts: RewardItemCounts
): number | null {
  if (item.type === 'Feathers') return effectiveFeathersTotal(counts);
  if (item.type === 'Fragment Card') {
    return effectiveFragmentCountForItem(item, counts);
  }
  return null;
}

export function effectiveWinnerPoolCapForItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'name' | 'winnerPoolCap'>,
  ctx: EffectiveRewardContext
): number {
  if (item.type !== 'Fragment Card' && item.type !== 'Feathers') {
    return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
  }
  const total = totalItemsForAuctionItem(item, ctx.counts);
  if (total == null) {
    return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
  }
  return winnerSlotsFromTotalItems(
    item.type,
    total,
    ctx.rank,
    winnerSlotCountsAdjust(ctx.rank, ctx.counts)
  );
}

export function effectiveWinnerPoolCapForType(
  type: ItemType,
  ctx: EffectiveRewardContext,
  itemId?: string,
  itemName?: string
): number {
  const slotCounts = winnerSlotCountsAdjust(ctx.rank, ctx.counts);
  if (type === 'Feathers') {
    return winnerSlotsFromTotalItems(
      type,
      ctx.counts.feathers ?? 0,
      ctx.rank,
      slotCounts
    );
  }
  if (type === 'Fragment Card') {
    const total = effectiveFragmentCountForItem(
      { id: itemId ?? '', type: 'Fragment Card', name: itemName ?? '' },
      ctx.counts
    );
    return winnerSlotsFromTotalItems(type, total, ctx.rank, slotCounts);
  }
  return maxQueueSlotsAfterShuffle(type, null);
}

/** Items per Feathers winner for the active event mode (configurable in Winner set limit). */
export function featherItemsPerWinnerForEventMode(
  eventMode?: WeeklyEventType,
  counts?: Pick<RewardItemCounts, 'feathersItemsPerWinner'> | null
): number {
  return featherItemsPerWinnerUnit(guildRankForEventMode(eventMode), counts);
}

/** Winner shortlist size from limits + rank. */
export function displayWinnerPoolCapForItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'name' | 'winnerPoolCap'>,
  rank: GuildRank,
  counts: RewardItemCounts
): number {
  const total = totalItemsForAuctionItem(item, counts);
  if (total != null && (item.type === 'Feathers' || item.type === 'Fragment Card')) {
    return winnerSlotsFromTotalItems(
      item.type,
      total,
      rank,
      winnerSlotCountsAdjust(rank, counts)
    );
  }
  return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
}
