/**
 * [audit] lines for PM2 / server logs — admin PUT /api/state, delete, public add.
 */

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) {
    return xf.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? '';
}

function hasStateShape(body) {
  return (
    body &&
    typeof body === 'object' &&
    Array.isArray(body.items) &&
    Array.isArray(body.members)
  );
}

function sameMultisetDifferentOrder(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
    return false;
  }
  if (a.join('\0') === b.join('\0')) return false;
  const sa = [...a].map(String).sort().join('\0');
  const sb = [...b].map(String).sort().join('\0');
  return sa === sb;
}

/**
 * Compare DB snapshot `prev` with incoming PUT `body` and return human-readable audit lines.
 */
export function describeAdminStatePut(prev, body) {
  if (!hasStateShape(body)) {
    return ['(invalid state body)'];
  }

  const lines = [];
  const nextMembers = body.members;
  const nextItems = body.items;

  const prevMemberById = new Map(prev.members.map((m) => [m.id, m]));
  const nextMemberById = new Map(nextMembers.map((m) => [m.id, m]));

  const prevShuffle = prev.shuffleLocked === true;
  const bodyHasShuffle = Object.prototype.hasOwnProperty.call(
    body,
    'shuffleLocked'
  );
  const nextShuffle = body.shuffleLocked === true;

  if (bodyHasShuffle) {
    if (!prevShuffle && nextShuffle) {
      lines.push('shuffle: lock ON (Shuffle all queues)');
    }
    if (prevShuffle && !nextShuffle) {
      lines.push('shuffle: lock OFF (Reset shuffle / Unmark)');
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'winnerShortlistUiEnabled')) {
    const w = body.winnerShortlistUiEnabled !== false;
    const pw = prev.winnerShortlistUiEnabled !== false;
    if (w !== pw) {
      lines.push(`edit: winner shortlist UI ${pw} → ${w}`);
    }
  }

  for (const nm of nextMembers) {
    const om = prevMemberById.get(nm.id);
    if (!om) {
      lines.push(`add: member "${nm.name}" (${nm.id})`);
    } else {
      if (om.name !== nm.name) {
        lines.push(`edit: member name "${om.name}" → "${nm.name}" (${nm.id})`);
      }
      if (om.role !== nm.role) {
        lines.push(`edit: member role (${nm.id}) → ${nm.role}`);
      }
    }
  }

  const prevItemById = new Map(prev.items.map((i) => [i.id, i]));

  for (const it of nextItems) {
    const pi = prevItemById.get(it.id);
    if (!pi) {
      lines.push(`add: auction item "${it.name}" (${it.id})`);
      continue;
    }

    const recPrev = JSON.stringify(pi.recordedWinnerNames ?? []);
    const recNext = JSON.stringify(it.recordedWinnerNames ?? []);
    if (
      pi.name !== it.name ||
      pi.type !== it.type ||
      pi.status !== it.status ||
      pi.winnerName !== it.winnerName ||
      recPrev !== recNext
    ) {
      lines.push(`edit: item "${it.name}" (${it.id}) fields updated`);
    }

    const before = pi.interestedMemberIds ?? [];
    const after = it.interestedMemberIds ?? [];
    const beforeSet = new Set(before);
    const afterSet = new Set(after);

    for (const mid of after) {
      if (!beforeSet.has(mid)) {
        const name = nextMemberById.get(mid)?.name ?? mid;
        lines.push(`add: queue "${it.name}" ← ${name}`);
      }
    }
    for (const mid of before) {
      if (!afterSet.has(mid)) {
        const name = prevMemberById.get(mid)?.name ?? mid;
        lines.push(`remove: queue "${it.name}" × ${name}`);
      }
    }

    if (sameMultisetDifferentOrder(before, after)) {
      lines.push(`shuffle: queue order "${it.name}"`);
    }
  }

  const nextItemIds = new Set(nextItems.map((i) => i.id));
  for (const pi of prev.items) {
    if (!nextItemIds.has(pi.id)) {
      lines.push(`remove: auction item "${pi.name}" (${pi.id})`);
    }
  }

  const nextMemberIds = new Set(nextMembers.map((m) => m.id));
  for (const pm of prev.members) {
    if (!nextMemberIds.has(pm.id)) {
      lines.push(`remove: member from roster "${pm.name}" (${pm.id})`);
    }
  }

  return lines;
}
