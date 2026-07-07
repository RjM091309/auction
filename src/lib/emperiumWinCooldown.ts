import type { AuctionItem, WeeklyEventType, WeeklyTypeWin } from '../types';
import { isFeatherItemType } from './featherMigration';
import { defaultEventModeForQueues } from './queueEligibility';
import {
  emperiumWinCooldownExpiresAt,
  isEmperiumWinStillOnCooldown,
} from './overrunWeek';
import { normalizeIgn } from './weeklyTypeWins';

export function isPuppetFragmentItem(item: {
  name: string;
  type: string;
}): boolean {
  return item.type === 'Fragment Card' && /puppet/i.test(item.name);
}

/** Emperium CD applies to Puppet Frag Card only — Feathers winners may bid again next Sunday. */
export function isEmperiumCooldownItem(item: {
  id: string;
  name: string;
  type: string;
}): boolean {
  return isPuppetFragmentItem(item);
}

/** Stored weekly win rows that still participate in Emperium Puppet CD. */
export function isEmperiumCooldownWinRecord(win: WeeklyTypeWin): boolean {
  if (win.mode === 'Guild League') return false;
  if (isFeatherItemType(win.t)) return false;
  if (win.t !== 'Fragment Card') return false;
  if (win.itemId && win.itemId !== 'm1') return false;
  return true;
}

function winMatchesCooldownItem(
  win: WeeklyTypeWin,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>
): boolean {
  if (!isPuppetFragmentItem(item)) return false;
  if (!isEmperiumCooldownWinRecord(win)) return false;
  if (win.itemId && win.itemId === item.id) return true;
  return win.t === 'Fragment Card' && !win.itemId && isPuppetFragmentItem(item);
}

export function pruneExpiredEmperiumWins(
  wins: WeeklyTypeWin[] | undefined,
  nowMs = Date.now()
): WeeklyTypeWin[] {
  if (!wins?.length) return [];
  return wins.filter((w) => {
    if (!isEmperiumCooldownWinRecord(w)) return true;
    const at = typeof w.at === 'number' && Number.isFinite(w.at) ? w.at : 0;
    return at > 0 && isEmperiumWinStillOnCooldown(at, nowMs);
  });
}

/** True only under Emperium Overrun — Guild League has its own Tue→Thu CD. */
export function isEmperiumWinCooldownEnabled(
  eventMode?: WeeklyEventType
): boolean {
  if (eventMode === 'Guild League') return false;
  return defaultEventModeForQueues(eventMode) === 'Emperium Overrun';
}

export function findEmperiumWinCooldown(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string,
  nowMs = Date.now()
): { win: WeeklyTypeWin; expiresAt: number } | null {
  if (!isEmperiumWinCooldownEnabled(eventMode)) return null;
  if (!isEmperiumCooldownItem(item)) return null;
  const ign = normalizeIgn(ignRaw);
  if (!ign) return null;

  for (const w of pruneExpiredEmperiumWins(wins, nowMs)) {
    if (normalizeIgn(w.ign) !== ign) continue;
    if (!winMatchesCooldownItem(w, item)) continue;
    const at = w.at ?? 0;
    if (at <= 0) continue;
    if (!isEmperiumWinStillOnCooldown(at, nowMs)) continue;
    return { win: w, expiresAt: emperiumWinCooldownExpiresAt(at) };
  }
  return null;
}

export function emperiumWinCooldownBlocksQueueJoin(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string
): boolean {
  return findEmperiumWinCooldown(eventMode, item, wins, ignRaw) != null;
}
