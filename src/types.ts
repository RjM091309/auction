export type ItemType = 'Fragment Card' | 'LND' | 'TNS' | 'Ancient Item' | 'Other';

export interface AuctionItem {
  id: string;
  name: string;
  type: ItemType;
  winnerName: string | null;
  status: 'active' | 'completed' | 'cancelled';
  interestedMemberIds: string[];
  createdAt: number;
}

export interface GuildMember {
  id: string;
  name: string;
  role: 'Leader' | 'Member';
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
}
