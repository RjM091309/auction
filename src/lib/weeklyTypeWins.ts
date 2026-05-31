import type { AuctionItem, WeeklyTypeWin } from '../types';
import {
  findEmperiumWinCooldown,
  pruneExpiredEmperiumWins,
} from './emperiumWinCooldown';

export function normalizeIgn(name: string): string {
  return name.trim().toLowerCase();
}

export { pruneExpiredEmperiumWins };

/** Active Emperium Overrun cooldown only (Guild League = never). */
export function ignHasWeeklyTypeWin(
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  eventMode?: import('../types').WeeklyEventType
): boolean {
  if (!eventMode || eventMode === 'Guild League') return false;
  return findEmperiumWinCooldown(eventMode, item, wins, ignRaw) != null;
}
