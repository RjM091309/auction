import type { AuctionItem, AuctionState, GuildMember } from '../types';

/** Prefer stable DB id over temp id; then smallest positive id, or “least negative” temp. */
function pickCanonicalMember(members: GuildMember[]): GuildMember {
  return [...members].sort((a, b) => {
    const ap = a.id > 0;
    const bp = b.id > 0;
    if (ap && !bp) return -1;
    if (!ap && bp) return 1;
    if (ap && bp) return a.id - b.id;
    return b.id - a.id;
  })[0];
}

function squeezeConsecutiveDuplicateIds(ids: number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    if (out.length > 0 && out[out.length - 1] === id) continue;
    out.push(id);
  }
  return out;
}

/**
 * Merges roster rows that share the same normalized IGN (case/spacing-insensitive).
 * Remaps queue `interestedMemberIds` to the canonical member id so one person is not
 * represented twice (fixes “Name already in use” when editing after bad imports/sync).
 */
export function dedupeRosterMembersByIgn(s: AuctionState): AuctionState {
  const keyed: GuildMember[] = [];
  const unkeyed: GuildMember[] = [];
  for (const m of s.members) {
    const k = m.name.trim().toLowerCase();
    if (!k) unkeyed.push(m);
    else keyed.push(m);
  }

  const groups = new Map<string, GuildMember[]>();
  for (const m of keyed) {
    const k = m.name.trim().toLowerCase();
    const arr = groups.get(k) ?? [];
    arr.push(m);
    groups.set(k, arr);
  }

  let hasDup = false;
  for (const [, arr] of groups) {
    if (arr.length > 1) {
      hasDup = true;
      break;
    }
  }
  if (!hasDup) return s;

  const remap = new Map<number, number>();
  const kept: GuildMember[] = [...unkeyed];
  for (const [, arr] of groups) {
    const canonical = pickCanonicalMember(arr);
    kept.push(canonical);
    for (const m of arr) {
      if (m.id !== canonical.id) remap.set(m.id, canonical.id);
    }
  }

  kept.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );

  const items: AuctionItem[] = s.items.map((it) => ({
    ...it,
    interestedMemberIds: squeezeConsecutiveDuplicateIds(
      it.interestedMemberIds.map((id) => remap.get(id) ?? id)
    ),
  }));

  return { ...s, members: kept, items };
}
