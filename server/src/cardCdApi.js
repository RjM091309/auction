/**
 * Lightweight Puppet Card CD reads — avoids full `getFullState` for list UIs.
 */

import { pruneExpiredEmperiumWins } from './emperiumWinCooldown.js';
import { puppetCardCdDisplayForIgn } from './puppetCardCdDisplay.js';
import { loadWeeklyTypeWins } from './weeklyTypeWins.js';

const EVENT_MODE_META_KEY = 'event_mode';
const EMPERIUM_CD_MODE = 'Emperium Overrun';

/** @param {import('mysql2/promise').Pool} pool */
async function loadEventMode(pool) {
  const [rows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [EVENT_MODE_META_KEY]
  );
  const raw = rows[0]?.value;
  return raw === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

/** @param {import('mysql2/promise').Pool} pool */
async function loadPrunedWeeklyWins(pool) {
  return pruneExpiredEmperiumWins(await loadWeeklyTypeWins(pool));
}

/**
 * On CD tab: rows pre-filtered to bidders currently on Puppet Card CD.
 * @param {import('mysql2/promise').Pool} pool
 */
export async function getOnCdList(pool) {
  const nowMs = Date.now();
  const [memberRows] = await pool.query(
    'SELECT id, name FROM members WHERE active = 1 ORDER BY name ASC'
  );
  const weeklyTypeWins = await loadPrunedWeeklyWins(pool);
  const rows = [];
  for (const row of memberRows) {
    const name = String(row.name ?? '').trim();
    if (!name) continue;
    const display = puppetCardCdDisplayForIgn(
      name,
      weeklyTypeWins,
      EMPERIUM_CD_MODE,
      nowMs
    );
    if (display.tone !== 'cd') continue;
    rows.push({
      id: Number(row.id),
      name,
      label: display.label,
      title: display.title,
      expiresAt: display.expiresAt ?? null,
    });
  }
  return { rows, fetchedAt: nowMs };
}

/**
 * Bidders admin tab: roster + server-computed Card CD per row.
 * @param {import('mysql2/promise').Pool} pool
 * @param {import('./bidders.js').listBidders} listBidders
 * @param {object} actor
 */
export async function listBiddersWithCardCd(pool, listBidders, actor) {
  const nowMs = Date.now();
  const [bidders, eventMode, weeklyTypeWins] = await Promise.all([
    listBidders(pool, actor),
    loadEventMode(pool),
    loadPrunedWeeklyWins(pool),
  ]);
  const enriched = bidders.map((b) => ({
    ...b,
    cardCd: puppetCardCdDisplayForIgn(
      b.name,
      weeklyTypeWins,
      eventMode,
      nowMs
    ),
  }));
  return { bidders: enriched, eventMode, fetchedAt: nowMs };
}
