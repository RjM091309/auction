import mysql from 'mysql2/promise';
import { DATA_VERSION, DEFAULT_AUCTION_ITEMS } from './defaults.js';

export function createPool() {
  return mysql.createPool({
    host: process.env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'rooc',
    waitForConnections: true,
    connectionLimit: 10,
    enableKeepAlive: true,
  });
}

/** Run once on startup (idempotent). */
export async function initSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_meta (
      \`key\` VARCHAR(64) NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS members (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      role ENUM('Leader', 'Member') NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS auction_items (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      name VARCHAR(512) NOT NULL,
      type VARCHAR(64) NOT NULL,
      winner_name VARCHAR(255) NULL,
      status ENUM('active', 'completed', 'cancelled') NOT NULL,
      created_at BIGINT NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS item_queue (
      item_id VARCHAR(64) NOT NULL,
      member_id VARCHAR(64) NOT NULL,
      position INT NOT NULL,
      PRIMARY KEY (item_id, position),
      CONSTRAINT fk_item_queue_item FOREIGN KEY (item_id) REFERENCES auction_items(id) ON DELETE CASCADE,
      CONSTRAINT fk_item_queue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
      INDEX idx_item_queue_item (item_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);
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
        `INSERT INTO auction_items (id, name, type, winner_name, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [it.id, it.name, it.type, it.winnerName, it.status, now]
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
