import { randomInt } from 'node:crypto';

/**
 * Authoritative "Start Shuffle" randomization. Runs server-side (unlike the
 * old client-computed order) so a tampered client can never pick its own
 * winners — only the live DB queue membership and this RNG decide the order.
 * @param {number[]} ids
 * @returns {number[]}
 */
export function shuffleIds(ids) {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/** How long an order from `/api/shuffle/pin-queues` stays valid for the lock save. */
const ISSUED_ORDER_TTL_MS = 10 * 60 * 1000;

/** Issued orders per officer, so simultaneous Start Shuffles don't overwrite each other. */
/** @type {Map<number, { at: number, queueByItemId: Record<string, number[]> }>} */
const issuedByActorId = new Map();

/**
 * Remember the order the server handed out to this officer for "Start Shuffle"
 * so their follow-up lock save (`PUT /api/state`) persists exactly that order
 * instead of whatever the client sends back.
 * @param {number} actorId
 * @param {Record<string, number[]>} queueByItemId
 */
export function rememberIssuedShuffleOrders(actorId, queueByItemId) {
  issuedByActorId.set(actorId, { at: Date.now(), queueByItemId: { ...queueByItemId } });
}

/**
 * One-shot read of the order issued to this officer (expired → empty). Clears
 * every officer's pending order: once the lock is saved, the others are moot.
 * @param {number | null | undefined} actorId
 * @returns {Map<string, number[]>}
 */
export function takeIssuedShuffleOrders(actorId) {
  const cur = actorId == null ? undefined : issuedByActorId.get(actorId);
  issuedByActorId.clear();
  if (!cur || Date.now() - cur.at > ISSUED_ORDER_TTL_MS) return new Map();
  return new Map(Object.entries(cur.queueByItemId));
}
