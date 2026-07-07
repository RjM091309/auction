import type { AuctionItem, GuildMember } from '../types';

/** Queue index for an IGN on this item's interested list (-1 if absent). */
export function queueIndexForIgnName(
  name: string,
  queueIds: readonly number[],
  roster: readonly Pick<GuildMember, 'id' | 'name'>[]
): number {
  const lower = name.trim().toLowerCase();
  if (!lower) return -1;
  return queueIds.findIndex((mid) => {
    const member = roster.find((m) => m.id === mid);
    return member?.name.trim().toLowerCase() === lower;
  });
}

function revokedLowerSet(revokedWinnerNames: readonly string[] | undefined): Set<string> {
  return new Set(
    (revokedWinnerNames ?? [])
      .map((n) => n.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Non-revoked shuffle-shortlist winners (top `drawSlots` rows). */
export function countActiveShuffleWinners(
  queueIds: readonly number[],
  roster: readonly Pick<GuildMember, 'id' | 'name'>[],
  drawSlots: number,
  revokedWinnerNames?: readonly string[]
): number {
  const revoked = revokedLowerSet(revokedWinnerNames);
  let n = 0;
  for (let i = 0; i < drawSlots && i < queueIds.length; i += 1) {
    const member = roster.find((mem) => mem.id === queueIds[i]);
    const nl = member?.name?.trim().toLowerCase() ?? '';
    if (nl && !revoked.has(nl)) n += 1;
  }
  return n;
}

/**
 * Manual marks outside the frozen shuffle shortlist.
 * Orphan names (no longer on this queue) are ignored — stale marks must not block new winners.
 */
export function countExtraRecordedWinners(
  recordedWinnerNames: readonly string[],
  queueIds: readonly number[],
  roster: readonly Pick<GuildMember, 'id' | 'name'>[],
  drawSlots: number,
  revokedWinnerNames?: readonly string[]
): number {
  const revoked = revokedLowerSet(revokedWinnerNames);
  let n = 0;
  for (const name of recordedWinnerNames) {
    const nl = name.trim().toLowerCase();
    if (!nl || revoked.has(nl)) continue;
    const qIdx = queueIndexForIgnName(name, queueIds, roster);
    if (qIdx < 0) continue;
    if (qIdx >= drawSlots) n += 1;
  }
  return n;
}

export function countTotalWinnersForItem(
  item: Pick<AuctionItem, 'interestedMemberIds' | 'recordedWinnerNames' | 'revokedWinnerNames'>,
  roster: readonly Pick<GuildMember, 'id' | 'name'>[],
  drawSlots: number
): number {
  const queueIds = item.interestedMemberIds ?? [];
  const recorded = item.recordedWinnerNames ?? [];
  const revoked = item.revokedWinnerNames;
  return (
    countActiveShuffleWinners(queueIds, roster, drawSlots, revoked) +
    countExtraRecordedWinners(recorded, queueIds, roster, drawSlots, revoked)
  );
}

/** Drop recorded winner names that are no longer on this item's queue. */
export function pruneOrphanRecordedWinnerNames<
  T extends Pick<AuctionItem, 'interestedMemberIds' | 'recordedWinnerNames'>,
>(item: T, roster: readonly Pick<GuildMember, 'id' | 'name'>[]): T {
  const recorded = item.recordedWinnerNames;
  if (!recorded?.length) return item;
  const queueIds = item.interestedMemberIds ?? [];
  const next = recorded.filter(
    (name) => queueIndexForIgnName(name, queueIds, roster) >= 0
  );
  if (next.length === recorded.length) return item;
  return {
    ...item,
    recordedWinnerNames: next.length > 0 ? next : undefined,
  };
}

export function pruneOrphanRecordedWinnersInState<
  S extends { items: AuctionItem[]; members: GuildMember[] },
>(state: S): S {
  let changed = false;
  const items = state.items.map((it) => {
    const pruned = pruneOrphanRecordedWinnerNames(it, state.members);
    if (pruned !== it) changed = true;
    return pruned;
  });
  return changed ? { ...state, items } : state;
}
