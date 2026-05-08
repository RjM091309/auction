import { getAuctionWeekTimezone } from './auctionWeek.js';
import { getOverrunSundayKey } from './overrunWeek.js';

export const META_OVERRUN_REWARDS_ENABLED = 'overrun_rewards_enabled';
export const META_OVERRUN_REWARDS_CONFIG = 'overrun_rewards_config_json';
export const META_OVERRUN_RANKING = 'overrun_rewards_ranking_json';

/**
 * Quantities: [LND, TNS, Puppet Frag]
 * @typedef {{ lnd: number, tns: number, frag: number }} OverrunRewardQty
 * @typedef {{ rankMin: number, rankMax: number | null, qty: OverrunRewardQty }} OverrunRewardBand
 * @typedef {{ enabled: boolean, tz: string, bands: OverrunRewardBand[] }} OverrunRewardsConfig
 * @typedef {{ ign: string, rank: number }} OverrunRankingRow
 * @typedef {{ ign: string, rank: number, qty: OverrunRewardQty }} OverrunPayoutRow
 */

/** @returns {OverrunRewardsConfig} */
export function defaultOverrunRewardsConfig() {
  return {
    enabled: false,
    tz: getAuctionWeekTimezone(),
    bands: [
      { rankMin: 1, rankMax: 1, qty: { lnd: 150, tns: 170, frag: 20 } },
      { rankMin: 2, rankMax: 2, qty: { lnd: 140, tns: 160, frag: 20 } },
      { rankMin: 3, rankMax: 3, qty: { lnd: 140, tns: 160, frag: 20 } },
      { rankMin: 4, rankMax: 4, qty: { lnd: 120, tns: 150, frag: 15 } },
      { rankMin: 5, rankMax: 5, qty: { lnd: 120, tns: 150, frag: 15 } },
      { rankMin: 6, rankMax: 6, qty: { lnd: 120, tns: 150, frag: 15 } },
      { rankMin: 7, rankMax: 7, qty: { lnd: 100, tns: 150, frag: 12 } },
      { rankMin: 8, rankMax: null, qty: { lnd: 100, tns: 150, frag: 12 } },
    ],
  };
}

function toInt(n, fallback = 0) {
  const x = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.max(0, Math.floor(x));
}

function metaText(value) {
  if (value == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return typeof value === 'string' ? value : String(value);
}

/** @param {unknown} raw @returns {OverrunRewardsConfig | null} */
export function parseOverrunRewardsConfig(raw) {
  if (raw == null) return null;
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  try {
    const j = JSON.parse(raw);
    if (!j || typeof j !== 'object') return null;
    const o = /** @type {Record<string, unknown>} */ (j);
    const enabled = o.enabled === true;
    const tz =
      typeof o.tz === 'string' && o.tz.trim() ? o.tz.trim() : getAuctionWeekTimezone();
    const bandsRaw = Array.isArray(o.bands) ? o.bands : [];
    /** @type {OverrunRewardBand[]} */
    const bands = [];
    for (const row of bandsRaw) {
      if (!row || typeof row !== 'object') continue;
      const r = /** @type {Record<string, unknown>} */ (row);
      const rankMin = toInt(r.rankMin, 0);
      const rankMax =
        r.rankMax == null || r.rankMax === ''
          ? null
          : Number.isFinite(Number(r.rankMax))
            ? Math.max(0, Math.floor(Number(r.rankMax)))
            : null;
      const q = r.qty && typeof r.qty === 'object' ? /** @type {Record<string, unknown>} */ (r.qty) : {};
      const qty = { lnd: toInt(q.lnd, 0), tns: toInt(q.tns, 0), frag: toInt(q.frag, 0) };
      if (rankMin <= 0) continue;
      bands.push({ rankMin, rankMax, qty });
    }
    if (bands.length === 0) return null;
    return { enabled, tz, bands };
  } catch {
    return null;
  }
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @returns {Promise<OverrunRewardsConfig>}
 */
export async function loadOverrunRewardsConfig(q) {
  const [rows] = await q.query(
    `SELECT value FROM app_meta WHERE \`key\` = ? LIMIT 1`,
    [META_OVERRUN_REWARDS_CONFIG]
  );
  const parsed = parseOverrunRewardsConfig(metaText(rows[0]?.value));
  return parsed ?? defaultOverrunRewardsConfig();
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {OverrunRewardsConfig} cfg
 */
export async function saveOverrunRewardsConfig(q, cfg) {
  const payload = JSON.stringify({
    enabled: cfg.enabled === true,
    tz: typeof cfg.tz === 'string' && cfg.tz.trim() ? cfg.tz.trim() : getAuctionWeekTimezone(),
    bands: Array.isArray(cfg.bands) ? cfg.bands : [],
  });
  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_OVERRUN_REWARDS_CONFIG, payload]
  );
  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_OVERRUN_REWARDS_ENABLED, cfg.enabled === true ? '1' : '0']
  );
}

/** @param {OverrunRewardsConfig} cfg */
export function normalizeRewardBands(cfg) {
  const bands = Array.isArray(cfg.bands) ? cfg.bands : [];
  return bands
    .map((b) => ({
      rankMin: toInt(b.rankMin, 0),
      rankMax: b.rankMax == null ? null : toInt(b.rankMax, 0),
      qty: { lnd: toInt(b.qty?.lnd, 0), tns: toInt(b.qty?.tns, 0), frag: toInt(b.qty?.frag, 0) },
    }))
    .filter((b) => b.rankMin > 0)
    .sort((a, b) => a.rankMin - b.rankMin);
}

/** @param {OverrunRewardsConfig} cfg @param {number} rank @returns {OverrunRewardQty} */
export function qtyForRank(cfg, rank) {
  const r = toInt(rank, 0);
  const bands = normalizeRewardBands(cfg);
  for (const b of bands) {
    const max = b.rankMax == null ? Infinity : b.rankMax;
    if (r >= b.rankMin && r <= max) return b.qty;
  }
  return { lnd: 0, tns: 0, frag: 0 };
}

/** @param {string} ign */
export function normalizeIgn(ign) {
  if (ign == null || typeof ign !== 'string') return '';
  return ign.trim();
}

/**
 * @param {OverrunRewardsConfig} cfg
 * @param {OverrunRankingRow[]} ranking
 * @returns {OverrunPayoutRow[]}
 */
export function computePayouts(cfg, ranking) {
  const out = [];
  const seen = new Set();
  for (const row of ranking) {
    if (!row) continue;
    const ign = normalizeIgn(row.ign);
    const rank = toInt(row.rank, 0);
    if (!ign || rank <= 0) continue;
    const key = ign.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ign, rank, qty: qtyForRank(cfg, rank) });
  }
  out.sort((a, b) => a.rank - b.rank || a.ign.localeCompare(b.ign));
  return out;
}

/** @param {unknown} raw @returns {OverrunRankingRow[]} */
export function parseOverrunRanking(raw) {
  if (raw == null) return [];
  if (typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    /** @type {OverrunRankingRow[]} */
    const out = [];
    for (const row of j) {
      if (!row || typeof row !== 'object') continue;
      const r = /** @type {Record<string, unknown>} */ (row);
      const ign = normalizeIgn(r.ign ?? r.name ?? '');
      const rank = toInt(r.rank ?? r.r ?? 0, 0);
      if (!ign || rank <= 0) continue;
      out.push({ ign, rank });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @returns {Promise<OverrunRankingRow[]>}
 */
export async function loadOverrunRanking(q) {
  const [rows] = await q.query(
    `SELECT value FROM app_meta WHERE \`key\` = ? LIMIT 1`,
    [META_OVERRUN_RANKING]
  );
  return parseOverrunRanking(metaText(rows[0]?.value));
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @param {OverrunRankingRow[]} ranking
 */
export async function saveOverrunRanking(q, ranking) {
  const payload = JSON.stringify(Array.isArray(ranking) ? ranking : []);
  await q.query(
    `INSERT INTO app_meta (\`key\`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [META_OVERRUN_RANKING, payload]
  );
}

/**
 * Run once per Sunday key. Stores an audit row in `overrun_rewards_runs`.
 *
 * @param {import('mysql2/promise').Pool} pool
 * @param {{
 *   ranking: OverrunRankingRow[],
 *   requestedBy: string,
 *   nowMs?: number,
 *   force?: boolean
 * }} args
 */
export async function runOverrunRewards(pool, args) {
  const nowMs = typeof args.nowMs === 'number' ? args.nowMs : Date.now();
  const cfg = await loadOverrunRewardsConfig(pool);
  const tz = cfg.tz || getAuctionWeekTimezone();
  const sundayKey = getOverrunSundayKey(nowMs, tz);

  const requestedBy = typeof args.requestedBy === 'string' ? args.requestedBy : 'admin';
  const ranking = Array.isArray(args.ranking) ? args.ranking : [];
  const payouts = computePayouts(cfg, ranking);

  if (cfg.enabled !== true) {
    return { ok: false, skipped: true, reason: 'disabled', sundayKey, cfg, payouts };
  }
  if (payouts.length === 0) {
    return { ok: false, skipped: true, reason: 'no_ranking', sundayKey, cfg, payouts };
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (args.force !== true) {
      const [prevRows] = await conn.query(
        'SELECT id FROM overrun_rewards_runs WHERE sunday_key = ? LIMIT 1',
        [sundayKey]
      );
      if (Array.isArray(prevRows) && prevRows.length > 0) {
        await conn.commit();
        return { ok: false, skipped: true, reason: 'already_ran', sundayKey, cfg, payouts };
      }
    }

    const createdAt = new Date(nowMs);
    const configJson = JSON.stringify(cfg);
    const rankingJson = JSON.stringify(ranking);
    const payoutsJson = JSON.stringify(payouts);
    const msg = `requestedBy=${requestedBy} tz=${tz} payouts=${payouts.length}`;

    await conn.query(
      `INSERT INTO overrun_rewards_runs
       (sunday_key, created_at_ms, created_at, status, message, config_json, ranking_json, payouts_json)
       VALUES (?, ?, ?, 'ok', ?, ?, ?, ?)`,
      [sundayKey, nowMs, createdAt, msg, configJson, rankingJson, payoutsJson]
    );

    await conn.commit();
    return { ok: true, sundayKey, cfg, payouts };
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

