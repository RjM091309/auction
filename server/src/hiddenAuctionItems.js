/** Keep in sync with `src/lib/hiddenAuctionItems.ts` */
const HIDDEN_IDS = new Set();
const HIDDEN_NAMES = new Set();

export function isAuctionItemHiddenForPublic(item) {
  return (
    item &&
    (HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name))
  );
}
