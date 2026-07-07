import {
  formatInstantInAuctionWeekTz,
  getAuctionWeekTimezone,
} from './auctionWeek';
import { addDaysToDateKey, startOfDateKeyMs } from './overrunWeek';

/** Days from win Tuesday to unlock Friday (skip Thursday Guild League round). */
export const GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET = 3;

/** YYYY-MM-DD when instantMs falls on Tuesday in the auction timezone; else null. */
export function getTuesdayDateKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
): string | null {
  const { dateKey, weekdayShort } = formatInstantInAuctionWeekTz(
    instantMs,
    timeZone
  );
  return weekdayShort === 'Tue' ? dateKey : null;
}

/** Friday 00:00 after a Tuesday win — eligible again for the next card round. */
export function guildLeagueWinUnlockDayKey(
  winAtMs: number,
  timeZone = getAuctionWeekTimezone()
): string | null {
  const tueKey = getTuesdayDateKey(winAtMs, timeZone);
  if (!tueKey) return null;
  return addDaysToDateKey(tueKey, GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET);
}

export function guildLeagueWinCooldownExpiresAt(
  winAtMs: number,
  timeZone = getAuctionWeekTimezone()
): number {
  const unlock = guildLeagueWinUnlockDayKey(winAtMs, timeZone);
  if (!unlock) return winAtMs;
  return startOfDateKeyMs(unlock, timeZone);
}

/** True from Tuesday Puppet win until Friday 00:00 (blocks Thursday bidding). */
export function isGuildLeagueWinStillOnCooldown(
  winAtMs: number,
  nowMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
): boolean {
  if (!Number.isFinite(winAtMs) || winAtMs <= 0) return false;
  const unlockKey = guildLeagueWinUnlockDayKey(winAtMs, timeZone);
  if (!unlockKey) return false;
  const nowKey = formatInstantInAuctionWeekTz(nowMs, timeZone).dateKey;
  return nowKey < unlockKey;
}
