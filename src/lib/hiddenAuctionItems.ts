import type { AuctionItem } from '../types';

/** Default seed id for Puppet Frag Card (`auctionDefaults` / server `defaults`). */
const HIDDEN_IDS = new Set<string>(['m1']);

/** Exact names treated as hidden (covers DB rows created without default ids). */
const HIDDEN_NAMES = new Set<string>(['Puppet Frag Card']);

/** Temporarily omit from public board + admin queue grid (rows stay in DB). */
export function isAuctionItemHidden(item: Pick<AuctionItem, 'id' | 'name'>): boolean {
  return HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name);
}
