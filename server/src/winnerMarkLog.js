/**
 * Winner marks (admin green check): one row per event in `winner_mark_log`.
 */

export const MAX_WINNER_MARK_LOG_ROWS = 500;

/**
 * One-time migration: parse legacy app_meta JSON blob.
 * @param {unknown} raw
 * @returns {Array<{ at: number; ign: string; itemId: string; itemName: string; itemType: string }>}
 */
export function parseLegacyWinnerMarkBlob(raw) {
  if (raw == null || typeof raw !== 'string' || raw.trim() === '') return [];
  try {
    const j = JSON.parse(raw);
    if (!Array.isArray(j)) return [];
    const out = [];
    for (const row of j) {
      if (!row || typeof row !== 'object') continue;
      const at = Number(row.at);
      const ign = typeof row.ign === 'string' ? row.ign.trim() : '';
      const itemId = typeof row.itemId === 'string' ? row.itemId.trim() : '';
      const itemName = typeof row.itemName === 'string' ? row.itemName : '';
      const itemType = typeof row.itemType === 'string' ? row.itemType : '';
      if (!Number.isFinite(at) || !ign || !itemId) continue;
      out.push({ at, ign, itemId, itemName, itemType });
    }
    return out;
  } catch {
    return [];
  }
}

function metaText(value) {
  if (value == null) return '';
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
    return value.toString('utf8');
  }
  return typeof value === 'string' ? value : String(value);
}

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @returns {Promise<Array<{ id: number; at: number; ign: string; itemId: string; itemName: string; itemType: string }>>}
 */
export async function loadWinnerMarkLog(q) {
  const [rows] = await q.query(
    `SELECT id, at_ms AS atMs, ign, item_id AS itemId, item_name AS itemName, item_type AS itemType
     FROM winner_mark_log
     ORDER BY at_ms DESC, id DESC
     LIMIT ?`,
    [MAX_WINNER_MARK_LOG_ROWS]
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id),
    at: Number(r.atMs),
    ign: String(r.ign ?? ''),
    itemId: String(r.itemId ?? ''),
    itemName: String(r.itemName ?? ''),
    itemType: String(r.itemType ?? ''),
  }));
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {Array<{ at: number; ign: string; itemId: string; itemName: string; itemType: string }>} newEntries
 */
export async function appendWinnerMarkLog(conn, newEntries) {
  if (!Array.isArray(newEntries) || newEntries.length === 0) return;
  for (const e of newEntries) {
    await conn.query(
      `INSERT INTO winner_mark_log (at_ms, logged_at, ign, item_id, item_name, item_type)
       VALUES (?, FROM_UNIXTIME(? / 1000.0), ?, ?, ?, ?)`,
      [e.at, e.at, e.ign, e.itemId, e.itemName, e.itemType]
    );
  }
  await trimWinnerMarkLog(conn);
}

/**
 * Keep the newest MAX_WINNER_MARK_LOG_ROWS rows.
 * @param {import('mysql2/promise').PoolConnection} conn
 */
export async function trimWinnerMarkLog(conn) {
  await conn.query(
    `DELETE FROM winner_mark_log WHERE id NOT IN (
       SELECT id FROM (
         SELECT id FROM winner_mark_log ORDER BY at_ms DESC, id DESC LIMIT ?
       ) AS keep_ids
     )`,
    [MAX_WINNER_MARK_LOG_ROWS]
  );
}

/** @param {import('mysql2/promise').Pool} pool */
export async function migrateLegacyWinnerMarkMetaToTable(pool) {
  const [[{ c }]] = await pool.query('SELECT COUNT(*) AS c FROM winner_mark_log');
  if (Number(c) > 0) {
    await pool.query(`DELETE FROM app_meta WHERE \`key\` = 'winner_mark_log'`);
    return;
  }

  const [rows] = await pool.query(
    `SELECT value FROM app_meta WHERE \`key\` = 'winner_mark_log' LIMIT 1`
  );
  const raw = metaText(rows[0]?.value);
  const legacy = parseLegacyWinnerMarkBlob(raw);
  if (legacy.length === 0) {
    await pool.query(`DELETE FROM app_meta WHERE \`key\` = 'winner_mark_log'`);
    return;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const e of legacy) {
      await conn.query(
        `INSERT INTO winner_mark_log (at_ms, logged_at, ign, item_id, item_name, item_type)
         VALUES (?, FROM_UNIXTIME(? / 1000.0), ?, ?, ?, ?)`,
        [e.at, e.at, e.ign, e.itemId, e.itemName, e.itemType]
      );
    }
    await trimWinnerMarkLog(conn);
    await conn.query(`DELETE FROM app_meta WHERE \`key\` = 'winner_mark_log'`);
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
