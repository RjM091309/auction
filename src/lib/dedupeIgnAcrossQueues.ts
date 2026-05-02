import type { AuctionState } from '../types';

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
 * One IGN per active card across the guild: keep the first queue slot (by item
 * order then position); drop later duplicates (fixes legacy / bad rows).
 */
export function dedupeIgnAcrossActiveQueues(s: AuctionState): AuctionState {
  const canonical = new Map<string, { itemId: string; mid: string }>();

  for (const it of s.items) {
    if (it.status !== 'active') continue;
    for (const mid of it.interestedMemberIds) {
      const name = s.members.find((m) => m.id === mid)?.name?.trim().toLowerCase();
      if (!name) continue;
      if (!canonical.has(name)) canonical.set(name, { itemId: it.id, mid });
    }
  }

  const items = s.items.map((it) => {
    if (it.status !== 'active') return it;
    const newIds = it.interestedMemberIds.filter((mid) => {
      const name = s.members.find((m) => m.id === mid)?.name?.trim().toLowerCase();
      if (!name) return true;
      const c = canonical.get(name);
      return c != null && c.itemId === it.id && c.mid === mid;
    });
    if (newIds.length === it.interestedMemberIds.length) return it;
    return { ...it, interestedMemberIds: newIds };
  });

  return { ...s, items };
}
