/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ItemType } from '../types';

export const auctionItemTypeColors: Record<ItemType, string> = {
  'Fragment Card': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
  LND: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  TNS: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Ancient Item': 'text-red-400 border-red-500/30 bg-red-500/10',
  Other: 'text-slate-400 border-slate-700 bg-slate-800',
};
