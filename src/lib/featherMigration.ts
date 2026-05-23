import type { AuctionItem, ItemType, RewardItemCounts } from '../types';
import { defaultWinnerPoolCapForType } from './shuffleCaps';
import { totalItemsForTypeByRank } from './pageAssignment';
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
  };
  if (!raw || typeof raw !== 'object') return fallback;
  const j = raw as Record<string, unknown>;
  const toInt = (v: unknown, d: number) =>
    Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d;
  const fragment = toInt(j.fragment, fallback.fragment);
  if (j.feathers != null && j.feathers !== '') {
    return { fragment, feathers: toInt(j.feathers, fallback.feathers) };
  }
  const lnd = toInt(j.lnd, rank === 'Emperium overrun' ? 150 : 30);
  const tns = toInt(j.tns, rank === 'Emperium overrun' ? 170 : 50);
  return { fragment, feathers: lnd + tns };
}

/** Merge legacy LND/TNS cards into one Feathers card; normalize existing Feathers rows. */
export function migrateFeatherItems(items: AuctionItem[]): AuctionItem[] {
  const legacy = items.filter((it) => isLegacyFeatherType(it.type));
  const existingFeathers = items.filter((it) => it.type === 'Feathers');
  const rest = items.filter(
    (it) => !isLegacyFeatherType(it.type) && it.type !== 'Feathers'
  );

  if (legacy.length === 0) {
    return [
      ...rest,
      ...existingFeathers.map((it) =>
        it.name === 'Feathers' ? it : { ...it, name: 'Feathers' }
      ),
    ];
  }

  const sortedLegacy = [...legacy].sort(
    (a, b) => Number(a.createdAt) - Number(b.createdAt)
  );
  const primary = sortedLegacy[0]!;
  const mergeSources =
    existingFeathers.length > 0
      ? [...sortedLegacy, ...existingFeathers].sort(
          (a, b) => Number(a.createdAt) - Number(b.createdAt)
        )
      : sortedLegacy;

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

  const cancelledLegacy = mergeSources
    .filter((it) => it.id !== feathers.id)
    .map((it) => ({ ...it, status: 'cancelled' as const }));

  return [...rest, feathers, ...cancelledLegacy];
}
