import { randomUUID } from 'crypto';
import { DATA_VERSION } from './defaults.js';

function clientError(statusCode, message, opts = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (opts.code) err.code = opts.code;
  if (opts.extra) err.extra = opts.extra;
  return err;
}

function isAuctionState(body) {
  return (
    body &&
    typeof body === 'object' &&
    Array.isArray(body.items) &&
    Array.isArray(body.members)
  );
}

export async function getFullState(pool) {
  const [members] = await pool.query(
    'SELECT id, name, role FROM members WHERE active = 1 ORDER BY name'
  );

  const [itemRows] = await pool.query(
    `SELECT id, name, type, winner_name AS winnerName, status, created_at AS createdAt
     FROM auction_items
     ORDER BY created_at ASC`
  );

  // Only queue rows whose member is active (avoids invisible UI rows when
  // item_queue still references inactive or missing roster rows).
  const [queueRows] = await pool.query(
    `SELECT iq.item_id AS itemId, iq.member_id AS memberId, iq.position
     FROM item_queue iq
     INNER JOIN members m ON m.id = iq.member_id AND m.active = 1
     ORDER BY iq.item_id, iq.position`
  );

  const queueByItem = new Map();
  for (const q of queueRows) {
    if (!queueByItem.has(q.itemId)) queueByItem.set(q.itemId, []);
    queueByItem.get(q.itemId).push(q.memberId);
  }

  const items = itemRows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    winnerName: r.winnerName,
    status: r.status,
    createdAt: Number(r.createdAt),
    interestedMemberIds: queueByItem.get(r.id) ?? [],
  }));

  let dataVersion = DATA_VERSION;
  const [metaRows] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'data_version' LIMIT 1"
  );
  if (metaRows[0]?.value != null) {
    const v = parseInt(String(metaRows[0].value), 10);
    if (!Number.isNaN(v)) dataVersion = v;
  }

  let winnerShortlistUiEnabled = true;
  const [shortlistMeta] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'winner_shortlist_ui' LIMIT 1"
  );
  if (shortlistMeta[0]?.value === '0') winnerShortlistUiEnabled = false;

  let shuffleLocked = false;
  const [shuffleLockRows] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'shuffle_locked' LIMIT 1"
  );
  if (shuffleLockRows[0]?.value === '1') shuffleLocked = true;

  return {
    items,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
    })),
    dataVersion,
    winnerShortlistUiEnabled,
    shuffleLocked,
  };
}

/**
 * Public: add IGN to an active item’s queue (same rules as admin “Add name to queue”).
 * Persists via replaceFullState. No auth.
 */
export async function publicAddBidToQueue(pool, body) {
  const raw = typeof body?.name === 'string' ? body.name.trim() : '';
  if (!raw) {
    throw clientError(400, 'Name is required');
  }
  const tid = typeof body?.itemId === 'string' ? body.itemId.trim() : '';
  if (!tid) {
    throw clientError(400, 'Item is required');
  }

  const state = await getFullState(pool);

  if (state.shuffleLocked === true) {
    throw clientError(400, 'Queue signup is closed until the next reset', {
      code: 'shuffle_locked',
    });
  }

  const ignLower = raw.toLowerCase();

  const card = state.items.find((it) => it.id === tid);
  if (!card) {
    const err = new Error('Item not found');
    err.statusCode = 404;
    throw err;
  }
  if (card.status !== 'active') {
    throw clientError(400, 'This auction is not active');
  }

  const queueHasThisIgn = (it) =>
    it.interestedMemberIds.some((mid) => {
      const n = state.members.find((m) => m.id === mid)?.name;
      return n != null && n.trim().toLowerCase() === ignLower;
    });

  if (queueHasThisIgn(card)) {
    throw clientError(400, 'Already in this queue', {
      code: 'already_listed',
      extra: { itemName: card.name },
    });
  }

  const otherCard = state.items.find(
    (it) =>
      it.status === 'active' && it.id !== tid && queueHasThisIgn(it)
  );
  if (otherCard) {
    throw clientError(400, 'Already on another item', {
      code: 'on_other_item',
      extra: { otherItemName: otherCard.name },
    });
  }

  const existing = state.members.find(
    (m) => m.name.toLowerCase() === ignLower
  );
  const mid = existing?.id ?? randomUUID();

  const membersNext = existing
    ? state.members
    : [...state.members, { id: mid, name: raw, role: 'Member' }];

  const itemsNext = state.items.map((it) => {
    if (it.id !== tid) return it;
    if (it.interestedMemberIds.includes(mid)) return it;
    return {
      ...it,
      interestedMemberIds: [...it.interestedMemberIds, mid],
    };
  });

  await replaceFullState(pool, {
    items: itemsNext,
    members: membersNext,
    dataVersion: state.dataVersion,
    winnerShortlistUiEnabled: state.winnerShortlistUiEnabled !== false,
    shuffleLocked: state.shuffleLocked === true,
  });

  return getFullState(pool);
}

/** Soft-delete member (active=0) and remove from all queues; returns fresh state. */
export async function deactivateMember(pool, memberId) {
  const id = typeof memberId === 'string' ? memberId.trim() : '';
  if (!id) {
    const err = new Error('Invalid member id');
    err.statusCode = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [found] = await conn.query(
      'SELECT id FROM members WHERE id = ? LIMIT 1',
      [id]
    );
    if (!Array.isArray(found) || found.length === 0) {
      await conn.rollback();
      const err = new Error('Member not found');
      err.statusCode = 404;
      throw err;
    }
    await conn.query('DELETE FROM item_queue WHERE member_id = ?', [id]);
    await conn.query('UPDATE members SET active = 0 WHERE id = ?', [id]);
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    if (e.statusCode) throw e;
    throw e;
  } finally {
    conn.release();
  }

  return getFullState(pool);
}

export async function replaceFullState(pool, body) {
  if (!isAuctionState(body)) {
    const err = new Error('Invalid body: expected { items: [], members: [] }');
    err.statusCode = 400;
    throw err;
  }

  const dataVersion = body.dataVersion ?? DATA_VERSION;
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM item_queue');
    await conn.query('DELETE FROM auction_items');

    const memberIds = Array.isArray(body.members)
      ? body.members.map((m) => m.id).filter((x) => typeof x === 'string' && x)
      : [];

    for (const m of body.members) {
      await conn.query(
        `INSERT INTO members (id, name, role, active) VALUES (?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), active = 1`,
        [m.id, m.name, m.role]
      );
    }

    if (memberIds.length > 0) {
      const ph = memberIds.map(() => '?').join(',');
      await conn.query(
        `UPDATE members SET active = 0 WHERE id NOT IN (${ph})`,
        memberIds
      );
    }

    for (const it of body.items) {
      await conn.query(
        `INSERT INTO auction_items (id, name, type, winner_name, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          it.id,
          it.name,
          it.type,
          it.winnerName ?? null,
          it.status,
          Number(it.createdAt) || Date.now(),
        ]
      );
      const ids = Array.isArray(it.interestedMemberIds)
        ? it.interestedMemberIds
        : [];
      let pos = 0;
      for (const memberId of ids) {
        await conn.query(
          'INSERT INTO item_queue (item_id, member_id, position) VALUES (?, ?, ?)',
          [it.id, memberId, pos]
        );
        pos += 1;
      }
    }

    await conn.query(
      'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
      ['data_version', String(dataVersion)]
    );

    if (Object.prototype.hasOwnProperty.call(body, 'winnerShortlistUiEnabled')) {
      const shortlistVal = body.winnerShortlistUiEnabled === false ? '0' : '1';
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['winner_shortlist_ui', shortlistVal]
      );
    }

    if (Object.prototype.hasOwnProperty.call(body, 'shuffleLocked')) {
      const lockVal = body.shuffleLocked ? '1' : '0';
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        ['shuffle_locked', lockVal]
      );
    }

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
