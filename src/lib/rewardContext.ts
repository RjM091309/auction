import type {
  AuctionItem,
  AuctionState,
  GuildRank,
  ItemType,
  RewardItemCounts,
  WeeklyEventType,
} from '../types';
import { buildFragmentLimitsByItemId } from './featherMigration';
import {
  parseGuildRank,
  totalItemsForTypeByRank,
  winnerSlotsFromTotalItems,
  featherItemsPerWinnerUnit,
  defaultFeathersItemsPerWinner,
} from './pageAssignment';
import { maxQueueSlotsAfterShuffle } from './shuffleCaps';

/** Guild League → Bronze; Emperium Overrun → Emperium overrun winner-set preset. */
export function guildRankForEventMode(
  eventMode?: WeeklyEventType
): GuildRank {
  return eventMode === 'Guild League' ? 'Bronze' : 'Emperium overrun';
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
  const requiredRank = guildRankForEventMode(state.eventMode);
  const persistedRank = parseGuildRank(state.rewardRank);
  const matchesMode =
    persistedRank === requiredRank && state.rewardItemCounts != null;

  const rank = matchesMode ? persistedRank : requiredRank;
  const counts = matchesMode
    ? state.rewardItemCounts!
    : presetRewardItemCounts(requiredRank, state.items);

  return { rank, counts, matchesMode, requiredRank };
}

export function totalItemsForAuctionItem(
  item: Pick<AuctionItem, 'id' | 'type'>,
  counts: RewardItemCounts
): number | null {
  if (item.type === 'Feathers') return counts.feathers ?? 0;
  if (item.type === 'Fragment Card') {
    return counts.fragmentByItemId?.[item.id] ?? counts.fragment ?? 0;
  }
  return null;
}

export function effectiveWinnerPoolCapForItem(
  item: Pick<AuctionItem, 'id' | 'type' | 'winnerPoolCap'>,
  ctx: EffectiveRewardContext
): number {
  if (item.type !== 'Fragment Card' && item.type !== 'Feathers') {
    return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
  }
  const total = totalItemsForAuctionItem(item, ctx.counts);
  if (total == null) {
    return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
  }
  return winnerSlotsFromTotalItems(item.type, total, ctx.rank, ctx.counts);
}

export function effectiveWinnerPoolCapForType(
  type: ItemType,
  ctx: EffectiveRewardContext,
  itemId?: string
): number {
  if (type === 'Feathers') {
    return winnerSlotsFromTotalItems(
      type,
      ctx.counts.feathers ?? 0,
      ctx.rank,
      ctx.counts
    );
  }
  if (type === 'Fragment Card') {
    const total =
      (itemId && ctx.counts.fragmentByItemId?.[itemId]) ??
      ctx.counts.fragment ??
      0;
    return winnerSlotsFromTotalItems(type, total, ctx.rank, ctx.counts);
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
  item: Pick<AuctionItem, 'id' | 'type' | 'winnerPoolCap'>,
  rank: GuildRank,
  counts: RewardItemCounts
): number {
  const total = totalItemsForAuctionItem(item, counts);
  if (total != null && (item.type === 'Feathers' || item.type === 'Fragment Card')) {
    return winnerSlotsFromTotalItems(item.type, total, rank, counts);
  }
  return maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
}
