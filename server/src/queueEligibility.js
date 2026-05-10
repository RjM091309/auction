/**
 * Keep in sync with `src/lib/queueEligibility.ts` (Emperium vs Guild queue rules).
 */

/** @param {string | undefined} m */
export function defaultEventModeForQueues(m) {
  return m === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
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
  if (isFeatherType(targetType) && isFeatherType(otherType)) return true;
  return false;
}

/**
 * @param {unknown} eventMode
 * @param {{ id: string, status: string, type: string, interestedMemberIds: number[] }[]} items
 * @param {{ id: number, name: string }[]} members
 */
export function findOtherActiveQueueBlocking(
  eventMode,
  items,
  members,
  ignLower,
  targetItemId,
  targetType
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
export function stripEmperiumCardQueuesAfterFragmentWeeklyWin(s) {
  if (defaultEventModeForQueues(s.eventMode) !== 'Emperium Overrun') return s;
  const wins = s.weeklyTypeWins;
  if (!Array.isArray(wins) || wins.length === 0) return s;

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
