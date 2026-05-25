/**
 * Add character names to each auction card by editing localStorage.
 *
 * HOW TO USE
 * 1. Open the app in the browser (same origin you use for bidding, e.g. http://localhost:5173).
 * 2. Open DevTools → Console.
 * 3. Paste this entire file and press Enter.
 *
 * Edit QUEUES below: each entry uses `contains` (matched against the card's item title)
 * and `names` (IGNs appended to that card's queue in order). Re-run after changes.
 */

(function addNamesToRoocCards() {
  const STORAGE_KEY = 'roo_auction_state';

  /** @type {{ contains: string, names: string[] }[]} */
  const QUEUES = [
    { contains: 'Puppet Frag', names: ['Player_One', 'Player_Two'] },
    { contains: 'Illusion Frag', names: [] },
    { contains: 'Light And Dark', names: ['Player_Three'] },
    { contains: 'Time And Space', names: ['Player_Four', 'Player_Five'] },
  ];

  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    console.error('[rooc] No saved state. Load the app once so it creates storage, then run again.');
    return;
  }

  let state;
  try {
    state = JSON.parse(raw);
  } catch (e) {
    console.error('[rooc] Invalid JSON in localStorage', e);
    return;
  }

  if (!Array.isArray(state.items) || !Array.isArray(state.members)) {
    console.error('[rooc] Unexpected state shape. Expected { items, members }.');
    return;
  }

  const members = [...state.members];
  const nameToId = new Map(
    members.map((m) => [m.name.toLowerCase(), m.id])
  );

  let tempId = 0;
  function resolveMemberId(ign) {
    const key = ign.trim();
    if (!key) return null;
    const low = key.toLowerCase();
    if (nameToId.has(low)) return nameToId.get(low);
    tempId -= 1;
    const id = tempId;
    members.push({ id, name: key, role: 'Member' });
    nameToId.set(low, id);
    return id;
  }

  const items = state.items.map((item) => {
    const entry = QUEUES.find((q) =>
      item.name && item.name.includes(q.contains)
    );
    if (!entry || !entry.names || entry.names.length === 0) {
      return item;
    }

    const ids = [...item.interestedMemberIds];
    for (const ign of entry.names) {
      const mid = resolveMemberId(ign);
      if (mid && !ids.includes(mid)) ids.push(mid);
    }
    return { ...item, interestedMemberIds: ids };
  });

  const next = {
    ...state,
    items,
    members,
    dataVersion: state.dataVersion ?? 3,
  };

  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  console.log('[rooc] Updated queues. Reload the page to see changes.');
  if (typeof location !== 'undefined' && location.reload) {
    location.reload();
  }
})();
