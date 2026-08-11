/**
 * Keep in sync with `src/lib/guildLeagueWinCooldown.ts`.
 */

import {
  isEmperiumCooldownItem,
  isPuppetFragmentItem,
  pruneExpiredEmperiumWins,
} from './emperiumWinCooldown.js';
import {
  guildLeagueWinCooldownExpiresAt,
  isGuildLeagueWinStillOnCooldown,
} from './guildLeagueWeek.js';
import { normalizeIgn } from './weeklyTypeWins.js';

export const GUILD_LEAGUE_WIN_MODE = 'Guild League';

/** @param {{ ign: string, t: string, itemId?: string, at?: number, mode?: string }} win */
export function isGuildLeagueCooldownWinRecord(win) {
  if (win.mode != null && win.mode !== GUILD_LEAGUE_WIN_MODE) return false;
  if (win.mode == null) return false;
  if (win.t !== 'Fragment Card') return false;
  if (win.itemId && win.itemId !== 'm1') return false;
  return true;
}

/** @param {{ ign: string, t: string, itemId?: string, at?: number, mode?: string }} win @param {{ id: string, name: string, type: string }} item */
function winMatchesGuildCooldownItem(win, item) {
  if (!isPuppetFragmentItem(item)) return false;
  if (!isGuildLeagueCooldownWinRecord(win)) return false;
  if (win.itemId && win.itemId === item.id) return true;
  return win.t === 'Fragment Card' && !win.itemId && isPuppetFragmentItem(item);
}

/** @param {Array<{ ign: string, t: string, itemId?: string, at?: number, mode?: string }> | undefined} wins */
export function pruneExpiredGuildLeagueWins(wins, nowMs = Date.now()) {
  if (!Array.isArray(wins) || wins.length === 0) return [];
  return wins.filter((w) => {
    if (!isGuildLeagueCooldownWinRecord(w)) return true;
    const at = typeof w.at === 'number' && Number.isFinite(w.at) ? w.at : 0;
    return at > 0 && isGuildLeagueWinStillOnCooldown(at, nowMs);
  });
}

/** @param {Array<{ ign: string, t: string, itemId?: string, at?: number, mode?: string }> | undefined} wins */
export function pruneWeeklyTypeWins(wins, nowMs = Date.now()) {
  return pruneExpiredGuildLeagueWins(pruneExpiredEmperiumWins(wins, nowMs), nowMs);
}

/**
 * Temporarily disabled per request (2026-08-10): Guild League no longer
 * blocks re-queueing on a Puppet Frag Card win. Kept as a single toggle
 * point — flip back to `defaultEventModeForQueues(eventMode) === 'Guild
 * League'` to re-enable the Tue→Thu cooldown.
 * @param {string | undefined} eventMode
 */
export function isGuildLeagueWinCooldownEnabled(eventMode) {
  return false;
}

/**
 * @param {string | undefined} eventMode
 * @param {{ id: string, name: string, type: string }} item
 * @param {Array<{ ign: string, t: string, itemId?: string, at?: number, mode?: string }> | undefined} wins
 * @param {string} ignRaw
 */
export function findGuildLeagueWinCooldown(
  eventMode,
  item,
  wins,
  ignRaw,
  nowMs = Date.now()
) {
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

/** @param {string | undefined} eventMode @param {{ id: string, name: string, type: string }} item @param {unknown} wins @param {string} ignRaw */
export function guildLeagueWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw) {
  return findGuildLeagueWinCooldown(eventMode, item, wins, ignRaw) != null;
}
