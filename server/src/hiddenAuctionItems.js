/** Keep in sync with `src/lib/hiddenAuctionItems.ts` */
const HIDDEN_IDS = new Set();
const HIDDEN_NAMES = new Set();

/** @param {{ id?: string, name?: string }} item */
export function isIllusionFragmentItem(item) {
  if (!item) return false;
  return item.id === 'm4' || /illusion/i.test(String(item.name ?? ''));
}

function defaultEventMode(m) {
  return m === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

/** @param {{ id?: string, name?: string }} item @param {string | undefined} [eventMode] */
export function isAuctionItemHiddenForPublic(item, eventMode) {
  if (!item) return false;
  if (HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name)) return true;
  if (
    defaultEventMode(eventMode) === 'Emperium Overrun' &&
    isIllusionFragmentItem(item)
  ) {
    return true;
  }
  return false;
}
