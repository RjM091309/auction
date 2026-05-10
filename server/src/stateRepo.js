import { DATA_VERSION } from './defaults.js';
import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';
import { findOtherActiveQueueBlocking, stripEmperiumCardQueuesAfterFragmentWeeklyWin } from './queueEligibility.js';
import { maxRecordedWinnersForItem } from './winnerPoolCaps.js';
import {
  rolloverWeeklyWinsIfNewWeek,
  loadWeeklyTypeWins,
  saveWeeklyTypeWins,
  memberHasTypeWinThisWeek,
  applyWeeklyWinnerDiff,
  mergeCompletedItemWinsInto,
  mergeRecordedWinnerNamesInto,
  normalizeIgn,
} from './weeklyTypeWins.js';
import { getAuctionWeekMondayKey } from './auctionWeek.js';
import { loadWinnerMarkLog, appendWinnerMarkLog } from './winnerMarkLog.js';
import {
  loadBidderStateLog,
  appendBidderStateLog,
} from './bidderStateLog.js';

const EVENT_MODE_META_KEY = 'event_mode';
const REWARD_RANK_META_KEY = 'reward_rank';
const REWARD_ITEM_COUNTS_META_KEY = 'reward_item_counts_json';

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
  const fallback = { fragment: 2, lnd: 30, tns: 50 };
  if (raw == null || raw === '') return fallback;
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object') return fallback;
    const toInt = (v, d) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d;
    return {
      fragment: toInt(j.fragment, fallback.fragment),
      lnd: toInt(j.lnd, fallback.lnd),
      tns: toInt(j.tns, fallback.tns),
    };
  } catch {
    return fallback;
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

function resolveMemberIdFromIgn(body, idRemap, ign) {
  const t = normalizeIgn(ign);
  for (const m of body.members) {
    if (normalizeIgn(m.name) === t) {
      const r = idRemap.get(m.id) ?? idRemap.get(String(m.id));
      if (typeof r === 'number' && r > 0 && !Number.isNaN(r)) return r;
    }
  }
  return null;
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

  const weeklyTypeWins = await loadWeeklyTypeWins(pool);
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
  });
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
  const weeklyWins = await loadWeeklyTypeWins(pool);

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

  if (isAuctionItemHiddenForPublic(card)) {
    throw clientError(404, 'Item not found', { code: 'item_hidden' });
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

  const eventMode = state.eventMode ?? defaultEventMode();
  const otherCard = findOtherActiveQueueBlocking(
    eventMode,
    state.items,
    state.members,
    ignLower,
    tid,
    card.type
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
  const mid = existing?.id ?? 0;

  if (memberHasTypeWinThisWeek(weeklyWins, ignLower, card.type)) {
    const emperium = parseEventMode(state.eventMode) === 'Emperium Overrun';
    const msg =
      emperium && card.type === 'Fragment Card'
        ? 'You already won Fragment Card this week (card round). You can only join LND or TNS queues until Monday.'
        : `You already won ${card.type} this week (marked with the green check). Losers can bid again; winners cannot until Monday.`;
    throw clientError(400, msg, {
      code: 'already_won_type_this_week',
      extra: { itemName: card.name },
    });
  }

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
    winnerShortlistUiEnabled: state.winnerShortlistUiEnabled === true,
    shuffleLocked: state.shuffleLocked === true,
    eventMode: state.eventMode ?? defaultEventMode(),
    rewardRank: state.rewardRank ?? defaultRewardRank(),
    rewardItemCounts: state.rewardItemCounts ?? { fragment: 2, lnd: 30, tns: 50 },
  });

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
  const wins = await loadWeeklyTypeWins(pool);
  const oldItems = oldItemRows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    winnerName: r.winnerName,
  }));
  let nextWeeklyWins = applyWeeklyWinnerDiff(oldItems, body.items, wins);
  nextWeeklyWins = mergeCompletedItemWinsInto(body.items, nextWeeklyWins);
  nextWeeklyWins = mergeRecordedWinnerNamesInto(body.items, nextWeeklyWins);

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

  for (const it of body.items) {
    if (it.status !== 'active') continue;
    const ids = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    for (const memberId of ids) {
      if (memberId == null || memberId === '') continue;
      const m = body.members.find(
        (x) => String(x.id) === String(memberId)
      );
      const ignN = normalizeIgn(m?.name ?? '');
      if (memberHasTypeWinThisWeek(nextWeeklyWins, ignN, it.type)) {
        const label = m?.name ?? memberId;
        const err = new Error(
          `Cannot save: "${label}" already won ${it.type} this week (green check). Clears Monday.`
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
    const row = prevByItemId.get(it.id);
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

    const memberIds = [
      ...new Set(
        body.members
          .map((m) => idRemap.get(m.id) ?? idRemap.get(String(m.id)))
          .filter((x) => typeof x === 'number' && !Number.isNaN(x) && x > 0)
      ),
    ];

    if (memberIds.length > 0) {
      const ph = memberIds.map(() => '?').join(',');
      await conn.query(
        `UPDATE members SET active = 0 WHERE id NOT IN (${ph})`,
        memberIds
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
    if (!prevShuffleLocked && body.shuffleLocked === true) {
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
          bidderStateRows.push({
            at: batchAt,
            memberId: resolved,
            ign,
            itemId: it.id,
            itemName: typeof it.name === 'string' ? it.name : '',
            itemType: typeof it.type === 'string' ? it.type : '',
            state: idx < poolCap ? 2 : 0,
            poolCap,
            queuePosition: idx,
            shuffleBatchAtMs: batchAt,
          });
          idx += 1;
        }
      }
    }
    for (const e of newWinnerMarkEntries) {
      bidderStateRows.push({
        at: e.at,
        memberId: resolveMemberIdFromIgn(body, idRemap, e.ign),
        ign: e.ign,
        itemId: e.itemId,
        itemName: e.itemName,
        itemType: e.itemType,
        state: 1,
        poolCap: null,
        queuePosition: null,
        shuffleBatchAtMs: null,
      });
    }
    await appendBidderStateLog(conn, bidderStateRows);

    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
