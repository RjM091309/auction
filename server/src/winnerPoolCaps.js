/** Default caps when item has no explicit override. */
const DEFAULTS = {
  'Fragment Card': 2,
  Feathers: 19,
  'Ancient Item': 1,
  Other: 1,
};

function defaultFeathersItemsPerWinner(rank) {
  if (rank === 'Emperium overrun') return 13;
  if (rank === 'Platinum') return 12;
  if (rank === 'Gold') return 10;
  if (rank === 'Silver') return 9;
  return 8;
}

function parseRewardRank(raw) {
  if (raw == null || raw === '') return 'Bronze';
  const s = typeof raw === 'string' ? raw : String(raw);
  if (s === 'Emperium overrun') return 'Emperium overrun';
  if (s === 'Platinum') return 'Platinum';
  if (s === 'Gold') return 'Gold';
  if (s === 'Silver') return 'Silver';
  if (s === 'Bronze') return 'Bronze';
  return 'Bronze';
}

function featherItemsPerWinnerUnit(rank, counts) {
  const override = counts?.feathersItemsPerWinner;
  if (override != null && Number.isFinite(Number(override)) && Number(override) > 0) {
    return Math.max(1, Math.floor(Number(override)));
  }
  return defaultFeathersItemsPerWinner(rank);
}

export function defaultWinnerPoolCapForType(type) {
  const fallback = DEFAULTS[type] ?? 1;
  return fallback;
}

export function maxRecordedWinnersForItem(type, winnerPoolCap) {
  if (winnerPoolCap != null && winnerPoolCap !== '') {
    const n = Number(winnerPoolCap);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return defaultWinnerPoolCapForType(type);
}

/** Same cap as dashboard Winner Set Limit + rank (Feathers / Fragment Card). */
export function maxWinnersForItemInState(it, body) {
  const type = typeof it?.type === 'string' ? it.type : '';
  const counts = body?.rewardItemCounts;
  const rank = parseRewardRank(body?.rewardRank);
  if (type === 'Feathers' && counts && counts.feathers != null) {
    const n = Math.max(0, Math.floor(Number(counts.feathers)));
    const u = featherItemsPerWinnerUnit(rank, counts);
    return Math.max(0, Math.floor(n / u));
  }
  if (type === 'Fragment Card' && counts) {
    const byId = counts.fragmentByItemId;
    let total = counts.fragment ?? 2;
    if (
      byId &&
      typeof byId === 'object' &&
      !Array.isArray(byId) &&
      it?.id &&
      byId[it.id] != null
    ) {
      total = byId[it.id];
    }
    return Math.max(0, Math.floor(Number(total)));
  }
  return maxRecordedWinnersForItem(type, it?.winnerPoolCap);
}
