import type {
  AuctionItem,
  AuctionState,
  GuildMember,
  ItemType,
  WeeklyEventType,
  WeeklyTypeWin,
} from '../types';
import { isAuctionItemHidden } from './hiddenAuctionItems';

export function defaultEventModeForQueues(m?: WeeklyEventType): WeeklyEventType {
  return m ?? 'Emperium Overrun';
}

/** Guild League: main shuffle lock closes public signup. Emperium Overrun: signup stays open (card + LND + TNS queue rules). */
export function shuffleLockClosesPublicSignup(
  shuffleLocked: boolean,
  eventMode?: WeeklyEventType
): boolean {
  if (!shuffleLocked) return false;
  return defaultEventModeForQueues(eventMode) !== 'Emperium Overrun';
}

/**
 * Weekly green-check / winner lock — temporarily disabled so log/history does not block bids.
 */
export function weeklyTypeWinBlocksQueueJoin(
  _eventMode: WeeklyEventType | undefined,
  _itemType: ItemType,
  _wins: WeeklyTypeWin[] | undefined,
  _ignRaw: string
): boolean {
  return false;
}

export function isEmperiumCenterType(t: ItemType): boolean {
  return t === 'Fragment Card' || t === 'LND' || t === 'TNS';
}

export function isFeatherType(t: ItemType): boolean {
  return t === 'LND' || t === 'TNS';
}

/**
 * Emperium Overrun: one Fragment Card queue + one LND queue + one TNS queue per bidder
 * (same feather type twice still blocks). Guild / non-center: second active queue blocks.
 */
export function emperiumSecondQueueBlocks(targetType: ItemType, otherType: ItemType): boolean {
  if (!isEmperiumCenterType(targetType) || !isEmperiumCenterType(otherType)) {
    return true;
  }
  if (targetType === 'Fragment Card' && otherType === 'Fragment Card') return true;
  if (isFeatherType(targetType) && isFeatherType(otherType)) {
    return targetType === otherType;
  }
  return false;
}

function queueMemberKey(itemId: string, mid: number): string {
  return `${itemId}\0${mid}`;
}

/**
 * Guild: keep first active queue row per IGN (item order, then queue order).
 * Emperium: keep first Fragment Card + first LND + first TNS; non-center queues stay one slot.
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
      const name = s.members.find((m) => m.id === mid)?.name?.trim().toLowerCase();
      if (!name) continue;
      entries.push({ itemId: it.id, mid, type: it.type, name });
    }
  }

  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }

  const keep = new Set<string>();
  for (const [, group] of byName) {
    if (mode !== 'Emperium Overrun') {
      const first = group[0];
      if (first) keep.add(queueMemberKey(first.itemId, first.mid));
      continue;
    }
    const others = group.filter((e) => !isEmperiumCenterType(e.type));
    if (others.length > 0) {
      const o = others[0];
      keep.add(queueMemberKey(o.itemId, o.mid));
      continue;
    }
    // Prefer the latest queue row per type (newest bid wins over legacy duplicates).
    const firstCard = [...group].reverse().find((e) => e.type === 'Fragment Card');
    const firstLnd = [...group].reverse().find((e) => e.type === 'LND');
    const firstTns = [...group].reverse().find((e) => e.type === 'TNS');
    if (firstCard) keep.add(queueMemberKey(firstCard.itemId, firstCard.mid));
    if (firstLnd) keep.add(queueMemberKey(firstLnd.itemId, firstLnd.mid));
    if (firstTns) keep.add(queueMemberKey(firstTns.itemId, firstTns.mid));
  }
  return keep;
}

/**
 * Emperium Overrun: kapag may weekly Fragment Card win na ang IGN (hal. natapos na ang
 * card round Tue/Thu), tanggalin sa lahat ng Fragment Card queues — puwede na lang
 * LND/TNS hanggang Monday rollover.
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
  ignLower: string,
  targetItemId: string,
  targetType: ItemType,
  opts?: { skipHiddenBlockingItems?: boolean }
): AuctionItem | null {
  const norm = ignLower.trim().toLowerCase();
  const queueHasIgn = (it: AuctionItem) =>
    it.interestedMemberIds.some((mid) => {
      const n = members.find((m) => m.id === mid)?.name;
      return n != null && n.trim().toLowerCase() === norm;
    });

  const mode = defaultEventModeForQueues(eventMode);

  const skipHidden =
    opts?.skipHiddenBlockingItems === true && mode !== 'Emperium Overrun';

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (skipHidden && isAuctionItemHidden(it)) continue;
    if (!queueHasIgn(it)) continue;

    if (mode !== 'Emperium Overrun') {
      return it;
    }
    if (emperiumSecondQueueBlocks(targetType, it.type)) return it;
  }
  return null;
}
