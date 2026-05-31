import type { AuctionState } from '../types';
import { isAuctionItemHidden } from './hiddenAuctionItems';
import {
  resolveEffectiveRewardContext,
  effectiveWinnerPoolCapForItem,
} from './rewardContext';
import {
  computeKeptQueueMemberKeys,
  defaultEventModeForQueues,
  stripEmperiumCardQueuesAfterFragmentWeeklyWin,
} from './queueEligibility';

/** Drop queue IDs that are not in `members` (orphans from stale localStorage / bad sync). */
export function pruneOrphanQueueMembers(s: AuctionState): AuctionState {
  const ids = new Set(s.members.map((m) => m.id));
  const items = s.items.map((it) => ({
    ...it,
    interestedMemberIds: it.interestedMemberIds.filter((mid) => ids.has(mid)),
  }));
  return { ...s, items };
}

/**
 * Guild League: one IGN per **visible** active auction (first slot by item order then
 * position); hidden boards are deduped separately so a hidden queue cannot steal the
 * only public slot. Emperium Overrun: one Fragment Card + one Feathers; non-center
 * types still one slot. Drops later duplicates (legacy / bad rows).
 */
export function dedupeIgnAcrossActiveQueues(s: AuctionState): AuctionState {
  const s0 = stripEmperiumCardQueuesAfterFragmentWeeklyWin(s);
  const mode = defaultEventModeForQueues(s0.eventMode);

  const keepEmperiumVisible =
    mode === 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(
          s0,
          s0.eventMode,
          (it) => !isAuctionItemHidden(it, s0.eventMode)
        )
      : null;
  const keepEmperiumHidden =
    mode === 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(
          s0,
          s0.eventMode,
          (it) => isAuctionItemHidden(it, s0.eventMode)
        )
      : null;
  const keepGuildVisible =
    mode !== 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(
          s0,
          s0.eventMode,
          (it) => !isAuctionItemHidden(it, s0.eventMode)
        )
      : null;
  const keepGuildHidden =
    mode !== 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(
          s0,
          s0.eventMode,
          (it) => isAuctionItemHidden(it, s0.eventMode)
        )
      : null;

  const items = s0.items.map((it) => {
    if (it.status !== 'active') return it;
    const hidden = isAuctionItemHidden(it, s0.eventMode);
    const keep =
      mode === 'Emperium Overrun'
        ? hidden
          ? keepEmperiumHidden!
          : keepEmperiumVisible!
        : hidden
          ? keepGuildHidden!
          : keepGuildVisible!;
    const newIds = it.interestedMemberIds.filter((mid) =>
      keep.has(`${it.id}\0${mid}`)
    );
    if (newIds.length === it.interestedMemberIds.length) return it;
    return { ...it, interestedMemberIds: newIds };
  });

  return { ...s0, items };
}

/** Guild League: one queue slot per person. Emperium: prune orphans only. */
export function normalizeQueuesForEventMode(s: AuctionState): AuctionState {
  const pruned = pruneOrphanQueueMembers(s);
  const normalized =
    defaultEventModeForQueues(pruned.eventMode) === 'Guild League'
      ? dedupeIgnAcrossActiveQueues(pruned)
      : pruned;
  return normalizeWinnerPoolCapsForLimits(normalized);
}

/**
 * Recompute caps + reward counts from the active event mode's winner-set preset
 * (or saved limits when rank matches that mode). Keeps trophy badges in sync.
 */
export function normalizeWinnerPoolCapsForLimits(s: AuctionState): AuctionState {
  const ctx = resolveEffectiveRewardContext(s);
  const items = s.items.map((it) => {
    if (it.type !== 'Fragment Card' && it.type !== 'Feathers') return it;
    const next = effectiveWinnerPoolCapForItem(it, ctx);
    if (it.winnerPoolCap === next) return it;
    return { ...it, winnerPoolCap: next };
  });
  return {
    ...s,
    items,
    rewardRank: ctx.rank,
    rewardItemCounts: ctx.counts,
  };
}
