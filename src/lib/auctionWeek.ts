const ONE_DAY_MS = 86_400_000;

export function getAuctionWeekTimezone(): string {
  const tz = import.meta.env.VITE_AUCTION_WEEK_TZ;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : 'Asia/Manila';
}

/** YYYY-MM-DD for Monday of the auction week in the provided timezone. */
export function getAuctionWeekMondayKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
): string {
  let t = instantMs;
  for (let i = 0; i < 8; i += 1) {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
    }).format(new Date(t));
    if (weekday === 'Mon') {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(t));
    }
    t -= ONE_DAY_MS;
  }
  throw new Error(`[auctionWeek] could not find Monday in TZ ${timeZone}`);
}
