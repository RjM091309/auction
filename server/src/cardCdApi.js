/**
 * Lightweight Puppet Card CD reads — avoids full `getFullState` for list UIs.
 */

import { puppetCardCdDisplayForIgn } from './puppetCardCdDisplay.js';
import { loadWeeklyTypeWins } from './weeklyTypeWins.js';
import { pruneWeeklyTypeWins } from './guildLeagueWinCooldown.js';

const EMPERIUM_CD_MODE = 'Emperium Overrun';
const GUILD_LEAGUE_CD_MODE = 'Guild League';

/** @param {import('mysql2/promise').Pool} pool */
async function loadPrunedWeeklyWins(pool) {
  return pruneWeeklyTypeWins(await loadWeeklyTypeWins(pool));
}

/**
 * @param {import('mysql2/promise').Pool} pool
 * @param {string} eventMode
 */
async function getOnCdRowsForMode(pool, eventMode) {
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
      eventMode,
      nowMs
    );
    if (display.tone !== 'cd') continue;
    rows.push({
      id: Number(row.id),
      name,
      label: display.label,
      title: display.title,
      expiresAt: display.expiresAt ?? null,
      mode: eventMode,
    });
  }
  return rows;
}

/**
 * On CD tab: Guild League + Emperium Overrun lists (server-computed).
 * @param {import('mysql2/promise').Pool} pool
 */
export async function getOnCdList(pool) {
  const nowMs = Date.now();
  const [guildLeague, emperium] = await Promise.all([
    getOnCdRowsForMode(pool, GUILD_LEAGUE_CD_MODE),
    getOnCdRowsForMode(pool, EMPERIUM_CD_MODE),
  ]);
  return { guildLeague, emperium, fetchedAt: nowMs };
}

/**
 * Bidders admin tab: roster + server-computed Card CD per row.
 * @param {import('mysql2/promise').Pool} pool
 * @param {import('./bidders.js').listBidders} listBidders
 * @param {object} actor
 */
export async function listBiddersWithCardCd(pool, listBidders, actor) {
  const nowMs = Date.now();
  const EVENT_MODE_META_KEY = 'event_mode';
  const [bidders, eventRows, weeklyTypeWins] = await Promise.all([
    listBidders(pool, actor),
    pool.query('SELECT value FROM app_meta WHERE `key` = ? LIMIT 1', [
      EVENT_MODE_META_KEY,
    ]),
    loadPrunedWeeklyWins(pool),
  ]);
  const rawMode = eventRows[0]?.[0]?.value;
  const eventMode = rawMode === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
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
