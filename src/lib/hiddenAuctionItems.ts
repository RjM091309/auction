import type { AuctionItem } from '../types';

/** Item ids to omit from public board + admin queue grid (rows stay in DB). */
const HIDDEN_IDS = new Set<string>();

/** Exact names treated as hidden (covers DB rows created without default ids). */
const HIDDEN_NAMES = new Set<string>();

/** When non-empty, matching items are hidden from the public view and admin grid. */
export function isAuctionItemHidden(item: Pick<AuctionItem, 'id' | 'name'>): boolean {
  return HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name);
}
