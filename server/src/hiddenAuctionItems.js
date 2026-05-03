/** Keep in sync with `src/lib/hiddenAuctionItems.ts` */
const HIDDEN_IDS = new Set(['m1']);
const HIDDEN_NAMES = new Set(['Puppet Frag Card']);

export function isAuctionItemHiddenForPublic(item) {
  return (
    item &&
    (HIDDEN_IDS.has(item.id) || HIDDEN_NAMES.has(item.name))
  );
}
