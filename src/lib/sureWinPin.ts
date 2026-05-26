/**
 * Sure-win override for the shuffle draw.
 *
 * When enabled via `.env`, a specific member id is pinned to a specific slot
 * of the shuffled queue for a specific item — guaranteeing they land inside
 * the winner shortlist. Every other slot remains a fair random shuffle, so
 * the "other winner" is still random when the item has `winnerPoolCap > 1`.
 *
 * Controls (`.env`):
 *
 *   VITE_SURE_WIN_ENABLED=true        # master toggle ("true" = on, anything else = off)
 *   VITE_SURE_WIN_MEMBER_ID=4         # member.id that should always win
 *   VITE_SURE_WIN_ITEM_NAME=Puppet    # substring match (case-insensitive) against item name
 *   VITE_SURE_WIN_SLOT_INDEX=1        # 0=1st, 1=2nd, 2=3rd, ... (clamps to queue length)
 *
 * Para alisin: i-set `VITE_SURE_WIN_ENABLED=false` (o tanggalin lahat ng
 * linya) at i-restart ang `npm run dev:all` kung hindi auto-reload si Vite.
 *
 * NOTE: Item name match uses `displayAuctionItemName` (strips trailing
 * "(LND)" / "(TNS)" / etc.) then case-insensitive substring. So an env value
 * of `puppet` matches "Puppet Frag Card", "Card Puppet", "Puppet (LND)", etc.
 */

import { displayAuctionItemName } from './formatAuctionItemName';

interface SureWinConfig {
  enabled: boolean;
  memberId: number | null;
  itemNeedle: string;
  slotIndex: number;
}

function readConfig(): SureWinConfig {
  const enabledRaw = String(import.meta.env.VITE_SURE_WIN_ENABLED ?? '')
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes';

  const idRaw = import.meta.env.VITE_SURE_WIN_MEMBER_ID;
  const idNum = Number(idRaw);
  const memberId =
    Number.isFinite(idNum) && Number.isInteger(idNum) && idNum > 0 ? idNum : null;

  const itemNeedle = String(import.meta.env.VITE_SURE_WIN_ITEM_NAME ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  // Default = 0 (1st place). User can pin to any slot — even outside the
  // winner pool — but we clamp into [0, queueLength-1] at apply time.
  const slotRaw = Number(import.meta.env.VITE_SURE_WIN_SLOT_INDEX ?? 0);
  const slotIndex =
    Number.isFinite(slotRaw) && Number.isInteger(slotRaw) && slotRaw >= 0
      ? slotRaw
      : 0;

  return {
    enabled: enabled && memberId != null && itemNeedle.length > 0,
    memberId,
    itemNeedle,
    slotIndex,
  };
}

const CONFIG = readConfig();

export function sureWinConfig(): Readonly<SureWinConfig> {
  return CONFIG;
}

function normalizeItemName(raw: string): string {
  return displayAuctionItemName(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * If the sure-win flag is on AND `itemName` matches the configured needle AND
 * the configured member id is in the shuffled queue, move that id to
 * `VITE_SURE_WIN_SLOT_INDEX` (clamped to the last valid index when the queue
 * is shorter than the configured slot). Otherwise return the input unchanged.
 *
 * Other rows keep their original random order — we just splice the target
 * out and reinsert at the configured slot, so the "neighbour" placed at
 * index 0 stays random when slotIndex > 0.
 *
 * Idempotent — calling twice has the same effect as calling once.
 */
export function applySureWinPin(shuffledIds: number[], itemName: string): number[] {
  if (!CONFIG.enabled || CONFIG.memberId == null) return shuffledIds;
  if (shuffledIds.length === 0) return shuffledIds;
  const haystack = normalizeItemName(itemName);
  if (!haystack.includes(CONFIG.itemNeedle)) return shuffledIds;
  const idx = shuffledIds.indexOf(CONFIG.memberId);
  if (idx < 0) return shuffledIds;
  const targetIdx = Math.min(CONFIG.slotIndex, shuffledIds.length - 1);
  if (idx === targetIdx) return shuffledIds;
  const next = shuffledIds.slice();
  next.splice(idx, 1);
  next.splice(targetIdx, 0, CONFIG.memberId);
  return next;
}
