/**
 * Overrun payout week key = Sunday date in AUCTION_WEEK_TZ (default Asia/Manila).
 * We store a YYYY-MM-DD "sunday_key" to enforce idempotency (run once per Sunday).
 */

import { getAuctionWeekTimezone } from './auctionWeek.js';

/**
 * @returns {string} YYYY-MM-DD for the Sunday that starts the current overrun payout day in {@link getAuctionWeekTimezone}.
 */
export function getOverrunSundayKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
) {
  let t = instantMs;
  for (let i = 0; i < 8; i += 1) {
    const wd = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    }).format(new Date(t));
    if (wd === 'Sun') {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(t));
    }
    t -= 86_400_000;
  }
  throw new Error(`[overrunWeek] could not find Sunday in TZ ${timeZone}`);
}

