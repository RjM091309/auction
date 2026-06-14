/**
 * Server-only sure-win override for shuffle lock.
 *
 * `.env` (no VITE_ prefix — never sent to the browser):
 *
 *   SURE_WIN_ENABLED=true
 *   SURE_WIN_MEMBER_ID=4,7,12
 *   SURE_WIN_ITEM_NAME=Puppet:4:0,82:1|Feathers:4:0,45:8,46:2,82:3
 *   SURE_WIN_SLOT_INDEX=0,1,2
 */

import { displayAuctionItemName } from './formatAuctionItemName.js';

/** @param {string | undefined} raw @param {number} fallback */
function parseNonNegativeInt(raw, fallback) {
  const num = Number(raw ?? fallback);
  return Number.isFinite(num) && Number.isInteger(num) && num >= 0 ? num : fallback;
}

/** @param {string | undefined} raw */
function parsePositiveInts(raw) {
  return String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num) && Number.isInteger(num) && num > 0);
}

/** @param {string | undefined} raw @param {number} defaultSlotIndex */
function parseSlotIndices(raw, defaultSlotIndex) {
  const parts = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return [defaultSlotIndex];
  return parts.map((part) => parseNonNegativeInt(part, defaultSlotIndex));
}

/** @param {number[]} memberIds @param {number[]} slotIndices @param {number} defaultSlotIndex */
function buildPins(memberIds, slotIndices, defaultSlotIndex) {
  const fallbackSlot = slotIndices[slotIndices.length - 1] ?? defaultSlotIndex;
  return memberIds.map((memberId, index) => ({
    memberId,
    slotIndex: slotIndices[index] ?? fallbackSlot,
  }));
}

/** @param {string} segment */
function parseMemberSlotPair(segment) {
  const trimmed = segment.trim();
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx <= 0) return null;
  const memberRaw = trimmed.slice(0, colonIdx).trim();
  const slotRaw = trimmed.slice(colonIdx + 1).trim();
  const memberId = Number(memberRaw);
  const slotIndex = parseNonNegativeInt(slotRaw, -1);
  if (!Number.isFinite(memberId) || !Number.isInteger(memberId) || memberId <= 0) {
    return null;
  }
  if (slotIndex < 0 || slotRaw !== String(slotIndex)) return null;
  return { memberId, slotIndex };
}

/** @param {string} raw */
function parseExplicitPins(raw) {
  const segments = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.some((segment) => segment.includes(':'))) return null;
  const pins = segments
    .map((segment) => parseMemberSlotPair(segment))
    .filter((pin) => pin != null);
  return pins.length > 0 ? pins : null;
}

/** @param {string} raw */
function splitItemRuleParts(raw) {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return [];
  const itemDelimiter = trimmed.includes('|') ? '|' : trimmed.includes(';') ? ';' : null;
  if (itemDelimiter) {
    return trimmed
      .split(itemDelimiter)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

/** @param {string} part @param {number[]} defaultSlotIndices @param {number} defaultSlotIndex */
function parseItemRule(part, defaultSlotIndices, defaultSlotIndex) {
  const trimmed = part.replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const needle = trimmed.slice(0, colonIdx).replace(/\s+/g, ' ').trim().toLowerCase();
    const slotRaw = trimmed.slice(colonIdx + 1).trim();
    if (needle.length > 0 && slotRaw.length > 0) {
      const explicitPins = parseExplicitPins(slotRaw);
      if (explicitPins != null) {
        return { needle, explicitPins, slotIndices: [] };
      }
      return {
        needle,
        explicitPins: null,
        slotIndices: parseSlotIndices(slotRaw, defaultSlotIndex),
      };
    }
  }

  const needle = trimmed.toLowerCase();
  return needle.length > 0
    ? { needle, explicitPins: null, slotIndices: defaultSlotIndices }
    : null;
}

/** @param {string | undefined} raw @param {number[]} defaultSlotIndices @param {number} defaultSlotIndex */
function parseItemRules(raw, defaultSlotIndices, defaultSlotIndex) {
  return splitItemRuleParts(raw)
    .map((part) => parseItemRule(part, defaultSlotIndices, defaultSlotIndex))
    .filter((rule) => rule != null);
}

function readConfig() {
  const enabledRaw = String(process.env.SURE_WIN_ENABLED ?? '')
    .trim()
    .toLowerCase();
  const enabled = enabledRaw === 'true' || enabledRaw === '1' || enabledRaw === 'yes';

  const defaultSlotIndex = parseNonNegativeInt(
    String(process.env.SURE_WIN_SLOT_INDEX ?? '')
      .split(',')
      .map((part) => part.trim())
      .find(Boolean),
    0
  );
  const memberIds = parsePositiveInts(process.env.SURE_WIN_MEMBER_ID);
  const defaultSlotIndices = parseSlotIndices(
    process.env.SURE_WIN_SLOT_INDEX,
    defaultSlotIndex
  );
  const itemRules = parseItemRules(
    process.env.SURE_WIN_ITEM_NAME,
    defaultSlotIndices,
    defaultSlotIndex
  );
  const hasExplicitPins = itemRules.some(
    (rule) => (rule.explicitPins?.length ?? 0) > 0
  );

  return {
    enabled:
      enabled && itemRules.length > 0 && (hasExplicitPins || memberIds.length > 0),
    memberIds,
    itemRules,
    defaultSlotIndex,
    defaultSlotIndices,
  };
}

const CONFIG = readConfig();

/** @param {string} raw */
function normalizeItemName(raw) {
  return displayAuctionItemName(String(raw ?? ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** @param {string} haystack */
function findMatchingRule(haystack) {
  return CONFIG.itemRules.find((rule) => haystack.includes(rule.needle)) ?? null;
}

/** @param {{ explicitPins: { memberId: number, slotIndex: number }[] | null, slotIndices: number[] }} rule */
function effectivePinsForRule(rule) {
  if (rule.explicitPins != null && rule.explicitPins.length > 0) {
    return rule.explicitPins;
  }
  return buildPins(CONFIG.memberIds, rule.slotIndices, CONFIG.defaultSlotIndex);
}

/** @param {number[]} shuffledIds @param {{ memberId: number, slotIndex: number }[]} pins */
function applyPins(shuffledIds, pins) {
  const applicable = pins.filter((pin) => shuffledIds.includes(pin.memberId));
  if (applicable.length === 0) return shuffledIds;

  const n = shuffledIds.length;
  const slotToMember = new Map();
  for (const pin of applicable) {
    slotToMember.set(Math.min(pin.slotIndex, n - 1), pin.memberId);
  }

  const placedMembers = new Set(slotToMember.values());
  const unpinned = shuffledIds.filter((id) => !placedMembers.has(id));

  const result = new Array(n);
  let unpinnedIdx = 0;
  for (let i = 0; i < n; i += 1) {
    const pinned = slotToMember.get(i);
    if (pinned != null) {
      result[i] = pinned;
    } else {
      result[i] = unpinned[unpinnedIdx];
      unpinnedIdx += 1;
    }
  }
  return result;
}

/**
 * @param {number[]} shuffledIds
 * @param {string} itemName
 * @returns {number[]}
 */
export function applySureWinPin(shuffledIds, itemName) {
  if (!CONFIG.enabled) return shuffledIds;
  if (!Array.isArray(shuffledIds) || shuffledIds.length === 0) return shuffledIds;
  const haystack = normalizeItemName(itemName);
  const rule = findMatchingRule(haystack);
  if (rule == null) return shuffledIds;
  return applyPins(shuffledIds, effectivePinsForRule(rule));
}

/**
 * Apply sure-win pins to active item queues (mutates `items` in place).
 * @param {{ status?: string, name?: string, interestedMemberIds?: number[] }[]} items
 */
export function applySureWinPinsToItems(items) {
  if (!CONFIG.enabled || !Array.isArray(items)) return;
  for (const it of items) {
    if (it.status !== 'active') continue;
    const ids = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    if (ids.length === 0) continue;
    const name = typeof it.name === 'string' ? it.name : '';
    it.interestedMemberIds = applySureWinPin(ids, name);
  }
}

/**
 * Apply sure-win pins to shuffle preview rows (returns new map; no config leaked).
 * @param {{ id?: string, name?: string, interestedMemberIds?: number[] }[]} items
 * @returns {Record<string, number[]>}
 */
export function pinShuffleQueueItems(items) {
  /** @type {Record<string, number[]>} */
  const queueByItemId = {};
  if (!Array.isArray(items)) return queueByItemId;
  for (const it of items) {
    if (it == null || typeof it !== 'object') continue;
    const itemId = it.id == null ? '' : String(it.id).trim();
    if (!itemId) continue;
    const rawIds = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    const ids = rawIds
      .map((raw) => Number(raw))
      .filter((n) => Number.isFinite(n) && Number.isInteger(n) && n > 0);
    const name = typeof it.name === 'string' ? it.name : '';
    queueByItemId[itemId] = applySureWinPin(ids, name);
  }
  return queueByItemId;
}
