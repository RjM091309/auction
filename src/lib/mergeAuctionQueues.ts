import type { AuctionItem, AuctionState, GuildMember } from '../types';

/** Per active item: normalized IGNs last seen on the server (admin poll baseline). */
export type QueueBaselineByItemId = Map<string, Set<string>>;

export function buildQueueBaselineFromState(state: AuctionState): QueueBaselineByItemId {
  const members = new Map(state.members.map((m) => [m.id, m]));
  const out = new Map<string, Set<string>>();
  for (const it of state.items) {
    if (it.status !== 'active') continue;
    const igns = new Set<string>();
    for (const mid of it.interestedMemberIds) {
      const ign = members.get(mid)?.name.trim().toLowerCase();
      if (ign) igns.add(ign);
    }
    out.set(it.id, igns);
  }
  return out;
}

function memberNameById(members: Map<number, GuildMember>, mid: number): string {
  return members.get(mid)?.name.trim().toLowerCase() ?? '';
}

/**
 * Before admin save: keep local queue edits (including removals), but pull in
 * brand-new public bids that appeared on the server after the last poll baseline.
 */
export function mergeQueuesForPersist(
  local: AuctionState,
  remote: AuctionState,
  baseline: QueueBaselineByItemId
): AuctionState {
  const membersById = new Map<number, GuildMember>();
  for (const m of remote.members) membersById.set(m.id, m);
  for (const m of local.members) membersById.set(m.id, m);
  const members = [...membersById.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const items: AuctionItem[] = local.items.map((it) => {
    const remoteIt = remote.items.find((r) => r.id === it.id);
    if (!remoteIt || it.status !== 'active') return it;

    const baseIgns = baseline.get(it.id) ?? new Set<string>();
    const mergedIds: number[] = [];
    const seen = new Set<string>();

    const append = (ids: number[]) => {
      for (const mid of ids) {
        const ign = memberNameById(membersById, mid);
        if (!ign || seen.has(ign)) continue;
        seen.add(ign);
        mergedIds.push(mid);
      }
    };

    append(it.interestedMemberIds);

    for (const mid of remoteIt.interestedMemberIds) {
      const ign = memberNameById(membersById, mid);
      if (!ign || seen.has(ign)) continue;
      if (baseIgns.has(ign)) continue;
      seen.add(ign);
      mergedIds.push(mid);
    }

    return { ...it, interestedMemberIds: mergedIds };
  });

  return { ...local, members, items };
}
