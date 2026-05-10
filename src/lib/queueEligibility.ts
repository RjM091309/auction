import type { AuctionItem, AuctionState, GuildMember, ItemType, WeeklyEventType } from '../types';
import { ignHasWeeklyTypeWin } from './weeklyTypeWins';

export function defaultEventModeForQueues(m?: WeeklyEventType): WeeklyEventType {
  return m ?? 'Emperium Overrun';
}

export function isEmperiumCenterType(t: ItemType): boolean {
  return t === 'Fragment Card' || t === 'LND' || t === 'TNS';
}

export function isFeatherType(t: ItemType): boolean {
  return t === 'LND' || t === 'TNS';
}

/**
 * Emperium Overrun: one bidder may queue on one Fragment Card item and one feather
 * (LND or TNS) at the same time. Guild League / non-center types: any second active
 * queue blocks (handled by caller when mode is Guild).
 */
export function emperiumSecondQueueBlocks(targetType: ItemType, otherType: ItemType): boolean {
  if (!isEmperiumCenterType(targetType) || !isEmperiumCenterType(otherType)) {
    return true;
  }
  if (targetType === 'Fragment Card' && otherType === 'Fragment Card') return true;
  if (isFeatherType(targetType) && isFeatherType(otherType)) return true;
  return false;
}

function queueMemberKey(itemId: string, mid: number): string {
  return `${itemId}\0${mid}`;
}

/**
 * Guild: keep first active queue row per IGN (item order, then queue order).
 * Emperium: keep first Fragment Card + first feather (LND/TNS); if any non-center
 * queue exists for that IGN, keep only the first of those (exclusive with center).
 */
export function computeKeptQueueMemberKeys(
  s: AuctionState,
  eventMode?: WeeklyEventType
): Set<string> {
  const mode = defaultEventModeForQueues(eventMode);
  type Entry = { itemId: string; mid: number; type: ItemType; name: string };
  const entries: Entry[] = [];
  for (const it of s.items) {
    if (it.status !== 'active') continue;
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
    const firstCard = group.find((e) => e.type === 'Fragment Card');
    const firstFeather = group.find((e) => isFeatherType(e.type));
    if (firstCard) keep.add(queueMemberKey(firstCard.itemId, firstCard.mid));
    if (firstFeather) keep.add(queueMemberKey(firstFeather.itemId, firstFeather.mid));
  }
  return keep;
}

/**
 * Emperium Overrun: kapag may weekly Fragment Card win na ang IGN (hal. natapos na ang
 * card round Tue/Thu), tanggalin sa lahat ng Fragment Card queues — puwede na lang
 * LND o TNS hanggang Monday rollover.
 */
export function stripEmperiumCardQueuesAfterFragmentWeeklyWin(
  s: AuctionState
): AuctionState {
  if (defaultEventModeForQueues(s.eventMode) !== 'Emperium Overrun') return s;
  const wins = s.weeklyTypeWins;
  if (!wins?.length) return s;

  let changed = false;
  const items = s.items.map((it) => {
    if (it.status !== 'active' || it.type !== 'Fragment Card') return it;
    const newIds = it.interestedMemberIds.filter((mid) => {
      const m = s.members.find((x) => x.id === mid);
      if (!m?.name) return true;
      return !ignHasWeeklyTypeWin(wins, m.name, 'Fragment Card');
    });
    if (newIds.length === it.interestedMemberIds.length) return it;
    changed = true;
    return { ...it, interestedMemberIds: newIds };
  });
  return changed ? { ...s, items } : s;
}

export function findOtherActiveQueueBlocking(
  eventMode: WeeklyEventType | undefined,
  items: AuctionItem[],
  members: GuildMember[],
  ignLower: string,
  targetItemId: string,
  targetType: ItemType
): AuctionItem | null {
  const norm = ignLower.trim().toLowerCase();
  const queueHasIgn = (it: AuctionItem) =>
    it.interestedMemberIds.some((mid) => {
      const n = members.find((m) => m.id === mid)?.name;
      return n != null && n.trim().toLowerCase() === norm;
    });

  const mode = defaultEventModeForQueues(eventMode);

  for (const it of items) {
    if (it.status !== 'active' || it.id === targetItemId) continue;
    if (!queueHasIgn(it)) continue;

    if (mode !== 'Emperium Overrun') {
      return it;
    }
    if (emperiumSecondQueueBlocks(targetType, it.type)) return it;
  }
  return null;
}
