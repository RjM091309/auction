import { DATA_VERSION } from './defaults.js';

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
    'SELECT id, name, role FROM members ORDER BY name'
  );

  const [itemRows] = await pool.query(
    `SELECT id, name, type, winner_name AS winnerName, status, created_at AS createdAt
     FROM auction_items
     ORDER BY created_at ASC`
  );

  const [queueRows] = await pool.query(
    `SELECT item_id AS itemId, member_id AS memberId, position
     FROM item_queue
     ORDER BY item_id, position`
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

  return {
    items,
    members: members.map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
    })),
    dataVersion,
  };
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
    await conn.query('DELETE FROM members');

    for (const m of body.members) {
      await conn.query(
        'INSERT INTO members (id, name, role) VALUES (?, ?, ?)',
        [m.id, m.name, m.role]
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

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
