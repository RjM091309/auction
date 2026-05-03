import type { WeeklyTypeWin } from '../types';

export function normalizeIgn(name: string): string {
  return name.trim().toLowerCase();
}

/** May recorded win na sa type na ito ngayong linggo (green check / completed winner). */
export function ignHasWeeklyTypeWin(
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string,
  itemType: string
): boolean {
  if (!wins?.length) return false;
  const ign = normalizeIgn(ignRaw);
  if (!ign) return false;
  return wins.some((w) => w.ign === ign && w.t === itemType);
}
