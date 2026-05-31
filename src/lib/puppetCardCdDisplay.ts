import type { WeeklyEventType, WeeklyTypeWin } from '../types';
import {
  findEmperiumWinCooldown,
  isEmperiumWinCooldownEnabled,
} from './emperiumWinCooldown';

const PUPPET_CD_ITEM = {
  id: 'm1',
  name: 'Puppet Frag Card',
  type: 'Fragment Card' as const,
};

export type PuppetCardCdTone = 'clear' | 'cd' | 'na';

export type PuppetCardCdDisplay = {
  label: string;
  title: string;
  tone: PuppetCardCdTone;
};

const ONE_DAY_MS = 86_400_000;

/** Bidder table: Puppet Frag Card CD label + tooltip for one IGN. */
export function puppetCardCdDisplayForIgn(
  ign: string,
  weeklyTypeWins: WeeklyTypeWin[] | undefined,
  eventMode?: WeeklyEventType,
  nowMs = Date.now()
): PuppetCardCdDisplay {
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
  const until = new Date(cd.expiresAt).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return {
    label: daysLeft === 1 ? '1 day left' : `${daysLeft} days left`,
    title: `Puppet Frag Card cooldown — eligible again ${until}`,
    tone: 'cd',
  };
}

export function puppetCardCdBadgeClass(tone: PuppetCardCdTone): string {
  switch (tone) {
    case 'cd':
      return 'bg-amber-950/50 text-amber-200 border-amber-700/50';
    case 'na':
      return 'bg-slate-800/80 text-slate-500 border-slate-700/50';
    default:
      return 'bg-emerald-950/40 text-emerald-300 border-emerald-800/40';
  }
}
