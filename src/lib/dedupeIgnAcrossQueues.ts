import type { AuctionState } from '../types';
import {
  computeKeptQueueMemberKeys,
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
 * Guild League: one IGN per active item across the guild (first queue slot by item
 * order then position). Emperium Overrun: one Fragment Card + one LND/TNS allowed;
 * non-center types still one slot. Drops later duplicates (legacy / bad rows).
 */
export function dedupeIgnAcrossActiveQueues(s: AuctionState): AuctionState {
  const s0 = stripEmperiumCardQueuesAfterFragmentWeeklyWin(s);
  const keep = computeKeptQueueMemberKeys(s0, s0.eventMode);

  const items = s0.items.map((it) => {
    if (it.status !== 'active') return it;
    const newIds = it.interestedMemberIds.filter((mid) =>
      keep.has(`${it.id}\0${mid}`)
    );
    if (newIds.length === it.interestedMemberIds.length) return it;
    return { ...it, interestedMemberIds: newIds };
  });

  return { ...s0, items };
}
