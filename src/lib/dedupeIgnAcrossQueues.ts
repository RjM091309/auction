import type { AuctionState } from '../types';
import { isAuctionItemHidden } from './hiddenAuctionItems';
import { parseGuildRank, winnerSlotsFromTotalItems } from './pageAssignment';
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
      ? computeKeptQueueMemberKeys(s0, s0.eventMode, (it) => !isAuctionItemHidden(it))
      : null;
  const keepEmperiumHidden =
    mode === 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(s0, s0.eventMode, (it) => isAuctionItemHidden(it))
      : null;
  const keepGuildVisible =
    mode !== 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(s0, s0.eventMode, (it) => !isAuctionItemHidden(it))
      : null;
  const keepGuildHidden =
    mode !== 'Emperium Overrun'
      ? computeKeptQueueMemberKeys(s0, s0.eventMode, (it) => isAuctionItemHidden(it))
      : null;

  const items = s0.items.map((it) => {
    if (it.status !== 'active') return it;
    const keep =
      mode === 'Emperium Overrun'
        ? isAuctionItemHidden(it)
          ? keepEmperiumHidden!
          : keepEmperiumVisible!
        : isAuctionItemHidden(it)
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
 * Recompute `winnerPoolCap` for Fragment Card and Feathers items based on the
 * currently-saved `rewardItemCounts` + `rewardRank`. Other types (Ancient Item,
 * Other) are untouched.
 *
 * Why: the "Winner Set Limit" modal is the source of truth for how many winners
 * each card should have, but legacy/migrated items can carry a stale
 * `winnerPoolCap` (e.g. the default 19 for Feathers from when the merger
 * deduped multiple Feathers rows but didn't re-apply the current limit).
 * Recomputing on load keeps the displayed winner count consistent with what
 * the admin saved without forcing them to re-open and re-save the modal.
 */
export function normalizeWinnerPoolCapsForLimits(s: AuctionState): AuctionState {
  const counts = s.rewardItemCounts;
  if (!counts) return s;
  const rank = parseGuildRank(s.rewardRank);
  const items = s.items.map((it) => {
    if (it.type === 'Fragment Card') {
      const totalItems =
        counts.fragmentByItemId?.[it.id] ?? counts.fragment ?? 0;
      const next = winnerSlotsFromTotalItems('Fragment Card', totalItems, rank);
      if (it.winnerPoolCap === next) return it;
      return { ...it, winnerPoolCap: next };
    }
    if (it.type === 'Feathers') {
      const next = winnerSlotsFromTotalItems('Feathers', counts.feathers ?? 0, rank);
      if (it.winnerPoolCap === next) return it;
      return { ...it, winnerPoolCap: next };
    }
    return it;
  });
  return { ...s, items };
}
