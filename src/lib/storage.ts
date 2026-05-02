import { AuctionItem, AuctionState } from '../types';
import {
  AUCTION_DATA_VERSION,
  DEFAULT_AUCTION_ITEMS,
  INITIAL_MEMBERS,
} from '../data/auctionDefaults';

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
  const hasLnd = names.has('Light And Dark Feathers (LND)');
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

    if (storedVersion < AUCTION_DATA_VERSION) {
      const useDefaultRows =
        rawItems.length === 0 || isLegacyTwoCardSeed(rawItems);
      const items = useDefaultRows
        ? DEFAULT_AUCTION_ITEMS.map((row) => ({ ...row, createdAt: Date.now() }))
        : rawItems.map((it) => ({
            ...it,
            interestedMemberIds: [],
          }));
      return {
        items: normalizeAuctionItems(items),
        members,
        dataVersion: AUCTION_DATA_VERSION,
      };
    }

    return {
      items: normalizeAuctionItems(rawItems),
      members,
      dataVersion: AUCTION_DATA_VERSION,
    };
  } catch (e) {
    console.error('Failed to load state', e);
    const s = freshDefaultState();
    return { ...s, items: normalizeAuctionItems(s.items) };
  }
};
