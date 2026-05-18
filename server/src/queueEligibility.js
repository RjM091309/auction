/**
 * Keep in sync with `src/lib/queueEligibility.ts` (Emperium vs Guild queue rules).
 */

import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';

/** @param {string | undefined} m */
export function defaultEventModeForQueues(m) {
  return m === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

/** Guild League: shuffle lock closes public signup. Emperium Overrun: stays open. */
export function shuffleLockClosesPublicSignup(shuffleLocked, eventMode) {
  if (!shuffleLocked) return false;
  return defaultEventModeForQueues(eventMode) !== 'Emperium Overrun';
}

/** Weekly win / log lock — temporarily disabled so everyone can bid. */
export function weeklyTypeWinBlocksQueueJoin(_eventMode, _itemType, _wins, _ignRaw) {
  return false;
}

/** @param {string} t */
export function isEmperiumCenterType(t) {
  return t === 'Fragment Card' || t === 'LND' || t === 'TNS';
}

/** @param {string} t */
export function isFeatherType(t) {
  return t === 'LND' || t === 'TNS';
}

/** @param {string} targetType @param {string} otherType */
export function emperiumSecondQueueBlocks(targetType, otherType) {
  if (!isEmperiumCenterType(targetType) || !isEmperiumCenterType(otherType)) {
    return true;
  }
  if (targetType === 'Fragment Card' && otherType === 'Fragment Card') return true;
  if (isFeatherType(targetType) && isFeatherType(otherType)) {
    return targetType === otherType;
  }
  return false;
}

/**
 * @param {unknown} eventMode
 * @param {{ id: string, status: string, type: string, interestedMemberIds: number[] }[]} items
 * @param {{ id: number, name: string }[]} members
 * @param {{ skipHiddenBlockingItems?: boolean } | undefined} [opts]
 */
export function findOtherActiveQueueBlocking(
  eventMode,
  items,
  members,
  ignLower,
  targetItemId,
  targetType,
  opts
) {
  const norm = String(ignLower ?? '')
    .trim()
    .toLowerCase();
  const queueHasIgn = (it) =>
    it.interestedMemberIds.some((mid) => {
      const n = members.find((m) => m.id === mid)?.name;
      return n != null && String(n).trim().toLowerCase() === norm;
    });

  const mode = defaultEventModeForQueues(eventMode);

  const skipHidden =
    opts && opts.skipHiddenBlockingItems === true && mode !== 'Emperium Overrun';

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (skipHidden && isAuctionItemHiddenForPublic(it)) continue;
    if (!queueHasIgn(it)) continue;

    if (mode !== 'Emperium Overrun') {
      return it;
    }
    if (emperiumSecondQueueBlocks(targetType, it.type)) return it;
  }
  return null;
}

/** @param {{ ign: string, t: string }[]} wins @param {string} ignRaw @param {string} itemType */
function ignHasWeeklyTypeWin(wins, ignRaw, itemType) {
  if (!Array.isArray(wins) || wins.length === 0) return false;
  const ign = String(ignRaw ?? '')
    .trim()
    .toLowerCase();
  if (!ign) return false;
  return wins.some((w) => w.ign === ign && w.t === itemType);
}

/**
 * Emperium Overrun: weekly Fragment Card win → remove IGN from all Fragment Card queues
 * (feather queues only until Monday). Keep in sync with `src/lib/queueEligibility.ts`.
 * @param {object} s
 */
/** Temporarily disabled — do not strip Fragment queues from weekly win log. */
export function stripEmperiumCardQueuesAfterFragmentWeeklyWin(s) {
  return s;
}
