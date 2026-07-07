import type {
  AuctionItem,
  AuctionState,
  GuildMember,
  ItemType,
  WeeklyEventType,
  WeeklyTypeWin,
} from '../types';
import { isAuctionItemHidden } from './hiddenAuctionItems';
import { isFeatherItemType } from './featherMigration';
import {
  canonicalIgnKey,
  findMatchingIgnName,
  ignMatchesForQueueDedupe,
  ignMatchesForQueueIdentity,
} from './ignQueueIdentity';
import { isItemExemptFromBidLimit } from './bidLimitExempt';
import { emperiumWinCooldownBlocksQueueJoin, isEmperiumWinCooldownEnabled } from './emperiumWinCooldown';
import { guildLeagueWinCooldownBlocksQueueJoin, isGuildLeagueWinCooldownEnabled } from './guildLeagueWinCooldown';

export function defaultEventModeForQueues(m?: WeeklyEventType): WeeklyEventType {
  return m ?? 'Emperium Overrun';
}

/** Guild League: main shuffle lock closes public signup. Emperium Overrun: signup stays open (card + Feathers queue rules). */
export function shuffleLockClosesPublicSignup(
  shuffleLocked: boolean,
  eventMode?: WeeklyEventType
): boolean {
  if (!shuffleLocked) return false;
  return defaultEventModeForQueues(eventMode) !== 'Emperium Overrun';
}

/** Guild League or Emperium Overrun — blocks Puppet queue join when winner CD is active. */
export function weeklyTypeWinBlocksQueueJoin(
  eventMode: WeeklyEventType | undefined,
  item: Pick<AuctionItem, 'id' | 'name' | 'type'>,
  wins: WeeklyTypeWin[] | undefined,
  ignRaw: string
): boolean {
  if (isGuildLeagueWinCooldownEnabled(eventMode)) {
    return guildLeagueWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw);
  }
  if (!isEmperiumWinCooldownEnabled(eventMode)) return false;
  return emperiumWinCooldownBlocksQueueJoin(eventMode, item, wins, ignRaw);
}

export function isEmperiumCenterType(t: ItemType | string): boolean {
  return t === 'Fragment Card' || t === 'Feathers' || t === 'LND' || t === 'TNS';
}

export function isFeatherType(t: ItemType | string): boolean {
  return isFeatherItemType(t);
}

/**
 * Emperium Overrun: one queue per Fragment Card item + one Feathers queue per bidder.
 * Guild / non-center: second active queue blocks.
 */
export function emperiumSecondQueueBlocks(targetType: ItemType | string, otherType: ItemType | string): boolean {
  if (!isEmperiumCenterType(targetType) || !isEmperiumCenterType(otherType)) {
    return true;
  }
  if (isFeatherType(targetType) && isFeatherType(otherType)) {
    return true;
  }
  return false;
}

function queueMemberKey(itemId: string, mid: number): string {
  return `${itemId}\0${mid}`;
}

function groupEntriesByIgnIdentity<T extends { name: string }>(
  entries: T[],
  samePerson: (a: string, b: string) => boolean
): T[][] {
  const groups: T[][] = [];
  for (const e of entries) {
    let placed = false;
    for (const g of groups) {
      if (g.some((x) => samePerson(x.name, e.name))) {
        g.push(e);
        placed = true;
        break;
      }
    }
    if (!placed) groups.push([e]);
  }
  return groups;
}

/**
 * Guild: keep first active queue row per IGN (item order, then queue order).
 * Emperium: keep one queue per Fragment Card item + first Feathers; non-center queues stay one slot.
 *
 * @param activeItemPredicate — optional; when set, only active items matching this predicate
 *   are considered (e.g. visible-only vs hidden-only split for Guild League dedupe).
 */
export function computeKeptQueueMemberKeys(
  s: AuctionState,
  eventMode?: WeeklyEventType,
  activeItemPredicate?: (it: AuctionItem) => boolean
): Set<string> {
  const mode = defaultEventModeForQueues(eventMode);
  type Entry = { itemId: string; mid: number; type: ItemType; name: string };
  const entries: Entry[] = [];
  for (const it of s.items) {
    if (it.status !== 'active') continue;
    if (activeItemPredicate && !activeItemPredicate(it)) continue;
    for (const mid of it.interestedMemberIds) {
      const name = s.members.find((m) => m.id === mid)?.name?.trim();
      if (!name) continue;
      entries.push({ itemId: it.id, mid, type: it.type, name });
    }
  }

  const keep = new Set<string>();
  const samePerson =
    mode === 'Emperium Overrun'
      ? ignMatchesForQueueDedupe
      : ignMatchesForQueueIdentity;
  const identityGroups = groupEntriesByIgnIdentity(entries, samePerson);
  for (const group of identityGroups) {
    // Exempt items (VITE_BID_LIMIT_EXEMPT_ITEM_IDS) bypass the dedupe
    // entirely — they're always kept and never count toward the
    // "first active queue" budget that gates the non-exempt entries.
    const exemptEntries = group.filter((e) => isItemExemptFromBidLimit(e.itemId));
    for (const e of exemptEntries) {
      keep.add(queueMemberKey(e.itemId, e.mid));
    }
    const nonExempt = group.filter((e) => !isItemExemptFromBidLimit(e.itemId));

    if (mode !== 'Emperium Overrun') {
      const first = nonExempt[0];
      if (first) keep.add(queueMemberKey(first.itemId, first.mid));
      continue;
    }
    const others = nonExempt.filter((e) => !isEmperiumCenterType(e.type));
    if (others.length > 0) {
      const o = others[0];
      keep.add(queueMemberKey(o.itemId, o.mid));
      continue;
    }
    const cardByItemId = new Map<string, Entry>();
    for (const e of nonExempt) {
      if (e.type === 'Fragment Card') cardByItemId.set(e.itemId, e);
    }
    for (const e of cardByItemId.values()) {
      keep.add(queueMemberKey(e.itemId, e.mid));
    }
    const firstFeathers = [...nonExempt]
      .reverse()
      .find((e) => isFeatherType(e.type));
    if (firstFeathers) {
      keep.add(queueMemberKey(firstFeathers.itemId, firstFeathers.mid));
    }
  }
  return keep;
}

/**
 * Emperium Overrun: kapag may weekly Fragment Card win na ang IGN (hal. natapos na ang
 * card round Tue/Thu), tanggalin sa lahat ng Fragment Card queues — puwede na lang
 * Feathers hanggang Monday rollover.
 */
/** Temporarily disabled — do not strip Fragment Card queues based on weekly win log. */
export function stripEmperiumCardQueuesAfterFragmentWeeklyWin(
  s: AuctionState
): AuctionState {
  return s;
}

export function findOtherActiveQueueBlocking(
  eventMode: WeeklyEventType | undefined,
  items: AuctionItem[],
  members: GuildMember[],
  ignRaw: string,
  targetItemId: string,
  targetType: ItemType,
  opts?: { skipHiddenBlockingItems?: boolean }
): AuctionItem | null {
  return findOtherActiveQueueBlockingWithMatch(
    eventMode,
    items,
    members,
    ignRaw,
    targetItemId,
    targetType,
    opts
  )?.item ?? null;
}

export function findOtherActiveQueueBlockingWithMatch(
  eventMode: WeeklyEventType | undefined,
  items: AuctionItem[],
  members: GuildMember[],
  ignRaw: string,
  targetItemId: string,
  targetType: ItemType,
  opts?: { skipHiddenBlockingItems?: boolean }
): { item: AuctionItem; matchedIgn: string } | null {
  const mode = defaultEventModeForQueues(eventMode);

  // Joining an exempt item (see VITE_BID_LIMIT_EXEMPT_ITEM_IDS) is never
  // blocked by an existing bid on another item.
  if (isItemExemptFromBidLimit(targetItemId)) return null;

  const skipHidden =
    opts?.skipHiddenBlockingItems === true && mode !== 'Emperium Overrun';

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (skipHidden && isAuctionItemHidden(it, eventMode)) continue;
    // Existing bids on exempt items don't count against the bid limit
    // either, so they cannot become a blocker for a different target.
    if (isItemExemptFromBidLimit(it.id)) continue;

    const queuedNames: string[] = [];
    for (const mid of it.interestedMemberIds) {
      const n = members.find((m) => m.id === mid)?.name;
      if (n != null && n.trim()) queuedNames.push(n);
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
    // Emperium: same person may queue Fragment + Feathers once each, but not with alt IGNs.
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
