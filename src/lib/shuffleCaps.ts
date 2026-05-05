import type { ItemType } from '../types';

const DEFAULT_POOL_CAP_BY_TYPE: Record<ItemType, number> = {
  'Fragment Card': 2,
  LND: 7,
  TNS: 12,
  'Ancient Item': 1,
  Other: 1,
};

export function defaultWinnerPoolCapForType(type: ItemType): number {
  return DEFAULT_POOL_CAP_BY_TYPE[type] ?? 1;
}

function sanitizePoolCap(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const cap = Math.floor(n);
  if (cap < 0) return null;
  return cap;
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
export function maxQueueSlotsAfterShuffle(
  type: ItemType,
  winnerPoolCap?: number | null
): number {
  const perItemCap = sanitizePoolCap(winnerPoolCap);
  if (perItemCap != null) return perItemCap;
  return defaultWinnerPoolCapForType(type);
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
