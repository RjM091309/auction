import { AuctionItem, AuctionState } from '../types';
import {
  AUCTION_DATA_VERSION,
  DEFAULT_AUCTION_ITEMS,
  INITIAL_MEMBERS,
} from '../data/auctionDefaults';
import { dedupeRosterMembersByIgn } from './dedupeRosterMembersByIgn';
import { migrateFeatherItems, parseRewardItemCounts } from './featherMigration';
import { parseGuildRank } from './pageAssignment';

const STORAGE_KEY = 'roo_auction_state';

function freshDefaultState(): AuctionState {
  return {
    items: DEFAULT_AUCTION_ITEMS.map((row) => ({ ...row, createdAt: Date.now() })),
    members: INITIAL_MEMBERS,
    dataVersion: AUCTION_DATA_VERSION,
  };
}

/** Old 2-card seeds — replace with full default rows */
function isLegacyTwoCardSeed(items: AuctionState['items']): boolean {
  if (items.length !== 2) return false;
  const names = new Set(items.map((i) => i.name));
  const hasLnd = names.has('Light And Dark Feathers ');
  const fragNames = new Set([
    'Puppet Frag Card',
    'Puppet Fragment Card',
    'Ghostring Fragment Card',
  ]);
  const hasFrag = [...fragNames].some((n) => names.has(n));
  const hadOldLnd = names.has('Legendary Diamond (LND)');
  return (
    (hasFrag && hasLnd) ||
    (names.has('Ghostring Fragment Card') && hadOldLnd)
  );
}

/** Rename older fragment card titles to the current default label */
function normalizeAuctionItems(items: AuctionItem[]): AuctionItem[] {
  const legacyFrag = new Set(['Ghostring Fragment Card', 'Puppet Fragment Card']);
  return items.map((it) =>
    legacyFrag.has(it.name) ? { ...it, name: 'Puppet Frag Card' } : it
  );
}

/** Add default rows missing from persisted state (e.g. new Illusion Frag Card on v5). */
export function mergeMissingDefaultAuctionItems(items: AuctionItem[]): AuctionItem[] {
  const byId = new Map(items.map((it) => [it.id, it]));
  const out = [...items];
  for (const row of DEFAULT_AUCTION_ITEMS) {
    if (!byId.has(row.id)) {
      out.push({ ...row, createdAt: Date.now() });
    }
  }
  return out;
}

export const saveState = (state: AuctionState) => {
  const payload: AuctionState = {
    ...state,
    dataVersion: AUCTION_DATA_VERSION,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

export const loadState = (): AuctionState => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    const s = freshDefaultState();
    return { ...s, items: normalizeAuctionItems(s.items) };
  }
  try {
    const parsed = JSON.parse(saved) as AuctionState;
    const members =
      Array.isArray(parsed.members) && parsed.members.length > 0
        ? parsed.members
        : INITIAL_MEMBERS;
    const storedVersion = parsed.dataVersion ?? 0;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const rewardRank = parseGuildRank(parsed.rewardRank);

    if (storedVersion < AUCTION_DATA_VERSION) {
      const useDefaultRows =
        rawItems.length === 0 || isLegacyTwoCardSeed(rawItems);
      const additiveUpgrade =
        !useDefaultRows && storedVersion >= 4 && AUCTION_DATA_VERSION >= 5;
      const baseItems = useDefaultRows
        ? DEFAULT_AUCTION_ITEMS.map((row) => ({ ...row, createdAt: Date.now() }))
        : additiveUpgrade
          ? mergeMissingDefaultAuctionItems(normalizeAuctionItems(rawItems))
          : rawItems.map((it) => ({
              ...it,
              interestedMemberIds: [],
            }));
      return dedupeRosterMembersByIgn({
        items: migrateFeatherItems(normalizeAuctionItems(baseItems)),
        members,
        dataVersion: AUCTION_DATA_VERSION,
        rewardItemCounts: parseRewardItemCounts(parsed.rewardItemCounts, rewardRank),
      });
    }

    return dedupeRosterMembersByIgn({
      items: migrateFeatherItems(normalizeAuctionItems(rawItems)),
      members,
      dataVersion: AUCTION_DATA_VERSION,
      rewardItemCounts: parseRewardItemCounts(parsed.rewardItemCounts, rewardRank),
    });
  } catch (e) {
    console.error('Failed to load state', e);
    const s = freshDefaultState();
    return { ...s, items: normalizeAuctionItems(s.items) };
  }
};
