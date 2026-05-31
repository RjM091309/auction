import { getAuctionWeekTimezone } from './auctionWeek';

const ONE_DAY_MS = 86_400_000;

/** Skip this many Emperium Sundays after the win Sunday (1 = miss next Sunday only). */
export const EMPERIUM_WIN_SKIP_SUNDAYS = 1;

/** Calendar days from win Sunday to unlock Sunday (skip 1 event → 2nd Sunday after win). */
export const EMPERIUM_WIN_UNLOCK_DAY_OFFSET = 7 * (EMPERIUM_WIN_SKIP_SUNDAYS + 1);

/** YYYY-MM-DD for the Sunday on or before instantMs in the auction timezone. */
export function getOverrunSundayKey(
  instantMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
): string {
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
    t -= ONE_DAY_MS;
  }
  throw new Error(`[overrunWeek] could not find Sunday in TZ ${timeZone}`);
}

export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/** First local instant of dateKey 00:00 in timeZone (for UI "until" labels). */
export function startOfDateKeyMs(
  dateKey: string,
  timeZone = getAuctionWeekTimezone()
): number {
  const [y, m, d] = dateKey.split('-').map((x) => parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    return Date.now();
  }
  let t = Date.UTC(y, m - 1, d - 1, 12, 0, 0);
  for (let i = 0; i < 72; i += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(new Date(t));
    const pick = (type: string) =>
      parts.find((p) => p.type === type)?.value ?? '';
    const key = `${pick('year')}-${pick('month')}-${pick('day')}`;
    const hour = parseInt(pick('hour'), 10);
    const minute = parseInt(pick('minute'), 10);
    const second = parseInt(pick('second'), 10);
    if (key === dateKey && hour === 0 && minute === 0 && second === 0) {
      return t;
    }
    t += 3600_000;
  }
  return Date.UTC(y, m - 1, d, 4, 0, 0);
}

export function emperiumWinUnlockSundayKey(
  winAtMs: number,
  timeZone = getAuctionWeekTimezone()
): string {
  return addDaysToDateKey(
    getOverrunSundayKey(winAtMs, timeZone),
    EMPERIUM_WIN_UNLOCK_DAY_OFFSET
  );
}

export function emperiumWinCooldownExpiresAt(
  winAtMs: number,
  timeZone = getAuctionWeekTimezone()
): number {
  return startOfDateKeyMs(emperiumWinUnlockSundayKey(winAtMs, timeZone), timeZone);
}

/** True while the win still blocks the next Emperium Sunday (1-week / 1-event skip). */
export function isEmperiumWinStillOnCooldown(
  winAtMs: number,
  nowMs = Date.now(),
  timeZone = getAuctionWeekTimezone()
): boolean {
  if (!Number.isFinite(winAtMs) || winAtMs <= 0) return false;
  const unlockSun = emperiumWinUnlockSundayKey(winAtMs, timeZone);
  const nowSun = getOverrunSundayKey(nowMs, timeZone);
  return nowSun < unlockSun;
}
