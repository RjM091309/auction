/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ItemType } from '../types';

export const auctionItemTypeColors: Record<ItemType, string> = {
  'Fragment Card': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
  Feathers: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Ancient Item': 'text-red-400 border-red-500/30 bg-red-500/10',
  Other: 'text-slate-400 border-slate-700 bg-slate-800',
};

/** Card / queue type pill label (Feathers card shows as LND & TNS). */
export function displayAuctionItemTypeBadge(type: ItemType | string): string {
  if (type === 'Feathers' || type === 'LND' || type === 'TNS') return 'LND & TNS';
  return type;
}

export function auctionItemTypeColorClass(type: ItemType | string): string {
  if (type === 'Feathers' || type === 'LND' || type === 'TNS') {
    return auctionItemTypeColors.Feathers;
  }
  return auctionItemTypeColors[type as ItemType] ?? auctionItemTypeColors.Other;
}
