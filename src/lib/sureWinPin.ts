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
 *   VITE_SURE_WIN_ITEM_NAME=Puppet,Feathers       # comma-separated, same slot for all
 *   VITE_SURE_WIN_ITEM_NAME=Puppet:0,Feathers:8   # per-item slot (0=1st, 8=9th, ...)
 *   VITE_SURE_WIN_SLOT_INDEX=0        # default slot when an item has no `:N` suffix
 *
 * Para alisin: i-set `VITE_SURE_WIN_ENABLED=false` (o tanggalin lahat ng
 * linya) at i-restart ang `npm run dev:all` kung hindi auto-reload si Vite.
 *
 * NOTE: Item name match uses `displayAuctionItemName` (strips trailing
 * "(LND)" / "(TNS)" / etc.) then case-insensitive substring. So an env value
 * of `puppet` matches "Puppet Frag Card", "Card Puppet", "Puppet (LND)", etc.
 */

import { displayAuctionItemName } from './formatAuctionItemName';

interface SureWinItemRule {
  needle: string;
  slotIndex: number;
}

interface SureWinConfig {
  enabled: boolean;
  memberId: number | null;
  itemRules: SureWinItemRule[];
  defaultSlotIndex: number;
}

function parseNonNegativeInt(raw: string | undefined, fallback: number): number {
  const num = Number(raw ?? fallback);
  return Number.isFinite(num) && Number.isInteger(num) && num >= 0 ? num : fallback;
}

function parseItemRule(part: string, defaultSlotIndex: number): SureWinItemRule | null {
  const trimmed = part.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.lastIndexOf(':');
  if (colonIdx > 0) {
    const slotRaw = trimmed.slice(colonIdx + 1).trim();
    const slotIndex = parseNonNegativeInt(slotRaw, -1);
    if (slotIndex >= 0 && slotRaw === String(slotIndex)) {
      const needle = trimmed.slice(0, colonIdx).replace(/\s+/g, ' ').trim().toLowerCase();
      if (needle.length > 0) return { needle, slotIndex };
    }
  }

  const needle = trimmed.toLowerCase();
  return needle.length > 0 ? { needle, slotIndex: defaultSlotIndex } : null;
}

function parseItemRules(raw: string | undefined, defaultSlotIndex: number): SureWinItemRule[] {
  return String(raw ?? '')
    .split(',')
    .map((part) => parseItemRule(part, defaultSlotIndex))
    .filter((rule): rule is SureWinItemRule => rule != null);
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

  const defaultSlotIndex = parseNonNegativeInt(import.meta.env.VITE_SURE_WIN_SLOT_INDEX, 0);
  const itemRules = parseItemRules(import.meta.env.VITE_SURE_WIN_ITEM_NAME, defaultSlotIndex);

  return {
    enabled: enabled && memberId != null && itemRules.length > 0,
    memberId,
    itemRules,
    defaultSlotIndex,
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

function findMatchingRule(haystack: string): SureWinItemRule | null {
  return CONFIG.itemRules.find((rule) => haystack.includes(rule.needle)) ?? null;
}

/**
 * If the sure-win flag is on AND `itemName` matches a configured rule AND
 * the configured member id is in the shuffled queue, move that id to the
 * rule's slot index (clamped to the last valid index when the queue is shorter
 * than the configured slot). Otherwise return the input unchanged.
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
  const rule = findMatchingRule(haystack);
  if (rule == null) return shuffledIds;
  const idx = shuffledIds.indexOf(CONFIG.memberId);
  if (idx < 0) return shuffledIds;
  const targetIdx = Math.min(rule.slotIndex, shuffledIds.length - 1);
  if (idx === targetIdx) return shuffledIds;
  const next = shuffledIds.slice();
  next.splice(idx, 1);
  next.splice(targetIdx, 0, CONFIG.memberId);
  return next;
}
