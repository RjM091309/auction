-- Auction CRUD schema (mirrors `src/types.ts` + `src/App.tsx` state).
-- Also applied on API boot via `server/src/db.js` → `initSchema()`.
-- Manual: mysql -u USER -p DATABASE < server/sql/init_auction_crud.sql

-- app_meta: e.g. data_version; winner_shortlist_ui ('1'|'0') toggles winner checkmarks after reset
CREATE TABLE IF NOT EXISTS app_meta (
  `key` VARCHAR(64) NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- GuildMember: id, name, role, active (0 = soft-deleted / hidden)
CREATE TABLE IF NOT EXISTS members (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  role ENUM('Leader', 'Member') NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_members_name (name),
  INDEX idx_members_active (active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- AuctionItem (row); interestedMemberIds → item_queue ordered by position
CREATE TABLE IF NOT EXISTS auction_items (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  name VARCHAR(512) NOT NULL,
  type VARCHAR(64) NOT NULL,
  winner_name VARCHAR(255) NULL,
  status ENUM('active', 'completed', 'cancelled') NOT NULL,
  created_at BIGINT NOT NULL,
  INDEX idx_auction_items_status (status),
  INDEX idx_auction_items_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-item ordered queue (interestedMemberIds[index] == position)
CREATE TABLE IF NOT EXISTS item_queue (
  item_id VARCHAR(64) NOT NULL,
  member_id VARCHAR(64) NOT NULL,
  position INT NOT NULL,
  PRIMARY KEY (item_id, position),
  CONSTRAINT fk_item_queue_item FOREIGN KEY (item_id) REFERENCES auction_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_item_queue_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
  INDEX idx_item_queue_item (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
