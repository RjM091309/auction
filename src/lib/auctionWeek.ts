const ONE_DAY_MS = 86_400_000;

export function getAuctionWeekTimezone(): string {
  const tz = import.meta.env.VITE_AUCTION_WEEK_TZ;
  return typeof tz === 'string' && tz.trim() ? tz.trim() : 'Asia/Manila';
}

/** Calendar day + weekday in the guild auction timezone (same as weekly rollover). */
export function formatInstantInAuctionWeekTz(
  instantMs: number,
  timeZone = getAuctionWeekTimezone()
): { dateKey: string; weekdayShort: string; timeHm: string } {
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

/** Rows whose `at` is in the current Monday-based auction week (same boundary as weekly log + rollover). */
export function filterToCurrentAuctionWeek<T extends { at: number }>(
  entries: readonly T[],
  timeZone = getAuctionWeekTimezone()
): T[] {
  const currentMonday = getAuctionWeekMondayKey(Date.now(), timeZone);
  return entries.filter((e) => getAuctionWeekMondayKey(e.at, timeZone) === currentMonday);
}
