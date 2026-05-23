/**
 * Keep in sync with `src/lib/queueEligibility.ts` (Emperium vs Guild queue rules).
 */

import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';
import { findMatchingIgnName, canonicalIgnKey } from './ignQueueIdentity.js';

/** @param {string | undefined} m */
export function defaultEventModeForQueues(m) {
  return m === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

/** Guild League: shuffle lock closes public signup. Emperium Overrun: stays open. */
export function shuffleLockClosesPublicSignup(shuffleLocked, eventMode) {
  if (!shuffleLocked) return false;
  return defaultEventModeForQueues(eventMode) !== 'Emperium Overrun';
}

/** Weekly win / log lock disabled — winners can bid again next auction. */
export function weeklyTypeWinBlocksQueueJoin(_eventMode, _itemType, _wins, _ignRaw) {
  return false;
}

/** @param {string} t */
export function isEmperiumCenterType(t) {
  return t === 'Fragment Card' || t === 'Feathers' || t === 'LND' || t === 'TNS';
}

/** @param {string} t */
export function isFeatherType(t) {
  return t === 'Feathers' || t === 'LND' || t === 'TNS';
}

/** @param {string} targetType @param {string} otherType */
export function emperiumSecondQueueBlocks(targetType, otherType) {
  if (!isEmperiumCenterType(targetType) || !isEmperiumCenterType(otherType)) {
    return true;
  }
  if (targetType === 'Fragment Card' && otherType === 'Fragment Card') return true;
  if (isFeatherType(targetType) && isFeatherType(otherType)) {
    return true;
  }
  return false;
}

/**
 * @param {unknown} eventMode
 * @param {{ id: string, status: string, type: string, interestedMemberIds: number[] }[]} items
 * @param {{ id: number, name: string }[]} members
 * @param {string} ignRaw
 * @param {string} targetItemId
 * @param {string} targetType
 * @param {{ skipHiddenBlockingItems?: boolean } | undefined} [opts]
 */
export function findOtherActiveQueueBlocking(
  eventMode,
  items,
  members,
  ignRaw,
  targetItemId,
  targetType,
  opts
) {
  const hit = findOtherActiveQueueBlockingWithMatch(
    eventMode,
    items,
    members,
    ignRaw,
    targetItemId,
    targetType,
    opts
  );
  return hit ? hit.item : null;
}

/**
 * @returns {{ item: object, matchedIgn: string } | null}
 */
export function findOtherActiveQueueBlockingWithMatch(
  eventMode,
  items,
  members,
  ignRaw,
  targetItemId,
  targetType,
  opts
) {
  const mode = defaultEventModeForQueues(eventMode);

  const skipHidden =
    opts && opts.skipHiddenBlockingItems === true && mode !== 'Emperium Overrun';

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (skipHidden && isAuctionItemHiddenForPublic(it)) continue;

    const queuedNames = [];
    for (const mid of it.interestedMemberIds) {
      const n = members.find((m) => m.id === mid)?.name;
      if (n != null && String(n).trim()) queuedNames.push(n);
    }
    if (queuedNames.length === 0) continue;
    const matchedIgn = findMatchingIgnName(ignRaw, queuedNames);
    if (!matchedIgn) continue;

    if (mode !== 'Emperium Overrun') {
      return { item: it, matchedIgn };
    }
    if (emperiumSecondQueueBlocks(targetType, it.type)) {
      return { item: it, matchedIgn };
    }
    if (
      isEmperiumCenterType(targetType) &&
      isEmperiumCenterType(it.type) &&
      canonicalIgnKey(ignRaw) !== canonicalIgnKey(matchedIgn)
    ) {
      return { item: it, matchedIgn };
    }
  }
  return null;
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
