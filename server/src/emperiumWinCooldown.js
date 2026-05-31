/**
 * Keep in sync with `src/lib/emperiumWinCooldown.ts`.
 */

import { defaultEventModeForQueues } from './queueEligibility.js';
import {
  emperiumWinCooldownExpiresAt,
  isEmperiumWinStillOnCooldown,
} from './overrunWeek.js';
import { normalizeIgn } from './weeklyTypeWins.js';

/** @param {{ name: string, type: string }} item */
export function isPuppetFragmentItem(item) {
  return item.type === 'Fragment Card' && /puppet/i.test(item.name);
}

/** @param {{ id: string, name: string, type: string }} item */
export function isFeatherItemType(t) {
  return t === 'Feathers' || t === 'LND' || t === 'TNS';
}

/** Emperium CD applies to Puppet Frag Card only — Feathers winners may bid again next Sunday. */
export function isEmperiumCooldownItem(item) {
  return isPuppetFragmentItem(item);
}

/** @param {{ ign: string, t: string, itemId?: string, at?: number }} win */
export function isEmperiumCooldownWinRecord(win) {
  if (isFeatherItemType(win.t)) return false;
  if (win.t !== 'Fragment Card') return false;
  if (win.itemId && win.itemId !== 'm1') return false;
  return true;
}

/** @param {{ ign: string, t: string, itemId?: string, at?: number }} win @param {{ id: string, name: string, type: string }} item */
function winMatchesCooldownItem(win, item) {
  if (!isPuppetFragmentItem(item)) return false;
  if (!isEmperiumCooldownWinRecord(win)) return false;
  if (win.itemId && win.itemId === item.id) return true;
  return win.t === 'Fragment Card' && !win.itemId && isPuppetFragmentItem(item);
}

/** @param {Array<{ ign: string, t: string, itemId?: string, at?: number }> | undefined} wins */
export function pruneExpiredEmperiumWins(wins, nowMs = Date.now()) {
  if (!Array.isArray(wins) || wins.length === 0) return [];
  return wins.filter((w) => {
    if (!isEmperiumCooldownWinRecord(w)) return false;
    const at = typeof w.at === 'number' && Number.isFinite(w.at) ? w.at : 0;
    return at > 0 && isEmperiumWinStillOnCooldown(at, nowMs);
  });
}

/** True only under Emperium Overrun — Guild League never applies winner CD. */
export function isEmperiumWinCooldownEnabled(eventMode) {
  if (eventMode === 'Guild League') return false;
  return defaultEventModeForQueues(eventMode) === 'Emperium Overrun';
}

/**
 * @param {string | undefined} eventMode
 * @param {{ id: string, name: string, type: string }} item
 * @param {Array<{ ign: string, t: string, itemId?: string, at?: number }> | undefined} wins
 * @param {string} ignRaw
 */
export function findEmperiumWinCooldown(
  eventMode,
  item,
  wins,
  ignRaw,
  nowMs = Date.now()
) {
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

/** @param {string | undefined} eventMode @param {{ id: string, name: string, type: string }} item @param {unknown} wins @param {string} ignRaw */
export function emperiumWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw) {
  return findEmperiumWinCooldown(eventMode, item, wins, ignRaw) != null;
}
