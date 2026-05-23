import type { AuctionItem, AuctionState, GuildMember } from '../types';
import { ignMatchesForQueueDedupe } from './ignQueueIdentity';

/** Per active item: normalized IGNs last seen on the server (admin poll baseline). */
export type QueueBaselineByItemId = Map<string, Set<string>>;

export function buildQueueBaselineFromState(state: AuctionState): QueueBaselineByItemId {
  const members = new Map(state.members.map((m) => [m.id, m]));
  const out = new Map<string, Set<string>>();
  for (const it of state.items) {
    if (it.status !== 'active') continue;
    const igns = new Set<string>();
    for (const mid of it.interestedMemberIds) {
      const ign = members.get(mid)?.name.trim();
      if (ign) igns.add(ign);
    }
    out.set(it.id, igns);
  }
  return out;
}

function seenHasMatchingIgn(seen: Set<string>, ign: string): boolean {
  for (const x of seen) {
    if (ignMatchesForQueueDedupe(x, ign)) return true;
  }
  return false;
}

/**
 * Before admin save: keep local queue order/edits, but always union in everyone
 * currently on the server (public bids). Never drop a remote queue row because
 * of poll baseline — that was deleting public joins after admin auto-save.
 */
export function mergeQueuesForPersist(
  local: AuctionState,
  remote: AuctionState,
  _baseline?: QueueBaselineByItemId
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

    const localIds = it.interestedMemberIds;
    const remoteIds = remoteIt.interestedMemberIds;
    const remoteIdSet = new Set(remoteIds);
    const mergedIds: number[] = [];
    const seen = new Set<string>();

    const tryAppend = (mid: number) => {
      const ign = membersById.get(mid)?.name.trim();
      if (!ign || seenHasMatchingIgn(seen, ign)) return;
      seen.add(ign);
      mergedIds.push(mid);
    };

    // Local order first (admin reorder / edits).
    for (const mid of localIds) {
      tryAppend(mid);
    }

    // Always keep server/public rows (even if missing from stale local snapshot).
    for (const mid of remoteIds) {
      tryAppend(mid);
    }

    // Local-only rows not yet on server (admin just added, negative temp ids).
    for (const mid of localIds) {
      if (remoteIdSet.has(mid)) continue;
      tryAppend(mid);
    }

    return { ...it, interestedMemberIds: mergedIds };
  });

  return { ...local, members, items };
}
