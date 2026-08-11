/**
 * Keep in sync with `src/lib/guildLeagueWeek.ts`.
 */

import { formatInstantInAuctionWeekTz, getAuctionWeekTimezone } from './auctionWeek.js';
import { addDaysToDateKey, startOfDateKeyMs } from './overrunWeek.js';

const ONE_DAY_MS = 86_400_000;

/** Days from win Tuesday to unlock Friday (skip Thursday Guild League round). */
export const GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET = 3;

/**
 * YYYY-MM-DD of the Tuesday closest to instantMs in the auction timezone.
 * The normal path is a shuffle-lock win recorded on the Tuesday event itself
 * (0 days away), but an admin can also mark/unmark a winner by hand on a
 * different day (e.g. a late correction) — snapping to the nearest Tuesday
 * (checking 1-3 days back/forward, the max possible distance) instead of
 * requiring an exact match means that win still anchors to the right weekly
 * round instead of silently getting no cooldown at all.
 * @param {number} [instantMs] @param {string} [timeZone]
 */
export function getTuesdayDateKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
) {
  const same = formatInstantInAuctionWeekTz(instantMs, timeZone);
  if (same.weekdayShort === 'Tue') return same.dateKey;
  for (let i = 1; i <= 3; i += 1) {
    const back = formatInstantInAuctionWeekTz(instantMs - i * ONE_DAY_MS, timeZone);
    if (back.weekdayShort === 'Tue') return back.dateKey;
    const fwd = formatInstantInAuctionWeekTz(instantMs + i * ONE_DAY_MS, timeZone);
    if (fwd.weekdayShort === 'Tue') return fwd.dateKey;
  }
  throw new Error(`[guildLeagueWeek] could not find a nearby Tuesday in TZ ${timeZone}`);
}

/** @param {number} winAtMs @param {string} [timeZone] */
export function guildLeagueWinUnlockDayKey(winAtMs, timeZone = getAuctionWeekTimezone()) {
  const tueKey = getTuesdayDateKey(winAtMs, timeZone);
  return addDaysToDateKey(tueKey, GUILD_LEAGUE_WIN_UNLOCK_DAY_OFFSET);
}

/** @param {number} winAtMs @param {string} [timeZone] */
export function guildLeagueWinCooldownExpiresAt(winAtMs, timeZone = getAuctionWeekTimezone()) {
  const unlock = guildLeagueWinUnlockDayKey(winAtMs, timeZone);
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
  const nowKey = formatInstantInAuctionWeekTz(nowMs, timeZone).dateKey;
  return nowKey < unlockKey;
}
