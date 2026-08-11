export function normalizeIgn(name: string): string {
  return name.trim().toLowerCase();
}

export { pruneExpiredEmperiumWins } from './emperiumWinCooldown';
export { pruneWeeklyTypeWins } from './guildLeagueWinCooldown';
