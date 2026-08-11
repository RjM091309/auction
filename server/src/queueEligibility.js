/**
 * Keep in sync with `src/lib/queueEligibility.ts` (Emperium vs Guild queue rules).
 */

import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';
import { findMatchingIgnName, canonicalIgnKey } from './ignQueueIdentity.js';
import { isItemExemptFromBidLimit } from './bidLimitExempt.js';
import { emperiumWinCooldownBlocksQueueJoin, isEmperiumWinCooldownEnabled } from './emperiumWinCooldown.js';
import {
  guildLeagueWinCooldownBlocksQueueJoin,
  isGuildLeagueWinCooldownEnabled,
} from './guildLeagueWinCooldown.js';

/** @param {string | undefined} m */
export function defaultEventModeForQueues(m) {
  return m === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

/** Guild League: shuffle lock closes public signup. Emperium Overrun: stays open. */
export function shuffleLockClosesPublicSignup(shuffleLocked, eventMode) {
  if (!shuffleLocked) return false;
  return defaultEventModeForQueues(eventMode) !== 'Emperium Overrun';
}

/** Guild League or Emperium Overrun — blocks Puppet queue join when winner CD is active. */
export function weeklyTypeWinBlocksQueueJoin(eventMode, item, wins, ignRaw) {
  if (isGuildLeagueWinCooldownEnabled(eventMode)) {
    return guildLeagueWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw);
  }
  if (!isEmperiumWinCooldownEnabled(eventMode)) return false;
  return emperiumWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw);
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

  // Joining an exempt item (see VITE_BID_LIMIT_EXEMPT_ITEM_IDS) is never
  // blocked by an existing bid on another item.
  if (isItemExemptFromBidLimit(targetItemId)) return null;

  const skipHidden =
    opts && opts.skipHiddenBlockingItems === true && mode !== 'Emperium Overrun';

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (skipHidden && isAuctionItemHiddenForPublic(it, eventMode)) continue;
    // Existing bids on exempt items don't count against the bid limit
    // either, so they cannot become a blocker for a different target.
    if (isItemExemptFromBidLimit(it.id)) continue;

    const queuedNames = [];
    for (const mid of it.interestedMemberIds) {
      const n = members.find((m) => m.id === mid)?.name;
      if (n != null && String(n).trim()) queuedNames.push(n);
    }
    if (queuedNames.length === 0) continue;
    const matchedIgn = findMatchingIgnName(ignRaw, queuedNames);
    if (!matchedIgn) continue;

    if (mode === 'Guild League') {
      // Temporarily disabled per request: Guild League no longer limits an
      // IGN to one active queue — a Puppet Frag Card bid no longer blocks a
      // Feathers bid (or any other item) at the same time.
      continue;
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
