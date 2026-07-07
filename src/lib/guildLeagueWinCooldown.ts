import type { AuctionItem, WeeklyEventType, WeeklyTypeWin } from '../types';
import {
  isEmperiumCooldownItem,
  isPuppetFragmentItem,
  pruneExpiredEmperiumWins,
} from './emperiumWinCooldown';
import { defaultEventModeForQueues } from './queueEligibility';
import {
  guildLeagueWinCooldownExpiresAt,
  isGuildLeagueWinStillOnCooldown,
} from './guildLeagueWeek';
import { normalizeIgn } from './weeklyTypeWins';

export const GUILD_LEAGUE_WIN_MODE: WeeklyEventType = 'Guild League';

export function isGuildLeagueCooldownWinRecord(win: WeeklyTypeWin): boolean {
  if (win.mode != null && win.mode !== GUILD_LEAGUE_WIN_MODE) return false;
  if (win.mode == null) return false;
  if (win.t !== 'Fragment Card') return false;
  if (win.itemId && win.itemId !== 'm1') return false;
  return true;
}

function winMatchesGuildCooldownItem(
  win: WeeklyTypeWin,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>
): boolean {
  if (!isPuppetFragmentItem(item)) return false;
  if (!isGuildLeagueCooldownWinRecord(win)) return false;
  if (win.itemId && win.itemId === item.id) return true;
  return win.t === 'Fragment Card' && !win.itemId && isPuppetFragmentItem(item);
}

export function pruneExpiredGuildLeagueWins(
  wins: WeeklyTypeWin[] | undefined,
  nowMs = Date.now()
): WeeklyTypeWin[] {
  if (!wins?.length) return [];
  return wins.filter((w) => {
    if (!isGuildLeagueCooldownWinRecord(w)) return true;
    const at = typeof w.at === 'number' && Number.isFinite(w.at) ? w.at : 0;
    return at > 0 && isGuildLeagueWinStillOnCooldown(at, nowMs);
  });
}

export function pruneWeeklyTypeWins(
  wins: WeeklyTypeWin[] | undefined,
  nowMs = Date.now()
): WeeklyTypeWin[] {
  return pruneExpiredGuildLeagueWins(
    pruneExpiredEmperiumWins(wins, nowMs),
    nowMs
  );
}

/** True only under Guild League — Emperium Overrun uses Sunday-event CD instead. */
export function isGuildLeagueWinCooldownEnabled(
  eventMode?: WeeklyEventType
): boolean {
  return defaultEventModeForQueues(eventMode) === 'Guild League';
}

export function findGuildLeagueWinCooldown(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string,
  nowMs = Date.now()
): { win: WeeklyTypeWin; expiresAt: number } | null {
  if (!isGuildLeagueWinCooldownEnabled(eventMode)) return null;
  if (!isEmperiumCooldownItem(item)) return null;
  const ign = normalizeIgn(ignRaw);
  if (!ign) return null;

  for (const w of wins ?? []) {
    if (!isGuildLeagueCooldownWinRecord(w)) continue;
    if (normalizeIgn(w.ign) !== ign) continue;
    if (!winMatchesGuildCooldownItem(w, item)) continue;
    const at = w.at ?? 0;
    if (at <= 0) continue;
    if (!isGuildLeagueWinStillOnCooldown(at, nowMs)) continue;
    return { win: w, expiresAt: guildLeagueWinCooldownExpiresAt(at) };
  }
  return null;
}

export function guildLeagueWinCooldownBlocksQueueJoin(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string
): boolean {
  return findGuildLeagueWinCooldown(eventMode, item, wins, ignRaw) != null;
}
