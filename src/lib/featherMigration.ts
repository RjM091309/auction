import type { AuctionItem, ItemType, RewardItemCounts } from '../types';
import { sortAuctionItemsForDisplay } from './auctionItemDisplayOrder';
import { defaultWinnerPoolCapForType } from './shuffleCaps';
import { totalItemsForTypeByRank, defaultFeathersItemsPerWinner } from './pageAssignment';
import type { GuildRank } from '../types';

export const LEGACY_FEATHER_TYPES = ['LND', 'TNS'] as const;
export type LegacyFeatherType = (typeof LEGACY_FEATHER_TYPES)[number];

export function isLegacyFeatherType(t: string): t is LegacyFeatherType {
  return t === 'LND' || t === 'TNS';
}

export function isFeatherItemType(t: ItemType | string): boolean {
  return t === 'Feathers' || isLegacyFeatherType(t);
}

/** Match historical log rows and migrated item types. */
export function featherLogTypeMatches(
  itemType: string,
  filter: 'm2' | 'm3'
): boolean {
  if (filter === 'm2') {
    return itemType === 'Feathers' || itemType === 'LND' || itemType === 'TNS';
  }
  return itemType === 'TNS';
}

export function defaultFeathersItemCount(rank: GuildRank = 'Bronze'): number {
  return totalItemsForTypeByRank('Feathers', rank);
}

export function parseRewardItemCounts(
  raw: unknown,
  rank: GuildRank = 'Bronze'
): RewardItemCounts {
  const fallback: RewardItemCounts = {
    fragment: totalItemsForTypeByRank('Fragment Card', rank),
    feathers: defaultFeathersItemCount(rank),
    feathersItemsPerWinner: defaultFeathersItemsPerWinner(rank),
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const j = raw as Record<string, unknown>;
  const toInt = (v: unknown, d: number) =>
    Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d;
  const fragment = toInt(j.fragment, fallback.fragment);
  const feathersItemsPerWinner = toInt(
    j.feathersItemsPerWinner,
    defaultFeathersItemsPerWinner(rank)
  );
  let fragmentByItemId: Record<string, number> | undefined;
  const rawById = j.fragmentByItemId;
  if (rawById && typeof rawById === 'object' && !Array.isArray(rawById)) {
    const map: Record<string, number> = {};
    for (const [id, v] of Object.entries(rawById as Record<string, unknown>)) {
      if (!id) continue;
      map[id] = toInt(v, fragment);
    }
    if (Object.keys(map).length > 0) fragmentByItemId = map;
  }
  const base = {
    fragment,
    feathersItemsPerWinner,
    ...(fragmentByItemId ? { fragmentByItemId } : {}),
    ...(j.rankWinnerDouble === true ? { rankWinnerDouble: true } : {}),
  };
  if (j.feathers != null && j.feathers !== '') {
    return { ...base, feathers: toInt(j.feathers, fallback.feathers) };
  }
  const lnd = toInt(j.lnd, rank === 'Emperium overrun' ? 150 : 30);
  const tns = toInt(j.tns, rank === 'Emperium overrun' ? 170 : 50);
  return { ...base, feathers: lnd + tns };
}

/** Item slots for a specific fragment card row (falls back to shared `fragment`). */
export function fragmentCountForItem(
  counts: RewardItemCounts,
  itemId: string
): number {
  const override = counts.fragmentByItemId?.[itemId];
  if (override != null && Number.isFinite(override)) {
    return Math.max(0, Math.floor(override));
  }
  return counts.fragment;
}

export function activeFragmentAuctionItems(
  items: AuctionItem[]
): AuctionItem[] {
  return sortAuctionItemsForDisplay(
    items.filter((it) => it.status === 'active' && it.type === 'Fragment Card')
  );
}

export function buildFragmentLimitsByItemId(
  items: AuctionItem[],
  counts: RewardItemCounts
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of activeFragmentAuctionItems(items)) {
    out[it.id] = fragmentCountForItem(counts, it.id);
  }
  return out;
}

/** Merge legacy LND/TNS cards into one Feathers card; normalize existing Feathers rows. */
export function migrateFeatherItems(items: AuctionItem[]): AuctionItem[] {
  const legacy = items.filter((it) => isLegacyFeatherType(it.type));
  const existingFeathers = items.filter((it) => it.type === 'Feathers');
  const rest = items.filter(
    (it) => !isLegacyFeatherType(it.type) && it.type !== 'Feathers'
  );

  // Nothing to merge: zero or one Feathers row and no legacy LND/TNS rows.
  if (legacy.length === 0 && existingFeathers.length <= 1) {
    return [
      ...rest,
      ...existingFeathers.map((it) =>
        it.name === 'Feathers' ? it : { ...it, name: 'Feathers' }
      ),
    ];
  }

  // Build a merge-source list from every Feathers-or-legacy row, ordered
  // oldest-first so the earliest row becomes the primary survivor. This
  // covers BOTH the legacy → Feathers migration AND the duplicate-Feathers
  // case (which previously was a no-op and left two identical cards in the
  // UI).
  const sortedLegacy = [...legacy].sort(
    (a, b) => Number(a.createdAt) - Number(b.createdAt)
  );
  const allCandidates = [...sortedLegacy, ...existingFeathers].sort(
    (a, b) => Number(a.createdAt) - Number(b.createdAt)
  );
  const primary = allCandidates[0]!;
  const mergeSources = allCandidates;

  const seenMemberIds = new Set<number>();
  const mergedMemberIds: number[] = [];
  for (const it of mergeSources) {
    for (const mid of it.interestedMemberIds) {
      if (seenMemberIds.has(mid)) continue;
      seenMemberIds.add(mid);
      mergedMemberIds.push(mid);
    }
  }

  const recorded = new Set<string>();
  for (const it of mergeSources) {
    for (const n of it.recordedWinnerNames ?? []) {
      const t = n.trim();
      if (t) recorded.add(t);
    }
    const w = it.winnerName?.trim();
    if (w) recorded.add(w);
  }

  let winnerPoolCap = defaultWinnerPoolCapForType('Feathers');
  for (const it of mergeSources) {
    const cap =
      it.winnerPoolCap != null && it.winnerPoolCap !== ''
        ? Math.max(0, Math.floor(Number(it.winnerPoolCap)))
        : isLegacyFeatherType(it.type)
          ? it.type === 'LND'
            ? 7
            : 12
          : defaultWinnerPoolCapForType('Feathers');
    winnerPoolCap = Math.max(winnerPoolCap, cap);
  }

  const feathers: AuctionItem = {
    ...primary,
    id: mergeSources.some((it) => it.id === 'm2') ? 'm2' : primary.id,
    name: 'Feathers',
    type: 'Feathers',
    winnerPoolCap,
    winnerName: null,
    recordedWinnerNames:
      recorded.size > 0 ? [...recorded] : primary.recordedWinnerNames,
    status: mergeSources.some((it) => it.status === 'active')
      ? 'active'
      : primary.status,
    interestedMemberIds: mergedMemberIds,
    createdAt: primary.createdAt,
  };

  // Every non-survivor row (legacy LND/TNS AND any extra Feathers
  // duplicates) is marked cancelled so the dashboard hides it; queues and
  // recorded winners have already been merged into `feathers` above.
  const cancelledExtras = mergeSources
    .filter((it) => it.id !== feathers.id)
    .map((it) => ({ ...it, status: 'cancelled' as const }));

  return [...rest, feathers, ...cancelledExtras];
}
