import type { AuctionItem, WeeklyEventType, WeeklyTypeWin } from '../types';
import {
  isEmperiumCooldownItem,
  isEmperiumWinCooldownEnabled,
} from './emperiumWinCooldown';
import { normalizeIgn, pruneExpiredEmperiumWins } from './weeklyTypeWins';

function winKey(ign: string, t: string, itemId?: string): string {
  return `${normalizeIgn(ign)}\0${t}\0${itemId ?? ''}`;
}

function removePuppetCd(
  wins: WeeklyTypeWin[],
  ign: string,
  item: Pick<AuctionItem, 'id' | 'type'>
): WeeklyTypeWin[] {
  const nl = normalizeIgn(ign);
  if (!nl) return wins;
  return wins.filter(
    (w) =>
      !(
        w.ign === nl &&
        w.t === item.type &&
        (w.itemId == null || w.itemId === item.id)
      )
  );
}

function addPuppetCd(
  wins: WeeklyTypeWin[],
  ign: string,
  item: Pick<AuctionItem, 'id' | 'type'>,
  at: number
): WeeklyTypeWin[] {
  const nl = normalizeIgn(ign);
  if (!nl) return wins;
  const k = winKey(nl, item.type, item.id);
  if (
    wins.some(
      (w) =>
        winKey(w.ign, w.t, w.itemId) === k &&
        typeof w.at === 'number' &&
        w.at > 0
    )
  ) {
    return wins;
  }
  return [...wins, { ign: nl, t: item.type, itemId: item.id, at }];
}

function dedupeWeeklyWins(wins: WeeklyTypeWin[]): WeeklyTypeWin[] {
  const seen = new Set<string>();
  const out: WeeklyTypeWin[] = [];
  for (const w of wins) {
    const k = winKey(w.ign, w.t, w.itemId);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/**
 * Emperium Overrun + Puppet only: keep weekly_type_wins in sync when admin
 * manually marks/unmarks winners after shuffle lock.
 */
export function syncEmperiumWeeklyWinsForWinnerMarkChange(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  prevRecorded: readonly string[],
  nextRecorded: readonly string[],
  prevRevoked: readonly string[],
  nextRevoked: readonly string[],
  weeklyTypeWins: WeeklyTypeWin[] | undefined,
  atMs = Date.now()
): WeeklyTypeWin[] | undefined {
  if (!isEmperiumWinCooldownEnabled(eventMode)) return undefined;
  if (!isEmperiumCooldownItem(item)) return undefined;

  let wins = pruneExpiredEmperiumWins(weeklyTypeWins ?? []);

  const prevRecLower = new Set(
    prevRecorded.map((n) => n.trim().toLowerCase()).filter(Boolean)
  );
  const nextRecLower = new Set(
    nextRecorded.map((n) => n.trim().toLowerCase()).filter(Boolean)
  );
  const prevRevLower = new Set(
    prevRevoked.map((n) => n.trim().toLowerCase()).filter(Boolean)
  );
  const nextRevLower = new Set(
    nextRevoked.map((n) => n.trim().toLowerCase()).filter(Boolean)
  );

  for (const name of nextRecorded) {
    const nl = name.trim().toLowerCase();
    if (!nl || prevRecLower.has(nl)) continue;
    wins = addPuppetCd(wins, name, item, atMs);
  }
  for (const name of prevRecorded) {
    const nl = name.trim().toLowerCase();
    if (!nl || nextRecLower.has(nl)) continue;
    wins = removePuppetCd(wins, name, item);
  }
  for (const name of nextRevoked) {
    const nl = name.trim().toLowerCase();
    if (!nl || prevRevLower.has(nl)) continue;
    wins = removePuppetCd(wins, name, item);
  }
  for (const name of prevRevoked) {
    const nl = name.trim().toLowerCase();
    if (!nl || nextRevLower.has(nl)) continue;
    wins = addPuppetCd(wins, name, item, atMs);
  }

  return dedupeWeeklyWins(wins);
}
