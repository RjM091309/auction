export type ItemType = 'Fragment Card' | 'LND' | 'TNS' | 'Ancient Item' | 'Other';

export interface AuctionItem {
  id: string;
  name: string;
  type: ItemType;
  /** Legacy single winner; optional kung may `recordedWinnerNames` */
  winnerName: string | null;
  /**
   * Mga nanalo ngayong round (green check) habang `active` pa ang card.
   * Hanggang `maxQueueSlotsAfterShuffle(type)` (VITE_AUCTION_WINNER_POOL_*).
   */
  recordedWinnerNames?: string[];
  status: 'active' | 'completed' | 'cancelled';
  interestedMemberIds: number[];
  createdAt: number;
}

export interface GuildMember {
  id: number;
  name: string;
  role: 'Leader' | 'Member';
}

/** Lingguhang type lock: normalized IGN + item type (mula sa server `GET /api/state`). */
export interface WeeklyTypeWin {
  ign: string;
  t: string;
}

/** One admin green-check (recorded winner) on an active card; shown on Logs. */
export interface WinnerMarkLogEntry {
  /** DB row id (optional in JSON); for stable list keys only. */
  id?: number;
  at: number;
  ign: string;
  itemId: string;
  itemName: string;
  itemType: string;
}

/**
 * Unified shuffle + winner outcome log (`bidder_state_log`).
 * state: 0 = loss (below winner pool after shuffle), 1 = win (green check), 2 = ongoing (in pool).
 */
export interface BidderStateLogEntry {
  id?: number;
  at: number;
  memberId?: number | null;
  ign: string;
  itemId: string;
  itemName: string;
  itemType: string;
  state: number;
  poolCap?: number | null;
  queuePosition?: number | null;
  shuffleBatchAtMs?: number | null;
}

export interface AuctionState {
  items: AuctionItem[];
  members: GuildMember[];
  /** Persisted; increment in `auctionDefaults` to migrate old localStorage */
  dataVersion?: number;
  /**
   * When false, winner shortlist UI is off: no green check, no blue “shortlist” row styling.
   * “Reset shuffle / Unmark all” sets false; “Shuffle all queues” sets true.
   */
  winnerShortlistUiEnabled?: boolean;
  /**
   * After one successful “Shuffle all queues”, true until “Reset shuffle / Unmark all”
   * (one shuffle per round — pay / reset to shuffle again).
   */
  shuffleLocked?: boolean;
  /** IGN + type na nanalo na (may green check / completed winner) ngayong linggo. */
  weeklyTypeWins?: WeeklyTypeWin[];
  /** Newest first; persisted on server when admin marks a winner (green check). */
  winnerMarkLog?: WinnerMarkLogEntry[];
  /** Newest first; shuffle lock + winner marks (see `BidderStateLogEntry.state`). */
  bidderStateLog?: BidderStateLogEntry[];
}
