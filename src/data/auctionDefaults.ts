import { AuctionItem, GuildMember } from '../types';

/** Bump when default rows or queue migration should run (see `lib/storage.ts`). */
export const AUCTION_DATA_VERSION = 5;

/** Start with no roster; names are added in-app or via `scripts/add-names-to-cards.js`. */
export const INITIAL_MEMBERS: GuildMember[] = [];

/** Default dashboard: Fragment Cards + Feathers (combined LND/TNS). */
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
    name: 'Feathers',
    type: 'Feathers',
    winnerPoolCap: 19,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
    createdAt: Date.now(),
  },
  {
    id: 'm4',
    name: 'Illusion Frag Card',
    type: 'Fragment Card',
    winnerPoolCap: 2,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
    createdAt: Date.now(),
  },
];
