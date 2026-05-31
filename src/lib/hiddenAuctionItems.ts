import type { AuctionItem, WeeklyEventType } from '../types';

/** Item ids to omit from public board + admin queue grid (rows stay in DB). */
const HIDDEN_IDS = new Set<string>();

/** Exact names treated as hidden (covers DB rows created without default ids). */
const HIDDEN_NAMES = new Set<string>();

/** Illusion Frag Card — not shown during Emperium Overrun (Puppet + Feathers only). */
export function isIllusionFragmentItem(
  item: Pick<AuctionItem, 'id' | 'name'>
): boolean {
  return item.id === 'm4' || /illusion/i.test(item.name);
}

function defaultEventMode(m?: WeeklyEventType): WeeklyEventType {
  return m ?? 'Emperium Overrun';
}

/** When non-empty, matching items are hidden from the public view and admin grid. */
export function isAuctionItemHidden(
  item: Pick<AuctionItem, 'id' | 'name'>,
  eventMode?: WeeklyEventType
): boolean {
  if (HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name)) return true;
  if (
    defaultEventMode(eventMode) === 'Emperium Overrun' &&
    isIllusionFragmentItem(item)
  ) {
    return true;
  }
  return false;
}
