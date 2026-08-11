import mysql from 'mysql2/promise';
import { DATA_VERSION, DEFAULT_AUCTION_ITEMS } from './defaults.js';
import { migrateLegacyWinnerMarkMetaToTable } from './winnerMarkLog.js';
import { backfillBidderStateLogFromWinnerMarks } from './bidderStateLog.js';

/** Ping DB once and log when TCP/auth + DB selection succeed. */
export async function verifyMysqlConnection(pool) {
  await pool.query('SELECT 1');
  const host = process.env.MYSQL_HOST ?? '127.0.0.1';
  const port = Number(process.env.MYSQL_PORT ?? 3306);
  const database = process.env.MYSQL_DATABASE ?? 'rooc';
  console.log(`[db] connected to MySQL ${host}:${port}/${database}`);
}

export function createPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'rooc',
    waitForConnections: true,
    // `getFullState()` alone fans out ~14 parallel queries per call, so the
    // old limit of 10 meant a single poll could saturate the whole pool —
    // every additional concurrent user just queued behind it. Raised with
    // headroom now that `/api/state` polling shares reads via
    // `getFullStateCached` (stateRepo.js), so this mainly covers writes and
    // cache-miss bursts, not one connection per polling tab.
    connectionLimit: 25,
    enableKeepAlive: true,
  });
}

/**
 * CRUD tables for guild auction state (`src/types.ts`, `src/App.tsx`).
 * One statement per query so mysql2 works without multipleStatements.
 */
export async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role ENUM('Officer', 'Member', 'Developer', 'Admin') NOT NULL,
      password VARCHAR(255) NOT NULL DEFAULT '',
      active TINYINT(1) NOT NULL DEFAULT 1,
      INDEX idx_members_name (name),
      INDEX idx_members_active (active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auction_items (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(512) NOT NULL,
      type VARCHAR(64) NOT NULL,
      winner_pool_cap INT NULL,
      winner_name VARCHAR(255) NULL,
      status ENUM('active', 'completed', 'cancelled') NOT NULL,
      created_at BIGINT NOT NULL,
      INDEX idx_auction_items_status (status),
      INDEX idx_auction_items_created (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS item_queue (
      item_id VARCHAR(64) NOT NULL,
      member_id BIGINT UNSIGNED NOT NULL,
      position INT NOT NULL,
      PRIMARY KEY (item_id, position),
      CONSTRAINT fk_item_queue_item FOREIGN KEY (item_id) REFERENCES auction_items(id) ON DELETE CASCADE,
      CONSTRAINT fk_item_queue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      INDEX idx_item_queue_item (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

/**
 * Migrate `members.id` from VARCHAR UUID to BIGINT AUTO_INCREMENT and `item_queue.member_id` to BIGINT.
 */
export async function migrateMembersIntPk(pool) {
  const [rows] = await pool.query(
    `SELECT DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'id'`
  );
  const ty = String(rows[0]?.DATA_TYPE ?? '').toLowerCase();
  if (ty === 'bigint' || ty === 'int' || ty === 'integer') return;

  const [fkRows] = await pool.query(
    `SELECT CONSTRAINT_NAME AS n FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'item_queue'
     AND COLUMN_NAME = 'member_id' AND REFERENCED_TABLE_NAME = 'members'
     LIMIT 1`
  );
  const fkName = fkRows[0]?.n;
  if (!fkName) {
    throw new Error('[migrateMembersIntPk] missing FK item_queue.member_id -> members');
  }

  const [oldQueue] = await pool.query(
    `SELECT item_id AS itemId, member_id AS memberId, position FROM item_queue ORDER BY item_id, position`
  );
  const [oldMembers] = await pool.query(
    `SELECT id, name, role, active FROM members ORDER BY id`
  );

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `ALTER TABLE item_queue DROP FOREIGN KEY \`${String(fkName).replace(/`/g, '')}\``
    );
    await conn.query('TRUNCATE TABLE item_queue');
    await conn.query('DROP TABLE members');
    await conn.query(`
      CREATE TABLE members (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        role ENUM('Officer', 'Member', 'Developer', 'Admin') NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        INDEX idx_members_name (name),
        INDEX idx_members_active (active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const map = new Map();
    for (const m of oldMembers) {
      const role = m.role === 'Leader' ? 'Officer' : m.role;
      const [ins] = await conn.query(
        `INSERT INTO members (name, role, active) VALUES (?, ?, ?)`,
        [m.name, role, m.active]
      );
      map.set(String(m.id), Number(ins.insertId));
    }

    await conn.query(
      `ALTER TABLE item_queue MODIFY COLUMN member_id BIGINT UNSIGNED NOT NULL`
    );

    for (const q of oldQueue) {
      const newMid = map.get(String(q.memberId));
      if (newMid == null) continue;
      await conn.query(
        `INSERT INTO item_queue (item_id, member_id, position) VALUES (?, ?, ?)`,
        [q.itemId, newMid, q.position]
      );
    }

    await conn.query(
      `ALTER TABLE item_queue ADD CONSTRAINT fk_item_queue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE`
    );

    await conn.commit();
    console.log(
      `[db] migrated members.id to AUTO_INCREMENT (${map.size} members, ${oldQueue.length} queue rows)`
    );
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Add \`members.active\` on existing DBs created before soft-delete support. */
export async function migrateAuctionWinnerNamesJson(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auction_items' AND COLUMN_NAME = 'winner_names_json'`
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await pool.query(
    `ALTER TABLE auction_items ADD COLUMN winner_names_json TEXT NULL`
  );
}

/** Admin/Developer unmarked shuffle-draw winners (persisted per item). */
export async function migrateAuctionRevokedWinnerNamesJson(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auction_items' AND COLUMN_NAME = 'revoked_winner_names_json'`
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await pool.query(
    `ALTER TABLE auction_items ADD COLUMN revoked_winner_names_json TEXT NULL AFTER winner_names_json`
  );
}

/** Add per-item winner pool cap for dynamic limits (no .env edits needed). */
export async function migrateAuctionWinnerPoolCapColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'auction_items' AND COLUMN_NAME = 'winner_pool_cap'`
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await pool.query(
    `ALTER TABLE auction_items ADD COLUMN winner_pool_cap INT NULL AFTER type`
  );
}

/** Readable wall time in phpMyAdmin; matches `at_ms` (FROM_UNIXTIME). */
export async function migrateWinnerMarkLogLoggedAtColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'winner_mark_log' AND COLUMN_NAME = 'logged_at'`
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await pool.query(
    `ALTER TABLE winner_mark_log ADD COLUMN logged_at DATETIME(3) NULL AFTER at_ms`
  );
  await pool.query(
    `UPDATE winner_mark_log SET logged_at = TIMESTAMPADD(
       MICROSECOND,
       (at_ms % 1000) * 1000,
       FROM_UNIXTIME(FLOOR(at_ms / 1000))
     ) WHERE logged_at IS NULL`
  );
  await pool.query(
    `ALTER TABLE winner_mark_log MODIFY logged_at DATETIME(3) NOT NULL`
  );
}

/** Unified bidder outcome log (shuffle pool + wins). See `bidderStateLog.js`. */
export async function migrateBidderStateLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bidder_state_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      at_ms BIGINT NOT NULL,
      logged_at DATETIME(3) NOT NULL,
      member_id BIGINT UNSIGNED NULL,
      ign VARCHAR(255) NOT NULL,
      item_id VARCHAR(64) NOT NULL,
      item_name VARCHAR(512) NOT NULL,
      item_type VARCHAR(64) NOT NULL,
      state TINYINT NOT NULL COMMENT '0=loss 1=win 2=ongoing',
      pool_cap INT NULL,
      queue_position INT NULL,
      shuffle_batch_at_ms BIGINT NULL,
      INDEX idx_bs_at (at_ms),
      INDEX idx_bs_item (item_id),
      INDEX idx_bs_member (member_id),
      INDEX idx_bs_state (state)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await backfillBidderStateLogFromWinnerMarks(pool);
}

export async function migrateWinnerMarkLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS winner_mark_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      at_ms BIGINT NOT NULL,
      logged_at DATETIME(3) NOT NULL,
      ign VARCHAR(255) NOT NULL,
      item_id VARCHAR(64) NOT NULL,
      item_name VARCHAR(512) NOT NULL,
      item_type VARCHAR(64) NOT NULL,
      INDEX idx_winner_mark_at (at_ms),
      INDEX idx_winner_mark_logged (logged_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await migrateWinnerMarkLogLoggedAtColumn(pool);
  await migrateLegacyWinnerMarkMetaToTable(pool);
}

/**
 * Migrate `members.role` ENUM to ('Officer', 'Member', 'Developer', 'Admin'):
 *   1. Widen the enum to accept the legacy `Leader` plus new `Developer` / `Admin`.
 *   2. Rename legacy `Leader` rows → `Officer`.
 *   3. Narrow the enum back, dropping `Leader`.
 * Idempotent: if the column already matches the target shape, do nothing.
 */
export async function migrateMembersOfficerRole(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'role'
     LIMIT 1`
  );
  const colType = String(rows[0]?.COLUMN_TYPE ?? '').toLowerCase();
  const hasLeader = colType.includes("'leader'");
  const hasDeveloper = colType.includes("'developer'");
  const hasAdmin = colType.includes("'admin'");
  if (!hasLeader && hasDeveloper && hasAdmin) return;

  await pool.query(
    `ALTER TABLE members MODIFY COLUMN role ENUM('Leader', 'Officer', 'Member', 'Developer', 'Admin') NOT NULL`
  );
  if (hasLeader) {
    await pool.query(
      `UPDATE members SET role = 'Officer' WHERE role = 'Leader'`
    );
  }
  await pool.query(
    `ALTER TABLE members MODIFY COLUMN role ENUM('Officer', 'Member', 'Developer', 'Admin') NOT NULL`
  );
}

/**
 * Add `members.password` column (defaults to the member id as string for
 * existing rows). Used by the Bidder Registration page.
 */
export async function migrateMembersPasswordColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'password'`
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await pool.query(
      `ALTER TABLE members ADD COLUMN password VARCHAR(255) NOT NULL DEFAULT '' AFTER role`
    );
  }
  await pool.query(
    `UPDATE members SET password = CAST(id AS CHAR) WHERE password IS NULL OR password = ''`
  );
}

export async function migrateMembersActiveColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'active'`
  );
  if (Array.isArray(rows) && rows.length > 0) return;
  await pool.query(
    `ALTER TABLE members ADD COLUMN active TINYINT(1) NOT NULL DEFAULT 1,
     ADD INDEX idx_members_active (active)`
  );
}

/**
 * Add `members.approval_status` for the public registration approval gate.
 *
 *   - 'approved' (default for all existing rows): full bidder access.
 *   - 'pending':  created by the public `/registration` page; cannot bid
 *                 or sign in until an Officer/Admin/Developer approves.
 *   - 'rejected': declined by an admin; effectively soft-deleted, but the
 *                 row is kept so the IGN remains reserved and the audit
 *                 trail survives.
 */
export async function migrateMembersApprovalStatusColumn(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND COLUMN_NAME = 'approval_status'`
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    await pool.query(
      `ALTER TABLE members
         ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected')
                                   NOT NULL DEFAULT 'approved' AFTER active,
         ADD INDEX idx_members_approval (approval_status)`
    );
    // Backfill: every pre-existing row was created by an admin (or migrated
    // from an older schema), so they're implicitly approved.
    await pool.query(
      `UPDATE members SET approval_status = 'approved' WHERE approval_status IS NULL OR approval_status = ''`
    );
  }
}

/** Keep Illusion Frag Card after Feathers in `ORDER BY created_at` lists. */
export async function migrateIllusionFragCardDisplayOrder(pool) {
  const [rows] = await pool.query(
    `SELECT id, created_at AS createdAt FROM auction_items WHERE id IN ('m2', 'm4')`
  );
  if (!Array.isArray(rows) || rows.length < 2) return;
  const m2 = rows.find((r) => r.id === 'm2');
  const m4 = rows.find((r) => r.id === 'm4');
  if (!m2 || !m4) return;
  const feathersAt = Number(m2.createdAt);
  const illusionAt = Number(m4.createdAt);
  if (!Number.isFinite(feathersAt) || !Number.isFinite(illusionAt)) return;
  if (illusionAt > feathersAt) return;
  await pool.query('UPDATE auction_items SET created_at = ? WHERE id = ?', [
    feathersAt + 1,
    'm4',
  ]);
  console.log('[db] moved Illusion Frag Card after Feathers (created_at)');
}

/** Insert any default auction rows missing from DB (additive upgrades). */
export async function migrateDefaultAuctionItems(pool) {
  const [rows] = await pool.query('SELECT id, name FROM auction_items');
  const existingIds = new Set(
    (Array.isArray(rows) ? rows : []).map((r) => String(r.id))
  );
  const existingNames = new Set(
    (Array.isArray(rows) ? rows : []).map((r) => String(r.name ?? '').trim())
  );
  const missing = DEFAULT_AUCTION_ITEMS.filter(
    (it) => !existingIds.has(it.id) && !existingNames.has(it.name)
  );
  if (missing.length === 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const now = Date.now();
    for (const it of missing) {
      await conn.query(
        `INSERT INTO auction_items (id, name, type, winner_pool_cap, winner_name, winner_names_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        [it.id, it.name, it.type, it.winnerPoolCap ?? null, it.winnerName, it.status, now]
      );
    }
    await conn.query(
      'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['data_version', String(DATA_VERSION)]
    );
    await conn.commit();
    console.log(
      `[db] added default auction items: ${missing.map((it) => it.name).join(', ')}`
    );
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Seed default auction rows when DB has no items yet. */
export async function seedIfEmpty(pool) {
  const [[row]] = await pool.query(
    'SELECT COUNT(*) AS c FROM auction_items'
  );
  if (Number(row.c) > 0) return;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const now = Date.now();
    for (const it of DEFAULT_AUCTION_ITEMS) {
      await conn.query(
        `INSERT INTO auction_items (id, name, type, winner_pool_cap, winner_name, winner_names_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`,
        [it.id, it.name, it.type, it.winnerPoolCap ?? null, it.winnerName, it.status, now]
      );
    }
    await conn.query(
      'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['data_version', String(DATA_VERSION)]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

/** Admin audit trail (bidders + auction dashboard). */
export async function migrateBidderAuditLogTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bidder_audit_log (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      at_ms BIGINT NOT NULL,
      logged_at DATETIME(3) NOT NULL,
      action ENUM(
        'approve', 'reject', 'create', 'edit', 'delete',
        'shuffle_start', 'shuffle_reset', 'event_mode_change',
        'winner_limits_set', 'clear_all_queues', 'queue_remove', 'winner_mark_adjust'
      ) NOT NULL,
      target_member_id BIGINT UNSIGNED NULL,
      target_name VARCHAR(255) NOT NULL,
      target_role VARCHAR(64) NULL,
      actor_id BIGINT UNSIGNED NOT NULL,
      actor_name VARCHAR(255) NOT NULL,
      actor_role VARCHAR(64) NOT NULL,
      details_json TEXT NULL,
      INDEX idx_bidder_audit_at (at_ms),
      INDEX idx_bidder_audit_action (action),
      INDEX idx_bidder_audit_target (target_name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await migrateBidderAuditLogAuctionActions(pool);
  await migrateBidderAuditLogQueueRemoveAction(pool);
  await migrateBidderAuditLogWinnerMarkAdjustAction(pool);
}

/** Extend audit ENUM on DBs created before auction actions were added. */
export async function migrateBidderAuditLogAuctionActions(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'bidder_audit_log'
       AND COLUMN_NAME = 'action'
     LIMIT 1`
  );
  const colType = String(rows[0]?.COLUMN_TYPE ?? '').toLowerCase();
  if (colType.includes('shuffle_start')) return;
  await pool.query(`
    ALTER TABLE bidder_audit_log MODIFY COLUMN action ENUM(
      'approve', 'reject', 'create', 'edit', 'delete',
      'shuffle_start', 'shuffle_reset', 'event_mode_change',
      'winner_limits_set', 'clear_all_queues', 'queue_remove'
    ) NOT NULL
  `);
}

/** Add queue_remove to audit action ENUM. */
export async function migrateBidderAuditLogQueueRemoveAction(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'bidder_audit_log'
       AND COLUMN_NAME = 'action'
     LIMIT 1`
  );
  const colType = String(rows[0]?.COLUMN_TYPE ?? '').toLowerCase();
  if (colType.includes('queue_remove')) return;
  await pool.query(`
    ALTER TABLE bidder_audit_log MODIFY COLUMN action ENUM(
      'approve', 'reject', 'create', 'edit', 'delete',
      'shuffle_start', 'shuffle_reset', 'event_mode_change',
      'winner_limits_set', 'clear_all_queues', 'queue_remove', 'winner_mark_adjust'
    ) NOT NULL
  `);
}

/** Add winner_mark_adjust to audit action ENUM. */
export async function migrateBidderAuditLogWinnerMarkAdjustAction(pool) {
  const [rows] = await pool.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'bidder_audit_log'
       AND COLUMN_NAME = 'action'
     LIMIT 1`
  );
  const colType = String(rows[0]?.COLUMN_TYPE ?? '').toLowerCase();
  if (colType.includes('winner_mark_adjust')) return;
  await pool.query(`
    ALTER TABLE bidder_audit_log MODIFY COLUMN action ENUM(
      'approve', 'reject', 'create', 'edit', 'delete',
      'shuffle_start', 'shuffle_reset', 'event_mode_change',
      'winner_limits_set', 'clear_all_queues', 'queue_remove', 'winner_mark_adjust'
    ) NOT NULL
  `);
}

/** Sunday Emperium Overrun reward history (admin-controlled payouts). */
export async function migrateOverrunRewardsRunsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS overrun_rewards_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      sunday_key VARCHAR(10) NOT NULL,
      created_at_ms BIGINT NOT NULL,
      created_at DATETIME(3) NOT NULL,
      status ENUM('ok', 'skipped', 'error') NOT NULL,
      message TEXT NULL,
      config_json TEXT NOT NULL,
      ranking_json TEXT NOT NULL,
      payouts_json TEXT NOT NULL,
      UNIQUE KEY uniq_overrun_sunday (sunday_key),
      INDEX idx_overrun_created (created_at_ms)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
