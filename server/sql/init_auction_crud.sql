-- Auction CRUD schema (mirrors `src/types.ts` + `src/App.tsx` state).
-- Also applied on API boot via `server/src/db.js` → `initSchema()`.
-- Manual: mysql -u USER -p DATABASE < server/sql/init_auction_crud.sql

-- app_meta: data_version; winner_shortlist_ui; shuffle_locked; free_draw_chosen_by_item (JSON itemId→memberId);
-- auction_week_monday (YYYY-MM-DD); weekly_type_wins (JSON [{ign, t}])
-- winner_mark_log TABLE: one row per admin green-check (see server migrateWinnerMarkLogTable)
-- = completed auction + winner_name lang (green check); natalo pwede ulit mag-bid
CREATE TABLE IF NOT EXISTS app_meta (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- GuildMember: id AUTO_INCREMENT, name, role, active (0 = soft-deleted / hidden)
CREATE TABLE IF NOT EXISTS members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role ENUM('Officer', 'Member', 'Developer', 'Admin') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_members_name (name),
  INDEX idx_members_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AuctionItem (row); interestedMemberIds → item_queue ordered by position
CREATE TABLE IF NOT EXISTS auction_items (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  type VARCHAR(64) NOT NULL,
  winner_pool_cap INT NULL,
  winner_name VARCHAR(255) NULL,
  winner_names_json TEXT NULL,
  status ENUM('active', 'completed', 'cancelled') NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_auction_items_status (status),
  INDEX idx_auction_items_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Admin winner marks log (append on green check; cap + trim in app code)
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-item ordered queue (interestedMemberIds[index] == position)
CREATE TABLE IF NOT EXISTS item_queue (
  item_id VARCHAR(64) NOT NULL,
  member_id BIGINT UNSIGNED NOT NULL,
  position INT NOT NULL,
  PRIMARY KEY (item_id, position),
  CONSTRAINT fk_item_queue_item FOREIGN KEY (item_id) REFERENCES auction_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_queue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  INDEX idx_item_queue_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Unified outcome log: shuffle lock → 0/1 by pool order; optional +1 after marks; see `bidderStateLog.js`.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Bidder Registration admin audit (approve / reject / create / edit / delete).
CREATE TABLE IF NOT EXISTS bidder_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  at_ms BIGINT NOT NULL,
  logged_at DATETIME(3) NOT NULL,
  action ENUM(
    'approve', 'reject', 'create', 'edit', 'delete',
    'shuffle_start', 'shuffle_reset', 'event_mode_change',
    'winner_limits_set', 'clear_all_queues', 'queue_remove'
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Emperium Overrun Auction rewards payout runs (one row per Sunday payout).
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
