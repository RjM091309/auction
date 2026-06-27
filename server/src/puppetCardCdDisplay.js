/**
 * Keep in sync with `src/lib/puppetCardCdDisplay.ts`.
 */

import {
  findEmperiumWinCooldown,
  isEmperiumWinCooldownEnabled,
} from './emperiumWinCooldown.js';

const PUPPET_CD_ITEM = {
  id: 'm1',
  name: 'Puppet Frag Card',
  type: 'Fragment Card',
};

const ONE_DAY_MS = 86_400_000;

/** @param {string} ign @param {Array<{ ign: string, t: string, itemId?: string, at?: number }> | undefined} weeklyTypeWins @param {string | undefined} eventMode @param {number} [nowMs] */
export function puppetCardCdDisplayForIgn(
  ign,
  weeklyTypeWins,
  eventMode,
  nowMs = Date.now()
) {
  if (!isEmperiumWinCooldownEnabled(eventMode)) {
    return {
      label: 'N/A',
      title: 'Puppet card cooldown applies in Emperium Overrun only',
      tone: 'na',
    };
  }

  const cd = findEmperiumWinCooldown(
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

  return {
    label: daysLeft === 1 ? '1 day left' : `${daysLeft} days left`,
    title: `Puppet Frag Card cooldown — eligible again ${until}`,
    tone: 'cd',
    expiresAt: cd.expiresAt,
  };
}
