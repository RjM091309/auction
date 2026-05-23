/** Default caps when item has no explicit override. */
const DEFAULTS = {
  'Fragment Card': 2,
  Feathers: 19,
  'Ancient Item': 1,
  Other: 1,
};

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
