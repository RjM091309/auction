/**
 * Keep in sync with `src/lib/puppetCardCdDisplay.ts`.
 */

import {
  findEmperiumWinCooldown,
  isEmperiumWinCooldownEnabled,
} from './emperiumWinCooldown.js';
import {
  findGuildLeagueWinCooldown,
  isGuildLeagueWinCooldownEnabled,
} from './guildLeagueWinCooldown.js';

const PUPPET_CD_ITEM = {
  id: 'm1',
  name: 'Puppet Frag Card',
  type: 'Fragment Card',
};

const ONE_DAY_MS = 86_400_000;

/**
 * @param {string | undefined} eventMode
 * @param {{ id: string, name: string, type: string }} item
 * @param {Array<{ ign: string, t: string, itemId?: string, at?: number, mode?: string }> | undefined} weeklyTypeWins
 * @param {string} ignRaw
 * @param {number} [nowMs]
 */
export function findPuppetWinCooldown(
  eventMode,
  item,
  weeklyTypeWins,
  ignRaw,
  nowMs = Date.now()
) {
  if (isGuildLeagueWinCooldownEnabled(eventMode)) {
    return findGuildLeagueWinCooldown(eventMode, item, weeklyTypeWins, ignRaw, nowMs);
  }
  return findEmperiumWinCooldown(eventMode, item, weeklyTypeWins, ignRaw, nowMs);
}

/** @param {string} ign @param {Array<{ ign: string, t: string, itemId?: string, at?: number, mode?: string }> | undefined} weeklyTypeWins @param {string | undefined} eventMode @param {number} [nowMs] */
export function puppetCardCdDisplayForIgn(
  ign,
  weeklyTypeWins,
  eventMode,
  nowMs = Date.now()
) {
  if (
    !isEmperiumWinCooldownEnabled(eventMode) &&
    !isGuildLeagueWinCooldownEnabled(eventMode)
  ) {
    return {
      label: 'N/A',
      title: 'Puppet card cooldown applies in Guild League or Emperium Overrun only',
      tone: 'na',
    };
  }

  const cd = findPuppetWinCooldown(
    eventMode,
    PUPPET_CD_ITEM,
    weeklyTypeWins,
    ign,
    nowMs
  );
  if (!cd) {
    return {
      label: 'Ready',
      title: 'No Puppet Frag Card cooldown — may join Puppet queue',
      tone: 'clear',
    };
  }

  const msLeft = Math.max(0, cd.expiresAt - nowMs);
  const daysLeft = Math.max(1, Math.ceil(msLeft / ONE_DAY_MS));
  const until = new Date(cd.expiresAt).toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const scope =
    eventMode === 'Guild League' ? 'Guild League Thursday' : 'next Emperium Sunday';

  return {
    label: daysLeft === 1 ? '1 day left' : `${daysLeft} days left`,
    title: `Puppet Frag Card cooldown — eligible again before ${scope} (${until})`,
    tone: 'cd',
    expiresAt: cd.expiresAt,
  };
}
