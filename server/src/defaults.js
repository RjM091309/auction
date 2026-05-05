/** Keep in sync with `src/data/auctionDefaults.ts` */
export const DATA_VERSION = 3;

export const DEFAULT_AUCTION_ITEMS = [
  {
    id: 'm1',
    name: 'Puppet Frag Card',
    type: 'Fragment Card',
    winnerPoolCap: 2,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
  },
  {
    id: 'm2',
    name: 'Light And Dark Feathers',
    type: 'LND',
    winnerPoolCap: 7,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
  },
  {
    id: 'm3',
    name: 'Time And Space Feathers',
    type: 'TNS',
    winnerPoolCap: 12,
    winnerName: null,
    status: 'active',
    interestedMemberIds: [],
  },
];
