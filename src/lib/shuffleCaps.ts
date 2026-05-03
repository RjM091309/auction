import type { ItemType } from '../types';

/** Winner-pool sizes come from `.env` (`VITE_AUCTION_WINNER_POOL_*`). Rebuild the web app after changing them. */
function readPoolSize(envKey: string, fallback: number): number {
  try {
    const raw = import.meta.env[envKey as keyof ImportMetaEnv] as string | undefined;
    if (raw === undefined || raw === '') return fallback;
    const n = parseInt(String(raw), 10);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  } catch {
    return fallback;
  }
}

/**
 * Uniform integer in [0, n) — `crypto.getRandomValues` when available (no modulo bias);
 * falls back to `Math.random` if crypto is missing (e.g. some locked-down contexts).
 */
function randomUintBelow(n: number): number {
  if (n <= 1) return 0;
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const space = 0x1_0000_0000;
    const limit = Math.floor(space / n) * n;
    let x: number;
    do {
      crypto.getRandomValues(buf);
      x = buf[0]!;
    } while (x >= limit);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}

/**
 * How many top queue rows get the winner shortlist (green check) for this type.
 * Full queue is never trimmed on shuffle — only this many can be marked winner from the top.
 * Values: `VITE_AUCTION_WINNER_POOL_*` in `.env` (see defaults in that file).
 */
export function maxQueueSlotsAfterShuffle(type: ItemType): number {
  const def = readPoolSize('VITE_AUCTION_WINNER_POOL_DEFAULT', 1);
  switch (type) {
    case 'Fragment Card':
      return readPoolSize('VITE_AUCTION_WINNER_POOL_FRAGMENT', 2);
    case 'LND':
      return readPoolSize('VITE_AUCTION_WINNER_POOL_LND', 6);
    case 'TNS':
      return readPoolSize('VITE_AUCTION_WINNER_POOL_TNS', 8);
    default:
      return def;
  }
}

/**
 * Fisher–Yates (Knuth) shuffle: every permutation of the queue has **exactly equal**
 * probability, so walang built-in bias sa user o sa puwesto — kung “laging” may #1,
 * hanggang swerte / law of large numbers lang iyon, hindi dahil sa algorithm.
 */
export function shuffleQueueIdsForType(ids: number[], _type: ItemType): number[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = randomUintBelow(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}
