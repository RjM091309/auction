/**
 * Auction week = Monday 00:00 → next Monday (guild calendar).
 * TZ via AUCTION_WEEK_TZ (default Asia/Manila).
 */

export function getAuctionWeekTimezone() {
  return process.env.AUCTION_WEEK_TZ?.trim() || 'Asia/Manila';
}

/** @param {number} instantMs @param {string} [timeZone] */
export function formatInstantInAuctionWeekTz(
  instantMs,
  timeZone = getAuctionWeekTimezone()
) {
  const d = new Date(instantMs);
  const dateKey = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  const weekdayShort = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(d);
  const timeHm = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
  return { dateKey, weekdayShort, timeHm };
}

/**
 * @returns {string} YYYY-MM-DD for the Monday that starts the current auction week in {@link getAuctionWeekTimezone}.
 */
export function getAuctionWeekMondayKey(instantMs = Date.now(), timeZone = getAuctionWeekTimezone()) {
  let t = instantMs;
  for (let i = 0; i < 8; i += 1) {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(
      new Date(t)
    );
    if (wd === 'Mon') {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(t));
    }
    t -= 86_400_000;
  }
  throw new Error(`[auctionWeek] could not find Monday in TZ ${timeZone}`);
}
