/**
 * Unified log: shuffle lock → Win/Loss in `bidder_state_log` only.
 * Admin green-check marks go to `winner_mark_log` (not duplicated here).
 * state: 0 = loss, 1 = win (pool), 2 = legacy “ongoing” from older saves.
 */

export const MAX_BIDDER_STATE_LOG_ROWS = 3000;

/**
 * @param {import('mysql2/promise').Pool | import('mysql2/promise').PoolConnection} q
 * @returns {Promise<Array<{
 *   id: number;
 *   at: number;
 *   memberId: number | null;
 *   ign: string;
 *   itemId: string;
 *   itemName: string;
 *   itemType: string;
 *   state: number;
 *   poolCap: number | null;
 *   queuePosition: number | null;
 *   shuffleBatchAtMs: number | null;
 * }>>}
 */
export async function loadBidderStateLog(q) {
  const [rows] = await q.query(
    `SELECT id, at_ms AS atMs, member_id AS memberId, ign, item_id AS itemId,
            item_name AS itemName, item_type AS itemType, state,
            pool_cap AS poolCap, queue_position AS queuePosition,
            shuffle_batch_at_ms AS shuffleBatchAtMs
     FROM bidder_state_log
     ORDER BY at_ms DESC, id DESC
     LIMIT ?`,
    [MAX_BIDDER_STATE_LOG_ROWS]
  );
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    id: Number(r.id),
    at: Number(r.atMs),
    memberId:
      r.memberId != null && r.memberId !== ''
        ? Number(r.memberId)
        : null,
    ign: String(r.ign ?? ''),
    itemId: String(r.itemId ?? ''),
    itemName: String(r.itemName ?? ''),
    itemType: String(r.itemType ?? ''),
    state: Number(r.state),
    poolCap:
      r.poolCap != null && r.poolCap !== '' ? Number(r.poolCap) : null,
    queuePosition:
      r.queuePosition != null && r.queuePosition !== ''
        ? Number(r.queuePosition)
        : null,
    shuffleBatchAtMs:
      r.shuffleBatchAtMs != null && r.shuffleBatchAtMs !== ''
        ? Number(r.shuffleBatchAtMs)
        : null,
  }));
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 * @param {Array<{
 *   at: number;
 *   memberId: number | null;
 *   ign: string;
 *   itemId: string;
 *   itemName: string;
 *   itemType: string;
 *   state: number;
 *   poolCap: number | null;
 *   queuePosition: number | null;
 *   shuffleBatchAtMs: number | null;
 * }>} entries
 */
export async function appendBidderStateLog(conn, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  for (const e of entries) {
    await conn.query(
      `INSERT INTO bidder_state_log (
         at_ms, logged_at, member_id, ign, item_id, item_name, item_type, state,
         pool_cap, queue_position, shuffle_batch_at_ms
       ) VALUES (?, FROM_UNIXTIME(? / 1000.0), ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.at,
        e.at,
        e.memberId != null && e.memberId > 0 ? e.memberId : null,
        e.ign,
        e.itemId,
        e.itemName,
        e.itemType,
        e.state,
        e.poolCap != null ? e.poolCap : null,
        e.queuePosition != null ? e.queuePosition : null,
        e.shuffleBatchAtMs != null ? e.shuffleBatchAtMs : null,
      ]
    );
  }
  await trimBidderStateLog(conn);
}

/**
 * @param {import('mysql2/promise').PoolConnection} conn
 */
export async function trimBidderStateLog(conn) {
  await conn.query(
    `DELETE FROM bidder_state_log WHERE id NOT IN (
       SELECT id FROM (
         SELECT id FROM bidder_state_log ORDER BY at_ms DESC, id DESC LIMIT ?
       ) AS keep_ids
     )`,
    [MAX_BIDDER_STATE_LOG_ROWS]
  );
}

/** One-time: copy legacy winner marks as state=1 rows when unified log is empty. */
export async function backfillBidderStateLogFromWinnerMarks(pool) {
  const [[{ c }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM bidder_state_log'
  );
  if (Number(c) > 0) return;
  const [[{ w }]] = await pool.query(
    'SELECT COUNT(*) AS c FROM winner_mark_log'
  );
  if (Number(w) === 0) return;
  await pool.query(`
    INSERT INTO bidder_state_log (
      at_ms, logged_at, member_id, ign, item_id, item_name, item_type, state,
      pool_cap, queue_position, shuffle_batch_at_ms
    )
    SELECT at_ms, logged_at, NULL, ign, item_id, item_name, item_type, 1,
           NULL, NULL, NULL
    FROM winner_mark_log
  `);
}
