import { getAuctionWeekMondayKey, getAuctionWeekTimezone } from './auctionWeek.js';

export const META_AUCTION_WEEK_MONDAY = 'auction_week_monday';
export const META_WEEKLY_TYPE_WINS = 'weekly_type_wins';

/** @typedef {{ ign: string, t: string }} WeeklyTypeWin — ign is trim + lowercase */

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

      let ignRaw = row.ign ?? row.n;
      if (ignRaw == null && row.m != null && typeof row.m === 'string') {
        if (UUID_LIKE.test(row.m.trim())) continue;
        ignRaw = row.m;
      }
      const ign = normalizeIgn(ignRaw);
      if (!ign) continue;
      out.push({ ign, t });
    }
    return out;
  } catch {
    return [];
  }
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
 * If the stored Monday key differs from today’s auction week, clear wins and update the key.
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

  const [[{ bidderStateLogRows }]] = await q.query(
    'SELECT COUNT(*) AS bidderStateLogRows FROM bidder_state_log'
  );
  const [[{ winnerMarkLogRows }]] = await q.query(
    'SELECT COUNT(*) AS winnerMarkLogRows FROM winner_mark_log'
  );

  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_AUCTION_WEEK_MONDAY, mondayKey]
  );
  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_WEEKLY_TYPE_WINS, '[]']
  );
  /** New auction week starts every Monday: clear weekly bidder outcome log (win/loss/ongoing history). */
  await q.query(`DELETE FROM bidder_state_log`);
  console.info(
    `[audit] weekly rollover week=${stored || '(none)'} -> ${mondayKey} tz=${timeZone} reset weekly_type_wins + bidder_state_log_rows=${Number(
      bidderStateLogRows
    )} winner_mark_log_rows_kept=${Number(winnerMarkLogRows)}`
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

/** Dedupe by normalized ign + type. */
export function dedupeWeeklyWinsList(wins) {
  const winKey = (ign, t) => `${ign}\0${t}`;
  const seen = new Set();
  const out = [];
  for (const w of wins) {
    if (!w || typeof w.ign !== 'string' || typeof w.t !== 'string') continue;
    const k = winKey(w.ign, w.t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ign: w.ign, t: w.t });
  }
  return out;
}

/**
 * Ensure every completed item with winnerName has a type lock (covers missed diffs).
 * @param {Array<{ status: string, winnerName: string | null | undefined, type: string }>} items
 * @param {WeeklyTypeWin[]} wins
 */
/**
 * Active items: bawat pangalan sa `recordedWinnerNames` → lingguhang type lock.
 * @param {Array<{ type: string, recordedWinnerNames?: string[] }>} items
 * @param {WeeklyTypeWin[]} wins
 */
export function mergeRecordedWinnerNamesInto(items, wins) {
  const out = dedupeWeeklyWinsList(wins);
  const winKey = (ign, t) => `${ign}\0${t}`;
  const seen = new Set(out.map((w) => winKey(w.ign, w.t)));
  for (const it of items) {
    const arr = it.recordedWinnerNames;
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      if (raw == null || typeof raw !== 'string') continue;
      const ign = normalizeIgn(raw);
      if (!ign) continue;
      const k = winKey(ign, it.type);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ ign, t: it.type });
    }
  }
  return out;
}

export function mergeCompletedItemWinsInto(items, wins) {
  const out = dedupeWeeklyWinsList(wins);
  const winKey = (ign, t) => `${ign}\0${t}`;
  const seen = new Set(out.map((w) => winKey(w.ign, w.t)));
  for (const it of items) {
    if (it.status !== 'completed' || it.winnerName == null) continue;
    const ign = normalizeIgn(it.winnerName);
    if (!ign) continue;
    const k = winKey(ign, it.type);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ ign, t: it.type });
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
export function applyWeeklyWinnerDiff(oldItems, newItems, currentWins) {
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

  const winKey = (ign, t) => `${ign}\0${t}`;
  const deduped = [];
  const seen = new Set();
  for (const w of currentWins) {
    const k = winKey(w.ign, w.t);
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push({ ign: w.ign, t: w.t });
  }

  const setWin = (ign, t) => {
    const ignN = normalizeIgn(ign);
    if (!ignN || !t) return;
    const k = winKey(ignN, t);
    if (seen.has(k)) return;
    seen.add(k);
    deduped.push({ ign: ignN, t });
  };

  const removeWin = (ign, t) => {
    const ignN = normalizeIgn(ign);
    if (!ignN || !t) return;
    const k = winKey(ignN, t);
    const idx = deduped.findIndex((w) => winKey(w.ign, w.t) === k);
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
      setWin(it.winnerName, it.type);
      continue;
    }

    if (nowName && oldName && oldName.toLowerCase() !== nowName.toLowerCase()) {
      removeWin(o.winnerName, it.type);
      setWin(it.winnerName, it.type);
    }
  }

  return deduped;
}
