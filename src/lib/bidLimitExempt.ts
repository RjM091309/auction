/**
 * Items that are EXEMPT from the "one active bid per IGN" rule.
 *
 * A bidder is normally allowed only one active queue across all items
 * (modulated by the Emperium-vs-Guild rules in `queueEligibility.ts`).
 * Items listed here ignore that limit entirely: a bidder may join an
 * exempt item's queue regardless of what other queues they are already on,
 * and being on an exempt item does NOT block them from joining other items.
 *
 * Use case: lower-priority items (e.g. an extra Frag Card that still needs
 * a winner) that we want to keep open even when the bidder has already
 * committed their "main" slot to Puppet or Feathers.
 *
 * Controls (`.env`):
 *
 *   VITE_BID_LIMIT_EXEMPT_ITEM_IDS=m4,m7   # comma-separated list of item ids
 *
 * Default empty = original strict behaviour. The matching server-side helper
 * in `server/src/bidLimitExempt.js` reads the same env var via `dotenv` so
 * the gate is enforced consistently on the API.
 */

function parseExemptIds(): ReadonlySet<string> {
  const raw = String(import.meta.env.VITE_BID_LIMIT_EXEMPT_ITEM_IDS ?? '');
  const ids = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return new Set(ids);
}

const EXEMPT_IDS = parseExemptIds();

export function isItemExemptFromBidLimit(itemId: string | null | undefined): boolean {
  if (!itemId) return false;
  return EXEMPT_IDS.has(itemId);
}

export function bidLimitExemptIds(): ReadonlySet<string> {
  return EXEMPT_IDS;
}
