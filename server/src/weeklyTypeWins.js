import { getAuctionWeekMondayKey, getAuctionWeekTimezone } from './auctionWeek.js';
import { isEmperiumCooldownItem, pruneExpiredEmperiumWins } from './emperiumWinCooldown.js';
import { isEmperiumWinStillOnCooldown } from './overrunWeek.js';
import {
  GUILD_LEAGUE_WIN_MODE,
  pruneWeeklyTypeWins,
} from './guildLeagueWinCooldown.js';
import { isGuildLeagueWinStillOnCooldown } from './guildLeagueWeek.js';

export const META_AUCTION_WEEK_MONDAY = 'auction_week_monday';
export const META_WEEKLY_TYPE_WINS = 'weekly_type_wins';

/** @typedef {{ ign: string, t: string, itemId?: string, at?: number, mode?: string }} WeeklyTypeWin — ign is trim + lowercase */

/** @param {unknown} name */
export function normalizeIgn(name) {
  if (name == null || typeof name !== 'string') return '';
  return name.trim().toLowerCase();
}

const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @param {unknown} raw
 * @returns {WeeklyTypeWin[]}
 */
export function parseWeeklyTypeWins(raw) {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    const out = [];
    for (const row of j) {
      if (!row || typeof row !== 'object') continue;
      const t = row.t;
      if (typeof t !== 'string' || !t) continue;

      let itemId;
      if (typeof row.itemId === 'string' && row.itemId.trim()) {
        itemId = row.itemId.trim();
      }

      let at;
      if (typeof row.at === 'number' && Number.isFinite(row.at)) {
        at = row.at;
      } else if (row.at != null && row.at !== '') {
        const n = Number(row.at);
        if (Number.isFinite(n) && n > 0) at = n;
      }

      let ignRaw = row.ign ?? row.n;
      if (ignRaw == null && row.m != null && typeof row.m === 'string') {
        if (UUID_LIKE.test(row.m.trim())) continue;
        ignRaw = row.m;
      }
      const ign = normalizeIgn(ignRaw);
      if (!ign) continue;
      const entry = { ign, t };
      if (itemId) entry.itemId = itemId;
      if (at != null) entry.at = at;
      if (row.mode === 'Guild League') entry.mode = GUILD_LEAGUE_WIN_MODE;
      out.push(entry);
    }
    return out;
  } catch {
    return [];
  }
}

/** @param {unknown} raw */
export function parseWeeklyTypeWinsArray(raw) {
  if (!Array.isArray(raw)) return [];
  return parseWeeklyTypeWins(JSON.stringify(raw));
}

export function serializeWeeklyTypeWins(wins) {
  return JSON.stringify(wins);
}

/**
 * @param {WeeklyTypeWin[]} wins
 * @param {string} ignNormalized trim + lowercase
 * @param {string} itemType
 */
export function memberHasTypeWinThisWeek(wins, ignNormalized, itemType) {
  if (!ignNormalized) return false;
  return wins.some((w) => w.ign === ignNormalized && w.t === itemType);
}

/**
 * Monday rollover: prune Emperium win cooldowns whose unlock Sunday has passed.
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 */
export async function rolloverWeeklyWinsIfNewWeek(q) {
  const timeZone = getAuctionWeekTimezone();
  const mondayKey = getAuctionWeekMondayKey();
  const [rows] = await q.query(
    `SELECT value FROM app_meta WHERE \`key\` = ? LIMIT 1`,
    [META_AUCTION_WEEK_MONDAY]
  );
  const stored = rows[0]?.value != null ? String(rows[0].value) : '';
  if (stored === mondayKey) return;

  const currentWins = await loadWeeklyTypeWins(q);
  const pruned = pruneWeeklyTypeWins(currentWins);

  const [[{ winnerMarkLogRows }]] = await q.query(
    'SELECT COUNT(*) AS winnerMarkLogRows FROM winner_mark_log'
  );

  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_AUCTION_WEEK_MONDAY, mondayKey]
  );
  await saveWeeklyTypeWins(q, pruned);
  console.info(
    `[audit] weekly rollover week=${stored || '(none)'} -> ${mondayKey} tz=${timeZone} emperium_cooldowns_kept=${pruned.length} winner_mark_log_rows_kept=${Number(
      winnerMarkLogRows
    )}`
  );
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @returns {Promise<WeeklyTypeWin[]>}
 */
function metaText(value) {
  if (value == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return typeof value === 'string' ? value : String(value);
}

export async function loadWeeklyTypeWins(q) {
  const [rows] = await q.query(
    `SELECT value FROM app_meta WHERE \`key\` = ? LIMIT 1`,
    [META_WEEKLY_TYPE_WINS]
  );
  return parseWeeklyTypeWins(metaText(rows[0]?.value));
}

/** Dedupe by normalized ign + type + itemId + mode. */
export function dedupeWeeklyWinsList(wins) {
  const winKey = (ign, t, itemId, mode) => `${ign}\0${t}\0${itemId ?? ''}\0${mode ?? ''}`;
  const seen = new Set();
  const out = [];
  for (const w of wins) {
    if (!w || typeof w.ign !== 'string' || typeof w.t !== 'string') continue;
    const k = winKey(w.ign, w.t, w.itemId, w.mode);
    if (seen.has(k)) continue;
    seen.add(k);
    const row = { ign: w.ign, t: w.t };
    if (w.itemId) row.itemId = w.itemId;
    if (typeof w.at === 'number' && Number.isFinite(w.at) && w.at > 0) row.at = w.at;
    if (w.mode === GUILD_LEAGUE_WIN_MODE) row.mode = GUILD_LEAGUE_WIN_MODE;
    out.push(row);
  }
  return out;
}

/**
 * Ensure every completed item with winnerName has a type lock (covers missed diffs).
 * @param {Array<{ status: string, winnerName: string | null | undefined, type: string }>} items
 * @param {WeeklyTypeWin[]} wins
 */
/**
 * Fill missing cooldown rows from `winner_mark_log` (stable `at_ms`, not `Date.now()` on poll).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {Array<{ id: string, type: string, name?: string, recordedWinnerNames?: string[] }>} items
 * @param {WeeklyTypeWin[]} wins
 */
export async function backfillWeeklyWinsFromRecordedWinners(q, items, wins, winMode = undefined) {
  const out = dedupeWeeklyWinsList(wins);
  const winKeyLocal = (ign, t, itemId, mode) => `${ign}\0${t}\0${itemId ?? ''}\0${mode ?? ''}`;
  const seen = new Set(out.map((w) => winKeyLocal(w.ign, w.t, w.itemId, w.mode)));

  for (const it of items) {
    if (!isEmperiumCooldownItem(it)) continue;
    const arr = it.recordedWinnerNames;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (raw == null || typeof raw !== 'string') continue;
      const ign = normalizeIgn(raw);
      if (!ign) continue;
      const k = winKeyLocal(ign, it.type, it.id, winMode);
      if (seen.has(k)) continue;

      const [rows] = await q.query(
        `SELECT at_ms FROM winner_mark_log
         WHERE item_id = ? AND LOWER(TRIM(ign)) = ?
         ORDER BY at_ms DESC LIMIT 1`,
        [it.id, ign]
      );
      const atRaw = rows[0]?.at_ms;
      const at = atRaw != null ? Number(atRaw) : NaN;
      if (!Number.isFinite(at) || at <= 0) continue;
      seen.add(k);
      const row = { ign, t: it.type, itemId: it.id, at };
      if (winMode === GUILD_LEAGUE_WIN_MODE) row.mode = GUILD_LEAGUE_WIN_MODE;
      out.push(row);
    }
  }
  return out;
}

function winKey(ign, t, itemId, mode) {
  return `${ign}\0${t}\0${itemId ?? ''}\0${mode ?? ''}`;
}

function cooldownStillActive(at, winMode, nowMs) {
  if (!Number.isFinite(at) || at <= 0) return false;
  if (winMode === GUILD_LEAGUE_WIN_MODE) {
    return isGuildLeagueWinStillOnCooldown(at, nowMs);
  }
  return isEmperiumWinStillOnCooldown(at, nowMs);
}

/** Keep the newest `at` per IGN when multiple log sources backfill the same row. */
function upsertPuppetCooldownWin(out, ign, t, itemId, at, winMode, nowMs = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return;
  if (!cooldownStillActive(at, winMode, nowMs)) return;
  const k = winKey(ign, t, itemId, winMode);
  const idx = out.findIndex((w) => winKey(w.ign, w.t, w.itemId, w.mode) === k);
  const row = { ign, t, itemId, at };
  if (winMode === GUILD_LEAGUE_WIN_MODE) row.mode = GUILD_LEAGUE_WIN_MODE;
  if (idx >= 0) {
    const prevAt = out[idx].at ?? 0;
    if (at > prevAt) out[idx] = row;
    return;
  }
  out.push(row);
}

/** Admin green-check list (`recordedWinnerNames`) — only these IGNs get Puppet CD. */
function recordedIgnsForItem(it) {
  const arr = it.recordedWinnerNames;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const set = new Set();
  for (const raw of arr) {
    if (raw == null || typeof raw !== 'string') continue;
    const ign = normalizeIgn(raw);
    if (ign) set.add(ign);
  }
  return set.size > 0 ? set : null;
}

async function backfillWeeklyWinsFromIgnAtRows(
  items,
  wins,
  rows,
  nowMs = Date.now(),
  allowNewEntries = true,
  winMode = undefined
) {
  const out = dedupeWeeklyWinsList(wins);
  const existingKeys = new Set(out.map((w) => winKey(w.ign, w.t, w.itemId, w.mode)));
  for (const it of items) {
    if (!isEmperiumCooldownItem(it)) continue;
    const allowed = recordedIgnsForItem(it);
    if (!allowed) continue;
    const latestByIgn = new Map();
    for (const row of rows) {
      if (row.itemId !== it.id) continue;
      const ign = normalizeIgn(row.ign);
      if (!ign || !allowed.has(ign) || latestByIgn.has(ign)) continue;
      latestByIgn.set(ign, Number(row.atMs));
    }
    for (const [ign, at] of latestByIgn) {
      const k = winKey(ign, it.type, it.id, winMode);
      if (!allowNewEntries && !existingKeys.has(k)) continue;
      upsertPuppetCooldownWin(out, ign, it.type, it.id, at, winMode, nowMs);
    }
  }
  return out;
}

/**
 * Rebuild missing Puppet CD timestamps from `winner_mark_log` for IGNs already
 * listed in `recordedWinnerNames` (e.g. after Reset shuffle cleared `at` only).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {Array<{ id: string, type: string, name?: string, recordedWinnerNames?: string[] }>} items
 * @param {WeeklyTypeWin[]} wins
 * @param {number} [nowMs]
 */
export async function backfillWeeklyWinsFromWinnerMarkLog(q, items, wins, nowMs = Date.now(), winMode = undefined) {
  const puppetIds = items.filter(isEmperiumCooldownItem).map((it) => it.id);
  if (puppetIds.length === 0) return dedupeWeeklyWinsList(wins);
  const placeholders = puppetIds.map(() => '?').join(', ');
  const [rows] = await q.query(
    `SELECT item_id AS itemId, ign, at_ms AS atMs FROM winner_mark_log
     WHERE item_id IN (${placeholders})
     ORDER BY at_ms DESC, id DESC`,
    puppetIds
  );
  return backfillWeeklyWinsFromIgnAtRows(items, wins, rows, nowMs, true, winMode);
}

/**
 * Fill `at` from shuffle-lock wins (`bidder_state_log` state = 1) only for IGNs
 * in `recordedWinnerNames` (e.g. shuffle shortlist winner without a mark log row).
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {Array<{ id: string, type: string, name?: string, recordedWinnerNames?: string[] }>} items
 * @param {WeeklyTypeWin[]} wins
 * @param {number} [nowMs]
 * @param {string} [winMode]
 */
export async function backfillWeeklyWinsFromBidderStateLog(q, items, wins, nowMs = Date.now(), winMode = undefined) {
  const puppetIds = items.filter(isEmperiumCooldownItem).map((it) => it.id);
  if (puppetIds.length === 0) return dedupeWeeklyWinsList(wins);
  const placeholders = puppetIds.map(() => '?').join(', ');
  const [rows] = await q.query(
    `SELECT item_id AS itemId, ign, at_ms AS atMs FROM bidder_state_log
     WHERE item_id IN (${placeholders}) AND state = 1
     ORDER BY at_ms DESC, id DESC`,
    puppetIds
  );
  // Refresh timestamps only — never mint CD from GL shuffle rows without winner_mark_log.
  return backfillWeeklyWinsFromIgnAtRows(items, wins, rows, nowMs, false, winMode);
}

/**
 * Active items: bawat bagong pangalan sa `recordedWinnerNames` → cooldown entry (save path).
 * @param {Array<{ id: string, type: string, name?: string, recordedWinnerNames?: string[] }>} items
 * @param {WeeklyTypeWin[]} wins
 * @param {number} [atMs]
 */
export function mergeRecordedWinnerNamesInto(items, wins, atMs = Date.now()) {
  const out = dedupeWeeklyWinsList(wins);
  const winKey = (ign, t, itemId) => `${ign}\0${t}\0${itemId ?? ''}`;
  const seen = new Set(out.map((w) => winKey(w.ign, w.t, w.itemId)));
  for (const it of items) {
    if (!isEmperiumCooldownItem(it)) continue;
    const arr = it.recordedWinnerNames;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (raw == null || typeof raw !== 'string') continue;
      const ign = normalizeIgn(raw);
      if (!ign) continue;
      const k = winKey(ign, it.type, it.id);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ign, t: it.type, itemId: it.id, at: atMs });
    }
  }
  return out;
}

export function mergeCompletedItemWinsInto(items, wins, atMs = Date.now()) {
  const out = dedupeWeeklyWinsList(wins);
  const winKey = (ign, t, itemId) => `${ign}\0${t}\0${itemId ?? ''}`;
  const seen = new Set(out.map((w) => winKey(w.ign, w.t, w.itemId)));
  for (const it of items) {
    if (it.status !== 'completed' || it.winnerName == null) continue;
    const ign = normalizeIgn(it.winnerName);
    if (!ign) continue;
    const k = winKey(ign, it.type, it.id);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ign, t: it.type, itemId: it.id, at: atMs });
  }
  return out;
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {WeeklyTypeWin[]} wins
 */
export async function saveWeeklyTypeWins(q, wins) {
  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_WEEKLY_TYPE_WINS, serializeWeeklyTypeWins(wins)]
  );
}

/**
 * Merge DB snapshot → incoming save: new completions / winner renames update weekly wins (by IGN, not member id).
 * @param {Array<{ id: string, type: string, status: string, winnerName: string | null }>} oldItems
 * @param {Array<{ id: string, type: string, status: string, winnerName: string | null }>} newItems
 * @param {WeeklyTypeWin[]} currentWins
 * @returns {WeeklyTypeWin[]}
 */
export function applyWeeklyWinnerDiff(oldItems, newItems, currentWins, atMs = Date.now()) {
  const oldMap = new Map(
    oldItems.map((r) => [
      r.id,
      {
        status: r.status,
        winnerName: r.winnerName,
        type: r.type,
      },
    ])
  );

  const winKey = (ign, t, itemId) => `${ign}\0${t}\0${itemId ?? ''}`;
  const deduped = [];
  const seen = new Set();
  for (const w of currentWins) {
    const k = winKey(w.ign, w.t, w.itemId);
    if (seen.has(k)) continue;
    seen.add(k);
    const row = { ign: w.ign, t: w.t };
    if (w.itemId) row.itemId = w.itemId;
    if (typeof w.at === 'number' && Number.isFinite(w.at) && w.at > 0) row.at = w.at;
    deduped.push(row);
  }

  const setWin = (ign, t, itemId) => {
    const ignN = normalizeIgn(ign);
    if (!ignN || !t) return;
    const k = winKey(ignN, t, itemId);
    if (seen.has(k)) return;
    seen.add(k);
    deduped.push({ ign: ignN, t, itemId, at: atMs });
  };

  const removeWin = (ign, t, itemId) => {
    const ignN = normalizeIgn(ign);
    if (!ignN || !t) return;
    const k = winKey(ignN, t, itemId);
    const idx = deduped.findIndex((w) => winKey(w.ign, w.t, w.itemId) === k);
    if (idx < 0) return;
    deduped.splice(idx, 1);
    seen.delete(k);
  };

  for (const it of newItems) {
    const o = oldMap.get(it.id);
    const nowName =
      it.status === 'completed' && it.winnerName != null
        ? String(it.winnerName).trim()
        : '';
    const oldName =
      o && o.status === 'completed' && o.winnerName != null
        ? String(o.winnerName).trim()
        : '';

    if (nowName && !oldName) {
      setWin(it.winnerName, it.type, it.id);
      continue;
    }

    if (nowName && oldName && oldName.toLowerCase() !== nowName.toLowerCase()) {
      removeWin(o.winnerName, it.type, it.id);
      setWin(it.winnerName, it.type, it.id);
    }
  }

  return deduped;
}
