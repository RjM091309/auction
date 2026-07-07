/**
 * Keep in sync with `src/lib/guildLeagueWeek.ts`.
 */

import { formatInstantInAuctionWeekTz, getAuctionWeekTimezone } from './auctionWeek.js';
import { addDaysToDateKey, startOfDateKeyMs } from './overrunWeek.js';

/** Days from win Tuesday to unlock Friday (skip Thursday Guild League round). */
export const GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET = 3;

/** @param {number} [instantMs] @param {string} [timeZone] */
export function getTuesdayDateKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
) {
  const { dateKey, weekdayShort } = formatInstantInAuctionWeekTz(instantMs, timeZone);
  return weekdayShort === 'Tue' ? dateKey : null;
}

/** @param {number} winAtMs @param {string} [timeZone] */
export function guildLeagueWinUnlockDayKey(winAtMs, timeZone = getAuctionWeekTimezone()) {
  const tueKey = getTuesdayDateKey(winAtMs, timeZone);
  if (!tueKey) return null;
  return addDaysToDateKey(tueKey, GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET);
}

/** @param {number} winAtMs @param {string} [timeZone] */
export function guildLeagueWinCooldownExpiresAt(winAtMs, timeZone = getAuctionWeekTimezone()) {
  const unlock = guildLeagueWinUnlockDayKey(winAtMs, timeZone);
  if (!unlock) return winAtMs;
  return startOfDateKeyMs(unlock, timeZone);
}

/** @param {number} winAtMs @param {number} [nowMs] @param {string} [timeZone] */
export function isGuildLeagueWinStillOnCooldown(
  winAtMs,
  nowMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
) {
  if (!Number.isFinite(winAtMs) || winAtMs <= 0) return false;
  const unlockKey = guildLeagueWinUnlockDayKey(winAtMs, timeZone);
  if (!unlockKey) return false;
  const nowKey = formatInstantInAuctionWeekTz(nowMs, timeZone).dateKey;
  return nowKey < unlockKey;
}
