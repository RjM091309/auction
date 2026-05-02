import type { ItemType } from '../types';

/**
 * How many top queue rows get the winner shortlist (green check) for this type.
 * Full queue is never trimmed on shuffle — only this many can be marked winner from the top.
 */
export function maxQueueSlotsAfterShuffle(type: ItemType): number | null {
  switch (type) {
    case 'Fragment Card':
      return 2;
    case 'LND':
      return 6;
    case 'TNS':
      return 8;
    default:
      return null;
  }
}

/** Fisher–Yates shuffle; keeps every bidder in the queue (order only). */
export function shuffleQueueIdsForType(ids: string[], _type: ItemType): string[] {
  const a = [...ids];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
