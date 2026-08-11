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
