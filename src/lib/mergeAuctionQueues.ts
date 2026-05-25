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
 * Before admin save: keep local queue order/edits, union in NEW public bids
 * the server has seen since our last sync, and honor admin removals/moves.
 *
 * The `baseline` (IGNs per item as of the last admin↔server sync) is the
 * source of truth that lets us distinguish:
 *   • Server row that was here AT baseline AND no longer in local =
 *     intentional admin removal/move → drop it.
 *   • Server row that is NOT in baseline = brand-new public bid that
 *     arrived after our last sync → keep it (this is the bug the old
 *     "always union remote" rule was protecting against).
 */
export function mergeQueuesForPersist(
  local: AuctionState,
  remote: AuctionState,
  baseline?: QueueBaselineByItemId
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
    const localIdSet = new Set(localIds);
    const remoteIdSet = new Set(remoteIds);
    const baselineIgns = baseline?.get(it.id) ?? new Set<string>();
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

    // Server rows: keep only those that the admin didn't intentionally
    // remove. A row is an admin removal iff it was on this item at the
    // last server sync AND is missing from `local` now. Anything else is
    // either still in `local` (already appended above) or a brand-new
    // public bid that should be preserved.
    for (const mid of remoteIds) {
      if (localIdSet.has(mid)) continue;
      const ign = membersById.get(mid)?.name.trim();
      if (ign && seenHasMatchingIgn(baselineIgns, ign)) continue;
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
