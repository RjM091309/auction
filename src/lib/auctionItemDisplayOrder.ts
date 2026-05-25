import type { AuctionItem } from '../types';

/** Preferred queue grid order: Puppet → Feathers → Illusion, then others by `createdAt`. */
const PREFERRED_ITEM_ORDER = ['m1', 'm2', 'm4'] as const;

export function compareAuctionItemsForDisplay(
  a: Pick<AuctionItem, 'id' | 'createdAt'>,
  b: Pick<AuctionItem, 'id' | 'createdAt'>
): number {
  const ia = PREFERRED_ITEM_ORDER.indexOf(a.id as (typeof PREFERRED_ITEM_ORDER)[number]);
  const ib = PREFERRED_ITEM_ORDER.indexOf(b.id as (typeof PREFERRED_ITEM_ORDER)[number]);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return Number(a.createdAt) - Number(b.createdAt);
}

export function sortAuctionItemsForDisplay<T extends Pick<AuctionItem, 'id' | 'createdAt'>>(
  items: T[]
): T[] {
  return [...items].sort(compareAuctionItemsForDisplay);
}

/**
 * Stagger shuffle reveal: Feathers first, then each Fragment Card (Puppet → Illusion, etc.).
 */
export function shuffleRevealWindowForItem(
  item: Pick<AuctionItem, 'id' | 'type'>,
  activeItems: Pick<AuctionItem, 'id' | 'type' | 'createdAt'>[]
): { start: number; end: number } {
  if (item.type === 'Feathers') {
    return { start: 0.12, end: 0.52 };
  }
  if (item.type === 'Fragment Card') {
    const frags = sortAuctionItemsForDisplay(
      activeItems.filter((i) => i.type === 'Fragment Card')
    );
    const idx = Math.max(0, frags.findIndex((f) => f.id === item.id));
    const n = Math.max(1, frags.length);
    const bandStart = 0.52;
    const bandEnd = 1.0;
    const span = (bandEnd - bandStart) / n;
    return {
      start: bandStart + idx * span,
      end: bandStart + (idx + 1) * span,
    };
  }
  return { start: 0.55, end: 1.0 };
}
