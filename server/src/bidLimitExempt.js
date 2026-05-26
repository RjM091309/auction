/**
 * Server-side mirror of `src/lib/bidLimitExempt.ts`.
 *
 * Reads `VITE_BID_LIMIT_EXEMPT_ITEM_IDS` from the shared `.env` (loaded by
 * `dotenv/config` in `server/src/index.js`). Items listed here are exempt
 * from the "one active queue per IGN" gate enforced in
 * `findOtherActiveQueueBlockingWithMatch`.
 *
 * NOTE: the env var is `VITE_`-prefixed so the same value is also exposed
 * to the client bundle by Vite — no need to duplicate the list.
 */

const RAW = String(process.env.VITE_BID_LIMIT_EXEMPT_ITEM_IDS ?? '');
const EXEMPT_IDS = new Set(
  RAW.split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
);

/** @param {string | null | undefined} itemId */
export function isItemExemptFromBidLimit(itemId) {
  if (!itemId) return false;
  return EXEMPT_IDS.has(String(itemId));
}

export function bidLimitExemptIds() {
  return EXEMPT_IDS;
}
