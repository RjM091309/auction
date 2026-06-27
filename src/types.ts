export type ItemType =
  | 'Fragment Card'
  | 'Feathers'
  | 'Ancient Item'
  | 'Other';

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
  /** Shuffle-draw (or other) winners explicitly unmarked by Admin/Developer. */
  revokedWinnerNames?: string[];
  status: 'active' | 'completed' | 'cancelled';
  interestedMemberIds: number[];
  createdAt: number;
}

export interface GuildMember {
  id: number;
  name: string;
  role: 'Officer' | 'Member' | 'Developer' | 'Admin';
}

/** Emperium Overrun win cooldown: normalized IGN + item type (+ optional item id + win time). */
export interface WeeklyTypeWin {
  ign: string;
  t: string;
  /** Auction item id (e.g. m1 Puppet); used to scope Fragment Card cooldowns. */
  itemId?: string;
  /** Admin green-check timestamp (ms); Puppet-only 1-week Sunday-event cooldown. */
  at?: number;
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
 * Unified shuffle outcome log (`bidder_state_log`). Written on shuffle lock only (Win/Loss by pool order).
 * state: 0 = loss, 1 = win (in pool), 2 = legacy ongoing (old rows). Admin marks → `winner_mark_log`, not here.
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
export type GuildRank =
  | 'Bronze'
  | 'Silver'
  | 'Gold'
  | 'Platinum'
  | 'Emperium overrun';

export interface RewardItemCounts {
  /** Default item count for fragment cards without a per-id override. */
  fragment: number;
  feathers: number;
  /** Feathers items allocated per winning bidder (Emperium 13, Platinum 12, Gold 10, Silver 9, Bronze 8). */
  feathersItemsPerWinner?: number;
  /** Per fragment auction item (e.g. m1 Puppet, m4 Illusion). */
  fragmentByItemId?: Record<string, number>;
  /** Guild League: ×2 Puppet items + Feathers total when true (Illusion & per-winner unchanged). */
  rankWinnerDouble?: boolean;
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
  /** Newest first; shuffle lock writes Win/Loss (`bidder_state_log`). Hindi na dinudoble ang check dito. */
  bidderStateLog?: BidderStateLogEntry[];
  /** Admin-selected active event mode. */
  eventMode?: WeeklyEventType;
  /** Rank basis for auction reward/page distribution. */
  rewardRank?: GuildRank;
  /** Actual configured item counts used for winner/page/free computations. */
  rewardItemCounts?: RewardItemCounts;
  /**
   * Feathers “shuffle draw free” pick per item (member id). Persisted so the public queue
   * view can highlight the same row as the admin dashboard.
   */
  freeDrawChosenByItemId?: Record<string, number>;
  /**
   * Winner slots frozen at shuffle lock per item (shuffle draw count).
   * Used so raising winner set limit later does not re-label losers as shuffle winners.
   */
  shuffleWinnerSlotsByItemId?: Record<string, number>;
}
