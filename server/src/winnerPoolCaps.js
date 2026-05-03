/**
 * Same caps as web `shuffleCaps.ts` — basahin ang VITE_* mula sa `.env` (dotenv sa server).
 */
const DEFAULTS = {
  'Fragment Card': 2,
  LND: 6,
  TNS: 8,
  'Ancient Item': 1,
  Other: 1,
};

const ENV_KEYS = {
  'Fragment Card': 'VITE_AUCTION_WINNER_POOL_FRAGMENT',
  LND: 'VITE_AUCTION_WINNER_POOL_LND',
  TNS: 'VITE_AUCTION_WINNER_POOL_TNS',
};

export function maxRecordedWinnersForItemType(type) {
  const key = ENV_KEYS[type];
  const fallback = DEFAULTS[type] ?? 1;
  if (!key) return fallback;
  const n = parseInt(String(process.env[key] ?? ''), 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}
