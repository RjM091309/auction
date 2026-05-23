import { DATA_VERSION } from './defaults.js';
import {
  findMatchingIgnName,
  ignMatchesForQueueIdentity,
  matchingIgnOnQueueItem,
  queueItemHasMatchingIgn,
  findMemberByIgnIdentity,
} from './ignQueueIdentity.js';
import {
  findOtherActiveQueueBlockingWithMatch,
  shuffleLockClosesPublicSignup,
  stripEmperiumCardQueuesAfterFragmentWeeklyWin,
} from './queueEligibility.js';
import { maxRecordedWinnersForItem } from './winnerPoolCaps.js';
import {
  rolloverWeeklyWinsIfNewWeek,
  saveWeeklyTypeWins,
} from './weeklyTypeWins.js';
import { getAuctionWeekMondayKey } from './auctionWeek.js';
import { loadWinnerMarkLog, appendWinnerMarkLog } from './winnerMarkLog.js';
import {
  loadBidderStateLog,
  appendBidderStateLog,
} from './bidderStateLog.js';
import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';

const EVENT_MODE_META_KEY = 'event_mode';
const REWARD_RANK_META_KEY = 'reward_rank';
const REWARD_ITEM_COUNTS_META_KEY = 'reward_item_counts_json';
const FREE_DRAW_CHOSEN_META_KEY = 'free_draw_chosen_by_item';

function defaultEventMode() {
  return 'Emperium Overrun';
}
function defaultRewardRank() {
  return 'Bronze';
}

function sanitizeEventName(v) {
  return v === 'Guild League' ? 'Guild League' : 'Emperium Overrun';
}

function parseEventMode(raw) {
  if (raw == null || raw === '') return defaultEventMode();
  return sanitizeEventName(typeof raw === 'string' ? raw : String(raw));
}
function sanitizeRewardRank(v) {
  const s = typeof v === 'string' ? v : String(v ?? '');
  if (s === 'Emperium overrun') return 'Emperium overrun';
  return 'Bronze';
}
function parseRewardRank(raw) {
  if (raw == null || raw === '') return defaultRewardRank();
  return sanitizeRewardRank(typeof raw === 'string' ? raw : String(raw));
}
function parseRewardItemCounts(raw) {
  const fallback = { fragment: 2, feathers: 80 };
  if (raw == null || raw === '') return fallback;
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object') return fallback;
    const toInt = (v, d) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d;
    const fragment = toInt(j.fragment, fallback.fragment);
    if (j.feathers != null && j.feathers !== '') {
      return { fragment, feathers: toInt(j.feathers, fallback.feathers) };
    }
    const lnd = toInt(j.lnd, 30);
    const tns = toInt(j.tns, 50);
    return { fragment, feathers: lnd + tns };
  } catch {
    return fallback;
  }
}

/** Map itemId → member id for “shuffle draw free” highlight (public + admin). */
function parseFreeDrawChosenByItemJson(raw) {
  if (raw == null || raw === '') return {};
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (typeof k !== 'string' || !k) continue;
      const id = coerceMemberId(v);
      if (id != null && id > 0) out[k] = id;
    }
    return out;
  } catch {
    return {};
  }
}

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

/** Positive integer member id from client JSON, or null if temp/new (0, negative, non-numeric string). */
function coerceMemberId(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) {
    const n = parseInt(v.trim(), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

function resolveQueueMemberId(raw, idRemap) {
  if (idRemap.has(raw)) return idRemap.get(raw);
  const s = String(raw);
  if (idRemap.has(s)) return idRemap.get(s);
  return coerceMemberId(raw);
}

function parseWinnerNamesJson(raw) {
  if (raw == null || raw === '') return [];
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!Array.isArray(j)) return [];
    return j
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function serializeWinnerNamesJson(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const cleaned = arr
    .filter((x) => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean);
  if (cleaned.length === 0) return null;
  return JSON.stringify(cleaned);
}

function ignForRemappedMember(body, idRemap, resolvedId) {
  for (const m of body.members) {
    const r = idRemap.get(m.id) ?? idRemap.get(String(m.id));
    if (r === resolvedId && typeof m.name === 'string') return m.name;
  }
  return '';
}

export async function getFullState(pool) {
  await rolloverWeeklyWinsIfNewWeek(pool);

  const [members] = await pool.query(
    'SELECT id, name, role FROM members WHERE active = 1 ORDER BY name'
  );

  const [itemRows] = await pool.query(
    `SELECT id, name, type, winner_pool_cap AS winnerPoolCap, winner_name AS winnerName, winner_names_json AS winnerNamesJson, status, created_at AS createdAt
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
    queueByItem.get(q.itemId).push(Number(q.memberId));
  }

  const items = itemRows.map((r) => {
    const recorded = parseWinnerNamesJson(r.winnerNamesJson);
    return {
      id: r.id,
      name: r.name,
      type: r.type,
      winnerPoolCap:
        r.winnerPoolCap != null && r.winnerPoolCap !== ''
          ? Number(r.winnerPoolCap)
          : null,
      winnerName: r.winnerName,
      ...(recorded.length > 0 ? { recordedWinnerNames: recorded } : {}),
      status: r.status,
      createdAt: Number(r.createdAt),
      interestedMemberIds: queueByItem.get(r.id) ?? [],
    };
  });

  let dataVersion = DATA_VERSION;
  const [metaRows] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'data_version' LIMIT 1"
  );
  if (metaRows[0]?.value != null) {
    const v = parseInt(String(metaRows[0].value), 10);
    if (!Number.isNaN(v)) dataVersion = v;
  }

  /** Walang row = bagong / na-reset na DB — walang shortlist chrome hanggang mag-Shuffle (nagsusulat ng '1'). */
  let winnerShortlistUiEnabled = false;
  const [shortlistMeta] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'winner_shortlist_ui' LIMIT 1"
  );
  if (shortlistMeta[0]?.value === '1') winnerShortlistUiEnabled = true;

  let shuffleLocked = false;
  const [shuffleLockRows] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'shuffle_locked' LIMIT 1"
  );
  if (shuffleLockRows[0]?.value === '1') shuffleLocked = true;

  const weeklyTypeWins = [];
  const winnerMarkLog = await loadWinnerMarkLog(pool);
  const bidderStateLog = await loadBidderStateLog(pool);
  const [eventRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [EVENT_MODE_META_KEY]
  );
  const eventMode = parseEventMode(eventRows[0]?.value);
  const [rankRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [REWARD_RANK_META_KEY]
  );
  const rewardRank = parseRewardRank(rankRows[0]?.value);
  const [countRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [REWARD_ITEM_COUNTS_META_KEY]
  );
  const rewardItemCounts = parseRewardItemCounts(countRows[0]?.value);

  const [freeDrawMeta] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [FREE_DRAW_CHOSEN_META_KEY]
  );
  const freeDrawChosenByItemId = parseFreeDrawChosenByItemJson(freeDrawMeta[0]?.value);

  return stripEmperiumCardQueuesAfterFragmentWeeklyWin({
    items,
    members: members.map((m) => ({
      id: Number(m.id),
      name: m.name,
      role: m.role,
    })),
    dataVersion,
    winnerShortlistUiEnabled,
    shuffleLocked,
    weeklyTypeWins,
    winnerMarkLog,
    bidderStateLog,
    eventMode,
    rewardRank,
    rewardItemCounts,
    freeDrawChosenByItemId,
  });
}

/** Find active roster row by IGN (fuzzy) or create one. */
async function findOrCreateActiveMemberId(conn, rawName) {
  const name = rawName.trim();
  const [rows] = await conn.query(
    `SELECT id, name, active FROM members WHERE active = 1 ORDER BY id ASC`
  );
  if (Array.isArray(rows)) {
    const matchName = findMatchingIgnName(
      name,
      rows.map((r) => String(r.name ?? ''))
    );
    if (matchName) {
      const row = rows.find((r) =>
        ignMatchesForQueueIdentity(String(r.name ?? ''), matchName)
      );
      if (row) return Number(row.id);
    }
  }

  const ignLower = name.toLowerCase();
  const [inactive] = await conn.query(
    `SELECT id FROM members
     WHERE active = 0 AND LOWER(TRIM(name)) = ?
     ORDER BY id ASC LIMIT 1`,
    [ignLower]
  );
  if (Array.isArray(inactive) && inactive.length > 0) {
    const id = Number(inactive[0].id);
    await conn.query('UPDATE members SET active = 1, name = ? WHERE id = ?', [
      name,
      id,
    ]);
    return id;
  }

  const [ins] = await conn.query(
    'INSERT INTO members (name, role, active) VALUES (?, ?, 1)',
    [name, 'Member']
  );
  return Number(ins.insertId);
}

/** True if a matching IGN is already on this item queue. */
async function itemQueueHasIgn(conn, itemId, ignRaw) {
  const [rows] = await conn.query(
    `SELECT m.name FROM item_queue iq
     INNER JOIN members m ON m.id = iq.member_id AND m.active = 1
     WHERE iq.item_id = ?`,
    [itemId]
  );
  if (!Array.isArray(rows) || rows.length === 0) return false;
  return (
    findMatchingIgnName(
      ignRaw,
      rows.map((r) => String(r.name ?? ''))
    ) != null
  );
}

/**
 * Public: add IGN to an active item’s queue (same rules as admin “Add name to queue”).
 * Appends one `item_queue` row (no full-state replace). No auth.
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

  if (shuffleLockClosesPublicSignup(state.shuffleLocked === true, state.eventMode)) {
    throw clientError(400, 'Queue signup is closed until the next reset', {
      code: 'shuffle_locked',
    });
  }

  const card = state.items.find((it) => it.id === tid);
  if (!card) {
    const err = new Error('Item not found');
    err.statusCode = 404;
    throw err;
  }
  if (card.status !== 'active') {
    throw clientError(400, 'This auction is not active');
  }

  if (isAuctionItemHiddenForPublic(card)) {
    throw clientError(404, 'Item not found', { code: 'item_hidden' });
  }

  const matchedOnCard = matchingIgnOnQueueItem(card, state.members, raw);
  if (matchedOnCard) {
    throw clientError(400, 'Already in this queue', {
      code: 'already_listed',
      extra: { itemName: card.name, matchedIgn: matchedOnCard },
    });
  }

  const eventMode = state.eventMode ?? defaultEventMode();
  const otherBlock = findOtherActiveQueueBlockingWithMatch(
    eventMode,
    state.items,
    state.members,
    raw,
    tid,
    card.type,
    { skipHiddenBlockingItems: true }
  );
  if (otherBlock) {
    throw clientError(400, 'Already on another item', {
      code: 'on_other_item',
      extra: {
        otherItemName: otherBlock.item.name,
        matchedIgn: otherBlock.matchedIgn,
      },
    });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    if (await itemQueueHasIgn(conn, tid, raw)) {
      const [rows] = await conn.query(
        `SELECT m.name FROM item_queue iq
         INNER JOIN members m ON m.id = iq.member_id AND m.active = 1
         WHERE iq.item_id = ?`,
        [tid]
      );
      const matchedIgn = findMatchingIgnName(
        raw,
        (Array.isArray(rows) ? rows : []).map((r) => String(r.name ?? ''))
      );
      throw clientError(400, 'Already in this queue', {
        code: 'already_listed',
        extra: { itemName: card.name, matchedIgn: matchedIgn ?? undefined },
      });
    }

    const memberId = await findOrCreateActiveMemberId(conn, raw);

    const [posRows] = await conn.query(
      'SELECT COALESCE(MAX(position), -1) + 1 AS nextPos FROM item_queue WHERE item_id = ?',
      [tid]
    );
    const nextPos = Number(posRows[0]?.nextPos ?? 0);

    await conn.query(
      'INSERT INTO item_queue (item_id, member_id, position) VALUES (?, ?, ?)',
      [tid, memberId, nextPos]
    );

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

/** Remove one member from a single item queue (roster row stays active). */
export async function removeMemberFromItemQueue(pool, itemId, memberId) {
  const tid = typeof itemId === 'string' ? itemId.trim() : '';
  const id =
    typeof memberId === 'number' && Number.isInteger(memberId)
      ? memberId
      : parseInt(String(memberId ?? '').trim(), 10);
  if (!tid) {
    const err = new Error('Item id is required');
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error('Invalid member id');
    err.statusCode = 400;
    throw err;
  }

  const [itemRows] = await pool.query(
    'SELECT id FROM auction_items WHERE id = ? LIMIT 1',
    [tid]
  );
  if (!Array.isArray(itemRows) || itemRows.length === 0) {
    const err = new Error('Item not found');
    err.statusCode = 404;
    throw err;
  }

  await pool.query('DELETE FROM item_queue WHERE item_id = ? AND member_id = ?', [
    tid,
    id,
  ]);

  return getFullState(pool);
}

/** Soft-delete member (active=0) and remove from all queues; returns fresh state. */
export async function deactivateMember(pool, memberId) {
  const id =
    typeof memberId === 'number' && Number.isInteger(memberId)
      ? memberId
      : parseInt(String(memberId ?? '').trim(), 10);
  if (!Number.isInteger(id) || id <= 0) {
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

  await rolloverWeeklyWinsIfNewWeek(pool);

  const [shuffleMetaPrev] = await pool.query(
    "SELECT value FROM app_meta WHERE `key` = 'shuffle_locked' LIMIT 1"
  );
  const prevShuffleLocked =
    Array.isArray(shuffleMetaPrev) &&
    shuffleMetaPrev[0] &&
    shuffleMetaPrev[0].value === '1';

  const [oldItemRows] = await pool.query(
    `SELECT id, name, type, status, winner_name AS winnerName, winner_names_json AS winnerNamesJson FROM auction_items`
  );
  /** No weekly type lock — winners may bid again on the next auction (Fragment Card + Feathers). */
  const nextWeeklyWins = [];

  for (const it of body.items) {
    const rec = it.recordedWinnerNames;
    if (Array.isArray(rec) && rec.length > 0) {
      const cap = maxRecordedWinnersForItem(it.type, it.winnerPoolCap);
      if (rec.length > cap) {
        const err = new Error(
          `Too many marked winners on "${it.name}" (${it.type}): max ${cap} (winner limit for this item)`
        );
        err.statusCode = 400;
        throw err;
      }
    }
  }

  const dataVersion = body.dataVersion ?? DATA_VERSION;

  const prevByItemId = new Map(oldItemRows.map((r) => [r.id, r]));
  const newWinnerMarkEntries = [];
  const markNow = Date.now();
  for (const it of body.items) {
    const row = prevByItemId.get(it.id) ?? prevByItemId.get(String(it.id));
    const prevNames = parseWinnerNamesJson(row?.winnerNamesJson);
    const prevLower = new Set(
      prevNames.map((p) => String(p).trim().toLowerCase()).filter(Boolean)
    );
    const nextArr = Array.isArray(it.recordedWinnerNames) ? it.recordedWinnerNames : [];
    const nextNames = nextArr
      .filter((x) => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean);
    for (const name of nextNames) {
      const nl = name.toLowerCase();
      if (prevLower.has(nl)) continue;
      prevLower.add(nl);
      newWinnerMarkEntries.push({
        at: markNow,
        ign: name,
        itemId: it.id,
        itemName: typeof it.name === 'string' ? it.name : '',
        itemType: typeof it.type === 'string' ? it.type : '',
      });
    }
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM item_queue');
    await conn.query('DELETE FROM auction_items');

    const idRemap = new Map();

    for (const m of body.members) {
      const cid = coerceMemberId(m.id);
      if (cid != null) {
        await conn.query(
          `INSERT INTO members (id, name, role, active) VALUES (?, ?, ?, 1)
           ON DUPLICATE KEY UPDATE name = VALUES(name), role = VALUES(role), active = 1`,
          [cid, m.name, m.role]
        );
        idRemap.set(m.id, cid);
        idRemap.set(String(m.id), cid);
      }
    }

    for (const m of body.members) {
      if (coerceMemberId(m.id) != null) continue;
      const [ins] = await conn.query(
        `INSERT INTO members (name, role, active) VALUES (?, ?, ?)`,
        [m.name, m.role, 1]
      );
      const newId = Number(ins.insertId);
      idRemap.set(m.id, newId);
      idRemap.set(String(m.id), newId);
    }

    const memberIds = new Set();

    for (const m of body.members) {
      const cid = idRemap.get(m.id) ?? idRemap.get(String(m.id));
      if (typeof cid === 'number' && !Number.isNaN(cid) && cid > 0) {
        memberIds.add(cid);
      }
    }

    for (const it of body.items) {
      const ids = Array.isArray(it.interestedMemberIds)
        ? it.interestedMemberIds
        : [];
      for (const memberId of ids) {
        const resolved = resolveQueueMemberId(memberId, idRemap);
        if (resolved != null && resolved > 0) memberIds.add(resolved);
      }
    }

    const memberIdList = [...memberIds];

    if (memberIdList.length > 0) {
      const ph = memberIdList.map(() => '?').join(',');
      await conn.query(
        `UPDATE members SET active = 0 WHERE id NOT IN (${ph})`,
        memberIdList
      );
    }

    for (const it of body.items) {
      await conn.query(
        `INSERT INTO auction_items (id, name, type, winner_pool_cap, winner_name, winner_names_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          it.id,
          it.name,
          it.type,
          it.winnerPoolCap != null && Number.isFinite(Number(it.winnerPoolCap))
            ? Math.max(0, Math.floor(Number(it.winnerPoolCap)))
            : null,
          it.winnerName ?? null,
          serializeWinnerNamesJson(it.recordedWinnerNames),
          it.status,
          Number(it.createdAt) || Date.now(),
        ]
      );
      const ids = Array.isArray(it.interestedMemberIds)
        ? it.interestedMemberIds
        : [];
      let pos = 0;
      for (const memberId of ids) {
        const resolved = resolveQueueMemberId(memberId, idRemap);
        if (resolved == null || resolved <= 0) continue;
        await conn.query(
          'INSERT INTO item_queue (item_id, member_id, position) VALUES (?, ?, ?)',
          [it.id, resolved, pos]
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

    if (Object.prototype.hasOwnProperty.call(body, 'eventMode')) {
      const nextMode = sanitizeEventName(body.eventMode);
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [EVENT_MODE_META_KEY, nextMode]
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'rewardRank')) {
      const nextRank = sanitizeRewardRank(body.rewardRank);
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [REWARD_RANK_META_KEY, nextRank]
      );
    }
    if (Object.prototype.hasOwnProperty.call(body, 'rewardItemCounts')) {
      const counts = parseRewardItemCounts(JSON.stringify(body.rewardItemCounts));
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [REWARD_ITEM_COUNTS_META_KEY, JSON.stringify(counts)]
      );
    }

    await saveWeeklyTypeWins(conn, nextWeeklyWins);

    await appendWinnerMarkLog(conn, newWinnerMarkEntries);

    const bidderStateRows = [];
    const shuffleLockNow = !prevShuffleLocked && body.shuffleLocked === true;
    if (shuffleLockNow) {
      const batchAt = Date.now();
      for (const it of body.items) {
        if (it.status !== 'active') continue;
        const poolCap = maxRecordedWinnersForItem(it.type, it.winnerPoolCap);
        const ids = Array.isArray(it.interestedMemberIds)
          ? it.interestedMemberIds
          : [];
        let idx = 0;
        for (const rawMid of ids) {
          const resolved = resolveQueueMemberId(rawMid, idRemap);
          if (resolved == null || resolved <= 0) {
            idx += 1;
            continue;
          }
          const ign =
            ignForRemappedMember(body, idRemap, resolved) || `#${resolved}`;
          const state = idx < poolCap ? 1 : 0;
          bidderStateRows.push({
            at: batchAt,
            memberId: resolved,
            ign,
            itemId: it.id,
            itemName: typeof it.name === 'string' ? it.name : '',
            itemType: typeof it.type === 'string' ? it.type : '',
            state,
            poolCap,
            queuePosition: idx,
            shuffleBatchAtMs: batchAt,
          });
          idx += 1;
        }
      }
    }
    await appendBidderStateLog(conn, bidderStateRows);

    if (Object.prototype.hasOwnProperty.call(body, 'freeDrawChosenByItemId')) {
      const raw = body.freeDrawChosenByItemId;
      const cleaned = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof k !== 'string' || !k) continue;
          const mid = resolveQueueMemberId(v, idRemap);
          if (mid != null && mid > 0) cleaned[k] = mid;
        }
      }
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [FREE_DRAW_CHOSEN_META_KEY, JSON.stringify(cleaned)]
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
