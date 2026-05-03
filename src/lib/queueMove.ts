import type { DragEvent } from 'react';
import type { AuctionState } from '../types';
import { ignHasWeeklyTypeWin } from './weeklyTypeWins';

export const QUEUE_DRAG_MIME = 'application/x-rooc-queue';

export type QueueMovePayload = {
  fromItemId: string;
  toItemId: string;
  memberId: number;
  /** Insert before this member id; `null` = end of queue */
  insertBeforeMemberId: number | null;
};

export type QueueMoveError =
  | 'not_found'
  | 'name_conflict'
  | 'no_change'
  | 'weekly_type_win';

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

  if (
    fromItemId !== toItemId &&
    ignHasWeeklyTypeWin(s.weeklyTypeWins, member.name, toItem.type)
  ) {
    return { error: 'weekly_type_win', toItemName: toItem.name };
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

function parseDragMemberId(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return raw;
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
    const n = parseInt(raw.trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

export function parseQueueDragPayload(
  e: DragEvent
): { fromItemId: string; memberId: number } | null {
  const raw = e.dataTransfer.getData(QUEUE_DRAG_MIME);
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { fromItemId?: string; memberId?: unknown };
    const memberId = parseDragMemberId(o.memberId);
    if (typeof o.fromItemId === 'string' && o.fromItemId && memberId != null) {
      return { fromItemId: o.fromItemId, memberId };
    }
  } catch {
    /* ignore */
  }
  return null;
}
