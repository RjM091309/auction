import type { AuctionItem, WeeklyTypeWin } from '../types';
import { findEmperiumWinCooldown } from './emperiumWinCooldown';
import { findGuildLeagueWinCooldown } from './guildLeagueWinCooldown';

export function normalizeIgn(name: string): string {
  return name.trim().toLowerCase();
}

export { pruneExpiredEmperiumWins } from './emperiumWinCooldown';
export { pruneWeeklyTypeWins } from './guildLeagueWinCooldown';

/** Active Puppet CD for the current event mode. */
export function ignHasWeeklyTypeWin(
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  eventMode?: import('../types').WeeklyEventType
): boolean {
  if (!eventMode) return false;
  if (eventMode === 'Guild League') {
    return findGuildLeagueWinCooldown(eventMode, item, wins, ignRaw) != null;
  }
  return findEmperiumWinCooldown(eventMode, item, wins, ignRaw) != null;
}
