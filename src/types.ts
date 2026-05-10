export type ItemType = 'Fragment Card' | 'LND' | 'TNS' | 'Ancient Item' | 'Other';

export interface AuctionItem {
  id: string;
  name: string;
  type: ItemType;
  /** Winner limit for this specific item (overrides type default when set). */
  winnerPoolCap?: number | null;
  /** Legacy single winner; optional kung may `recordedWinnerNames` */
  winnerName: string | null;
  /**
   * Mga nanalo ngayong round (green check) habang `active` pa ang card.
   * Hanggang `maxQueueSlotsAfterShuffle(type, winnerPoolCap)`.
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

export type WeeklyEventType = 'Guild League' | 'Emperium Overrun';
export type GuildRank = 'Bronze' | 'Emperium overrun';

export interface RewardItemCounts {
  fragment: number;
  lnd: number;
  tns: number;
}

export interface AuctionState {
  items: AuctionItem[];
  members: GuildMember[];
  /** Persisted; increment in `auctionDefaults` to migrate old localStorage */
  dataVersion?: number;
  /**
   * When false, winner shortlist UI is off: no green check, no blue “shortlist” row styling.
   * “Reset shuffle / Unmark all” sets false; “Shuffle all queues” sets true.
   * Server: walang `app_meta` row o hindi `'1'` → off. Client: shortlist UI on lang kapag `true` (hindi “truthy”).
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
  /** Admin-selected active event mode. */
  eventMode?: WeeklyEventType;
  /** Rank basis for auction reward/page distribution. */
  rewardRank?: GuildRank;
  /** Actual configured item counts used for winner/page/free computations. */
  rewardItemCounts?: RewardItemCounts;
  /**
   * LND/TNS “shuffle draw free” pick per item (member id). Persisted so the public queue
   * view can highlight the same row as the admin dashboard.
   */
  freeDrawChosenByItemId?: Record<string, number>;
}
