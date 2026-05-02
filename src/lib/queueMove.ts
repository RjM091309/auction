import type { DragEvent } from 'react';
import type { AuctionState } from '../types';

export const QUEUE_DRAG_MIME = 'application/x-rooc-queue';

export type QueueMovePayload = {
  fromItemId: string;
  toItemId: string;
  memberId: string;
  /** Insert before this member id; `null` = end of queue */
  insertBeforeMemberId: string | null;
};

export type QueueMoveError = 'not_found' | 'name_conflict' | 'no_change';

export function applyQueueMemberMove(
  s: AuctionState,
  p: QueueMovePayload
): AuctionState | { error: QueueMoveError; toItemName?: string } {
  const { fromItemId, toItemId, memberId, insertBeforeMemberId } = p;

  const member = s.members.find((m) => m.id === memberId);
  if (!member) return { error: 'not_found' };

  const fromItem = s.items.find((i) => i.id === fromItemId);
  const toItem = s.items.find((i) => i.id === toItemId);
  if (!fromItem || !toItem || toItem.status !== 'active') {
    return { error: 'not_found' };
  }
  if (!fromItem.interestedMemberIds.includes(memberId)) {
    return { error: 'no_change' };
  }

  const ignLower = member.name.trim().toLowerCase();

  const fromList = fromItem.interestedMemberIds.filter((id) => id !== memberId);

  const toListBase =
    fromItemId === toItemId ? fromList : [...toItem.interestedMemberIds];

  const nameTakenOnTarget = toListBase.some(
    (id) =>
      id !== memberId &&
      s.members.find((m) => m.id === id)?.name.trim().toLowerCase() === ignLower
  );
  if (nameTakenOnTarget) {
    return { error: 'name_conflict', toItemName: toItem.name };
  }

  if (fromItemId !== toItemId && toListBase.includes(memberId)) {
    return { error: 'no_change' };
  }

  const toList = [...toListBase];
  let insertAt =
    insertBeforeMemberId == null
      ? toList.length
      : toList.indexOf(insertBeforeMemberId);
  if (insertAt < 0) insertAt = toList.length;

  if (fromItemId === toItemId && insertBeforeMemberId === memberId) {
    return { error: 'no_change' };
  }

  toList.splice(insertAt, 0, memberId);

  if (fromItemId === toItemId) {
    return {
      ...s,
      items: s.items.map((it) =>
        it.id === fromItemId ? { ...it, interestedMemberIds: toList } : it
      ),
    };
  }

  return {
    ...s,
    items: s.items.map((it) => {
      if (it.id === fromItemId) return { ...it, interestedMemberIds: fromList };
      if (it.id === toItemId) return { ...it, interestedMemberIds: toList };
      return it;
    }),
  };
}

export function parseQueueDragPayload(
  e: DragEvent
): { fromItemId: string; memberId: string } | null {
  const raw = e.dataTransfer.getData(QUEUE_DRAG_MIME);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { fromItemId?: string; memberId?: string };
    if (
      typeof o.fromItemId === 'string' &&
      typeof o.memberId === 'string' &&
      o.fromItemId &&
      o.memberId
    ) {
      return { fromItemId: o.fromItemId, memberId: o.memberId };
    }
  } catch {
    /* ignore */
  }
  return null;
}
