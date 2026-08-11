import type { AuctionItem, WeeklyEventType, WeeklyTypeWin } from '../types';
import {
  isEmperiumCooldownItem,
  isEmperiumWinCooldownEnabled,
} from './emperiumWinCooldown';
import {
  GUILD_LEAGUE_WIN_MODE,
  isGuildLeagueWinCooldownEnabled,
  pruneWeeklyTypeWins,
} from './guildLeagueWinCooldown';
import { normalizeIgn } from './weeklyTypeWins';

export type WinnerCooldownScope = 'emperium' | 'guild';

function winKey(
  ign: string,
  t: string,
  itemId?: string,
  mode?: WeeklyEventType
): string {
  return `${normalizeIgn(ign)}\0${t}\0${itemId ?? ''}\0${mode ?? ''}`;
}

function removePuppetCd(
  wins: WeeklyTypeWin[],
  ign: string,
  item: Pick<AuctionItem, 'id' | 'type'>,
  mode: WinnerCooldownScope
): WeeklyTypeWin[] {
  const nl = normalizeIgn(ign);
  if (!nl) return wins;
  const targetMode =
    mode === 'guild' ? GUILD_LEAGUE_WIN_MODE : undefined;
  return wins.filter((w) => {
    if (w.ign !== nl) return true;
    if (w.t !== item.type) return true;
    if (w.itemId != null && w.itemId !== item.id) return true;
    if (mode === 'guild') return w.mode !== GUILD_LEAGUE_WIN_MODE;
    return w.mode === GUILD_LEAGUE_WIN_MODE;
  });
}

function addPuppetCd(
  wins: WeeklyTypeWin[],
  ign: string,
  item: Pick<AuctionItem, 'id' | 'type'>,
  at: number,
  mode: WinnerCooldownScope
): WeeklyTypeWin[] {
  const nl = normalizeIgn(ign);
  if (!nl) return wins;
  const winMode = mode === 'guild' ? GUILD_LEAGUE_WIN_MODE : undefined;
  const k = winKey(nl, item.type, item.id, winMode);
  if (
    wins.some(
      (w) =>
        winKey(w.ign, w.t, w.itemId, w.mode) === k &&
        typeof w.at === 'number' &&
        w.at > 0
    )
  ) {
    return wins;
  }
  const row: WeeklyTypeWin = { ign: nl, t: item.type, itemId: item.id, at };
  if (winMode) row.mode = winMode;
  return [...wins, row];
}

function dedupeWeeklyWins(wins: WeeklyTypeWin[]): WeeklyTypeWin[] {
  const seen = new Set<string>();
  const out: WeeklyTypeWin[] = [];
  for (const w of wins) {
    const k = winKey(w.ign, w.t, w.itemId, w.mode);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/**
 * Which Puppet winner CD applies for manual marks — never both at once.
 * Unsaved event-mode draft that differs from saved mode disables CD sync.
 */
export function winnerMarkCooldownScope(
  savedEventMode: WeeklyEventType | undefined,
  draftEventMode?: WeeklyEventType | undefined
): WinnerCooldownScope | false {
  if (
    draftEventMode != null &&
    savedEventMode != null &&
    draftEventMode !== savedEventMode
  ) {
    return false;
  }
  const mode = draftEventMode ?? savedEventMode;
  if (mode === 'Guild League') return 'guild';
  if (isEmperiumWinCooldownEnabled(mode)) return 'emperium';
  return false;
}

export function winnerMarkCooldownApplies(
  savedEventMode: WeeklyEventType | undefined,
  draftEventMode?: WeeklyEventType | undefined
): boolean {
  return winnerMarkCooldownScope(savedEventMode, draftEventMode) !== false;
}

/**
 * Keep weekly_type_wins in sync when admin manually marks/unmarks Puppet winners.
 */
export function syncWeeklyWinsForWinnerMarkChange(
  scope: WinnerCooldownScope,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  prevRecorded: readonly string[],
  nextRecorded: readonly string[],
  prevRevoked: readonly string[],
  nextRevoked: readonly string[],
  weeklyTypeWins: WeeklyTypeWin[] | undefined,
  atMs = Date.now()
): WeeklyTypeWin[] | undefined {
  const eventMode =
    scope === 'guild' ? ('Guild League' as const) : ('Emperium Overrun' as const);
  if (scope === 'emperium' && !isEmperiumWinCooldownEnabled(eventMode)) {
    return undefined;
  }
  if (scope === 'guild' && !isGuildLeagueWinCooldownEnabled(eventMode)) {
    return undefined;
  }
  if (!isEmperiumCooldownItem(item)) return undefined;

  let wins = pruneWeeklyTypeWins(weeklyTypeWins ?? []);

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
    wins = addPuppetCd(wins, name, item, atMs, scope);
  }
  for (const name of prevRecorded) {
    const nl = name.trim().toLowerCase();
    if (!nl || nextRecLower.has(nl)) continue;
    wins = removePuppetCd(wins, name, item, scope);
  }
  for (const name of nextRevoked) {
    const nl = name.trim().toLowerCase();
    if (!nl || prevRevLower.has(nl)) continue;
    wins = removePuppetCd(wins, name, item, scope);
  }
  for (const name of prevRevoked) {
    const nl = name.trim().toLowerCase();
    if (!nl || nextRevLower.has(nl)) continue;
    wins = addPuppetCd(wins, name, item, atMs, scope);
  }

  return dedupeWeeklyWins(wins);
}
