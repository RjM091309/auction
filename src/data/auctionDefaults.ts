import { AuctionItem, GuildMember } from '../types';

/** Bump when default rows or queue migration should run (see `lib/storage.ts`). */
export const AUCTION_DATA_VERSION = 3;

/** Start with no roster; names are added in-app or via `scripts/add-names-to-cards.js`. */
export const INITIAL_MEMBERS: GuildMember[] = [];

/** Default dashboard: three items, empty queues. */
export const DEFAULT_AUCTION_ITEMS: AuctionItem[] = [
  {
    id: 'm1',
    name: 'Puppet Frag Card',
    type: 'Fragment Card',
    winnerPoolCap: 2,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
    createdAt: Date.now(),
  },
  {
    id: 'm2',
    name: 'Light And Dark Feathers',
    type: 'LND',
    winnerPoolCap: 7,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
    createdAt: Date.now(),
  },
  {
    id: 'm3',
    name: 'Time And Space Feathers',
    type: 'TNS',
    winnerPoolCap: 12,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
    createdAt: Date.now(),
  },
];
