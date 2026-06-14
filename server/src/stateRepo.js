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
import {
  findEmperiumWinCooldown,
  isEmperiumCooldownItem,
  isEmperiumWinCooldownEnabled,
  pruneExpiredEmperiumWins,
} from './emperiumWinCooldown.js';
import { maxWinnersForItemInState } from './winnerPoolCaps.js';
import {
  backfillWeeklyWinsFromRecordedWinners,
  loadWeeklyTypeWins,
  rolloverWeeklyWinsIfNewWeek,
  saveWeeklyTypeWins,
  dedupeWeeklyWinsList,
} from './weeklyTypeWins.js';
import { getAuctionWeekMondayKey } from './auctionWeek.js';
import { loadWinnerMarkLog, appendWinnerMarkLog } from './winnerMarkLog.js';
import {
  loadBidderStateLog,
  appendBidderStateLog,
} from './bidderStateLog.js';
import { isAuctionItemHiddenForPublic } from './hiddenAuctionItems.js';
import { applySureWinPinsToItems } from './sureWinPin.js';

const EVENT_MODE_META_KEY = 'event_mode';
const REWARD_RANK_META_KEY = 'reward_rank';
const REWARD_ITEM_COUNTS_META_KEY = 'reward_item_counts_json';
const FREE_DRAW_CHOSEN_META_KEY = 'free_draw_chosen_by_item';
const SHUFFLE_WINNER_SLOTS_META_KEY = 'shuffle_winner_slots_by_item';

function parseShuffleWinnerSlotsByItemJson(raw) {
  if (raw == null || raw === '') return {};
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const out = {};
    for (const [k, v] of Object.entries(j)) {
      if (typeof k !== 'string' || !k) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[k] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}

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
function parseRewardItemCounts(raw, rankHint) {
  const fallback = { fragment: 2, feathers: 80, feathersItemsPerWinner: 8 };
  if (raw == null || raw === '') return fallback;
  try {
    const s = typeof raw === 'string' ? raw : String(raw);
    const j = JSON.parse(s);
    if (!j || typeof j !== 'object') return fallback;
    const toInt = (v, d) =>
      Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d;
    const fragment = toInt(j.fragment, fallback.fragment);
    const feathersTotal =
      j.feathers != null && j.feathers !== ''
        ? toInt(j.feathers, fallback.feathers)
        : toInt(j.lnd, 30) + toInt(j.tns, 50);
    const inferredRank =
      rankHint === 'Emperium overrun' || rankHint === 'Bronze'
        ? rankHint
        : feathersTotal >= 200
          ? 'Emperium overrun'
          : 'Bronze';
    const feathersItemsPerWinner = toInt(
      j.feathersItemsPerWinner,
      inferredRank === 'Emperium overrun' ? 13 : 8
    );
    let fragmentByItemId;
    if (j.fragmentByItemId && typeof j.fragmentByItemId === 'object' && !Array.isArray(j.fragmentByItemId)) {
      fragmentByItemId = {};
      for (const [id, v] of Object.entries(j.fragmentByItemId)) {
        if (!id) continue;
        fragmentByItemId[id] = toInt(v, fragment);
      }
      if (Object.keys(fragmentByItemId).length === 0) fragmentByItemId = undefined;
    }
    const base = fragmentByItemId
      ? { fragment, fragmentByItemId, feathersItemsPerWinner }
      : { fragment, feathersItemsPerWinner };
    if (j.feathers != null && j.feathers !== '') {
      return { ...base, feathers: toInt(j.feathers, fallback.feathers) };
    }
    const lnd = toInt(j.lnd, 30);
    const tns = toInt(j.tns, 50);
    return { ...base, feathers: lnd + tns };
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

function resolveQueueMemberId(raw, idRemap, existingIds = null) {
  if (idRemap.has(raw)) return idRemap.get(raw);
  const s = String(raw);
  if (idRemap.has(s)) return idRemap.get(s);
  const coerced = coerceMemberId(raw);
  if (coerced == null) return null;
  // When the caller hands us an "existing id" gate, only allow the raw id
  // through if it actually points to a live `members` row. This prevents
  // a stale dashboard PUT from inserting `item_queue` rows that would
  // violate the FK on `members(id)` (e.g. the member was just deleted).
  if (existingIds && !existingIds.has(coerced)) return null;
  return coerced;
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

/**
 * Atomically update only the event mode (Guild League / Emperium Overrun).
 * Used by the privileged Admin/Developer-gated `/api/state/event-mode`
 * endpoint, which avoids resaving the whole auction state just to flip one
 * flag. Returns the post-update full state.
 */
export async function setEventMode(pool, rawMode) {
  const nextMode = sanitizeEventName(rawMode);
  await pool.query(
    'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
    [EVENT_MODE_META_KEY, nextMode]
  );
  return getFullState(pool);
}

export async function getFullState(pool) {
  await rolloverWeeklyWinsIfNewWeek(pool);

  const [members] = await pool.query(
    'SELECT id, name, role FROM members WHERE active = 1 ORDER BY name'
  );

  const [itemRows] = await pool.query(
    `SELECT id, name, type, winner_pool_cap AS winnerPoolCap, winner_name AS winnerName, winner_names_json AS winnerNamesJson, revoked_winner_names_json AS revokedWinnerNamesJson, status, created_at AS createdAt
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
    const revoked = parseWinnerNamesJson(r.revokedWinnerNamesJson);
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
      ...(revoked.length > 0 ? { revokedWinnerNames: revoked } : {}),
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

  const [eventRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [EVENT_MODE_META_KEY]
  );
  const eventMode = parseEventMode(eventRows[0]?.value);

  let weeklyTypeWins = pruneExpiredEmperiumWins(await loadWeeklyTypeWins(pool));
  if (isEmperiumWinCooldownEnabled(eventMode)) {
    weeklyTypeWins = await backfillWeeklyWinsFromRecordedWinners(
      pool,
      items,
      weeklyTypeWins
    );
    weeklyTypeWins = pruneExpiredEmperiumWins(weeklyTypeWins);
  } else {
    weeklyTypeWins = [];
  }
  const winnerMarkLog = await loadWinnerMarkLog(pool);
  const bidderStateLog = await loadBidderStateLog(pool);
  const [rankRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [REWARD_RANK_META_KEY]
  );
  const rewardRank = parseRewardRank(rankRows[0]?.value);
  const [countRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [REWARD_ITEM_COUNTS_META_KEY]
  );
  const rewardItemCounts = parseRewardItemCounts(countRows[0]?.value, rewardRank);

  const [freeDrawMeta] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [FREE_DRAW_CHOSEN_META_KEY]
  );
  const freeDrawChosenByItemId = parseFreeDrawChosenByItemJson(freeDrawMeta[0]?.value);

  const [shuffleSlotsMeta] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [SHUFFLE_WINNER_SLOTS_META_KEY]
  );
  let shuffleWinnerSlotsByItemId = parseShuffleWinnerSlotsByItemJson(
    shuffleSlotsMeta[0]?.value
  );
  if (
    shuffleLocked &&
    Object.keys(shuffleWinnerSlotsByItemId).length === 0 &&
    Array.isArray(bidderStateLog) &&
    bidderStateLog.length > 0
  ) {
    for (const row of bidderStateLog) {
      if (!row || row.state !== 1 || !row.itemId) continue;
      const cap =
        row.poolCap != null && Number.isFinite(Number(row.poolCap))
          ? Math.max(0, Math.floor(Number(row.poolCap)))
          : 0;
      if (cap <= 0) continue;
      if (shuffleWinnerSlotsByItemId[row.itemId] == null) {
        shuffleWinnerSlotsByItemId[row.itemId] = cap;
      }
    }
  }

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
    ...(Object.keys(shuffleWinnerSlotsByItemId).length > 0
      ? { shuffleWinnerSlotsByItemId }
      : {}),
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

  // Block names that collide with a pending or rejected public registration.
  // We never want the anonymous queue flow to silently bypass admin approval
  // by auto-creating a parallel row, or to reactivate a rejected account.
  const [reserved] = await conn.query(
    `SELECT id, approval_status FROM members
     WHERE LOWER(TRIM(name)) = ?
       AND approval_status IN ('pending', 'rejected')
     ORDER BY id ASC LIMIT 1`,
    [name.toLowerCase()]
  );
  if (Array.isArray(reserved) && reserved.length > 0) {
    const status = String(reserved[0].approval_status ?? '');
    if (status === 'pending') {
      throw clientError(
        403,
        'This IGN has a pending registration. An admin must approve it before bidding.',
        { code: 'registration_pending' }
      );
    }
    throw clientError(
      403,
      'This IGN was rejected by an admin and cannot be used for bidding.',
      { code: 'registration_rejected' }
    );
  }

  const ignLower = name.toLowerCase();
  const [inactive] = await conn.query(
    `SELECT id FROM members
     WHERE active = 0
       AND approval_status = 'approved'
       AND LOWER(TRIM(name)) = ?
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
    `INSERT INTO members (name, role, active, approval_status) VALUES (?, ?, 1, 'approved')`,
    [name, 'Member']
  );
  const newId = Number(ins.insertId);
  await conn.query(
    `UPDATE members SET password = ? WHERE id = ? AND (password IS NULL OR password = '')`,
    [String(newId), newId]
  );
  return newId;
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
  const eventMode = state.eventMode ?? defaultEventMode();

  if (shuffleLockClosesPublicSignup(state.shuffleLocked === true, eventMode)) {
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

  if (isAuctionItemHiddenForPublic(card, eventMode)) {
    throw clientError(404, 'Item not found', { code: 'item_hidden' });
  }

  const matchedOnCard = matchingIgnOnQueueItem(card, state.members, raw);
  if (matchedOnCard) {
    throw clientError(400, 'Already in this queue', {
      code: 'already_listed',
      extra: { itemName: card.name, matchedIgn: matchedOnCard },
    });
  }

  const cooldown = findEmperiumWinCooldown(
    eventMode,
    card,
    state.weeklyTypeWins,
    raw
  );
  if (cooldown) {
    throw clientError(400, 'Winner cooldown active (skip next Emperium Sunday)', {
      code: 'emperium_win_cooldown',
      extra: {
        itemName: card.name,
        expiresAt: cooldown.expiresAt,
      },
    });
  }

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

/** Rewrite ordered `item_queue` rows for one auction item. */
async function rewriteItemQueueRows(conn, itemId, memberIds) {
  await conn.query('DELETE FROM item_queue WHERE item_id = ?', [itemId]);
  let pos = 0;
  for (const rawMid of memberIds) {
    const mid =
      typeof rawMid === 'number' && Number.isInteger(rawMid)
        ? rawMid
        : parseInt(String(rawMid ?? '').trim(), 10);
    if (!Number.isInteger(mid) || mid <= 0) continue;
    await conn.query(
      'INSERT INTO item_queue (item_id, member_id, position) VALUES (?, ?, ?)',
      [itemId, mid, pos]
    );
    pos += 1;
  }
}

/**
 * Apply a queue drag-and-drop move in memory (mirrors client `applyQueueMemberMove`).
 * @returns {object | { error: string, toItemName?: string, expiresAt?: number }}
 */
function applyQueueMemberMoveInMemory(state, p) {
  const { fromItemId, toItemId, memberId, insertBeforeMemberId } = p;

  const member = state.members.find((m) => m.id === memberId);
  if (!member) return { error: 'not_found' };

  const fromItem = state.items.find((i) => i.id === fromItemId);
  const toItem = state.items.find((i) => i.id === toItemId);
  if (!fromItem || !toItem || toItem.status !== 'active') {
    return { error: 'not_found' };
  }
  if (!fromItem.interestedMemberIds.includes(memberId)) {
    return { error: 'no_change' };
  }

  const fromList = fromItem.interestedMemberIds.filter((id) => id !== memberId);
  const toListBase =
    fromItemId === toItemId ? fromList : [...toItem.interestedMemberIds];

  const nameTakenOnTarget = toListBase.some((id) => {
    if (id === memberId) return false;
    const n = state.members.find((m) => m.id === id)?.name;
    return n != null && ignMatchesForQueueIdentity(n, member.name);
  });
  if (nameTakenOnTarget) {
    return { error: 'name_conflict', toItemName: toItem.name };
  }

  if (fromItemId !== toItemId && toListBase.includes(memberId)) {
    return { error: 'no_change' };
  }

  if (fromItemId !== toItemId) {
    const eventMode = state.eventMode ?? defaultEventMode();
    const cooldown = findEmperiumWinCooldown(
      eventMode,
      toItem,
      state.weeklyTypeWins,
      member.name
    );
    if (cooldown) {
      return {
        error: 'emperium_win_cooldown',
        toItemName: toItem.name,
        expiresAt: cooldown.expiresAt,
      };
    }

    const itemsSim = state.items.map((it) => {
      if (it.id === fromItemId) {
        return {
          ...it,
          interestedMemberIds: it.interestedMemberIds.filter((id) => id !== memberId),
        };
      }
      if (it.id === toItemId) {
        const without = it.interestedMemberIds.filter((id) => id !== memberId);
        return {
          ...it,
          interestedMemberIds: without.includes(memberId)
            ? without
            : [...without, memberId],
        };
      }
      return it;
    });
    const otherBlock = findOtherActiveQueueBlockingWithMatch(
      eventMode,
      itemsSim,
      state.members,
      member.name,
      toItemId,
      toItem.type
    );
    if (otherBlock) {
      return { error: 'name_conflict', toItemName: otherBlock.item.name };
    }
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
      ...state,
      items: state.items.map((it) =>
        it.id === fromItemId ? { ...it, interestedMemberIds: toList } : it
      ),
    };
  }

  return {
    ...state,
    items: state.items.map((it) => {
      if (it.id === fromItemId) return { ...it, interestedMemberIds: fromList };
      if (it.id === toItemId) return { ...it, interestedMemberIds: toList };
      return it;
    }),
  };
}

/**
 * Public: reorder or move a queued bidder between cards (queue rows only).
 * Avoids full `/api/state` PUT so client-side winner-limit normalization
 * cannot trip the Officer/Admin/Developer gate.
 */
export async function publicMoveQueueMember(pool, body) {
  const fromItemId =
    typeof body?.fromItemId === 'string' ? body.fromItemId.trim() : '';
  const toItemId =
    typeof body?.toItemId === 'string' ? body.toItemId.trim() : '';
  const memberId = parseInt(String(body?.memberId ?? '').trim(), 10);
  let insertBeforeMemberId = body?.insertBeforeMemberId;
  if (insertBeforeMemberId != null && insertBeforeMemberId !== '') {
    insertBeforeMemberId = parseInt(String(insertBeforeMemberId).trim(), 10);
    if (!Number.isInteger(insertBeforeMemberId) || insertBeforeMemberId <= 0) {
      insertBeforeMemberId = null;
    }
  } else {
    insertBeforeMemberId = null;
  }

  if (!fromItemId || !toItemId) {
    throw clientError(400, 'Source and target items are required');
  }
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw clientError(400, 'Invalid member id');
  }

  const state = await getFullState(pool);
  const moved = applyQueueMemberMoveInMemory(state, {
    fromItemId,
    toItemId,
    memberId,
    insertBeforeMemberId,
  });

  if ('error' in moved) {
    if (moved.error === 'not_found') {
      throw clientError(404, 'Queue entry not found');
    }
    if (moved.error === 'no_change') {
      return state;
    }
    if (moved.error === 'name_conflict') {
      throw clientError(400, 'Already on another item', {
        code: 'name_conflict',
        extra: { itemName: moved.toItemName ?? '' },
      });
    }
    if (moved.error === 'emperium_win_cooldown') {
      throw clientError(400, 'Winner cooldown active (skip next Emperium Sunday)', {
        code: 'emperium_win_cooldown',
        extra: {
          itemName: moved.toItemName ?? '',
          expiresAt: moved.expiresAt,
        },
      });
    }
    throw clientError(400, 'Could not move bid');
  }

  const affectedItemIds =
    fromItemId === toItemId ? [fromItemId] : [fromItemId, toItemId];

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    for (const itemId of affectedItemIds) {
      const item = moved.items.find((it) => it.id === itemId);
      if (!item) continue;
      await rewriteItemQueueRows(conn, itemId, item.interestedMemberIds);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
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

/**
 * Bulk-clear `item_queue` for every currently-active auction item.
 * Mirrors the "Clear all lists" admin button — destructive, hence gated to
 * Admin/Developer at the API layer.
 */
export async function clearAllActiveQueues(pool) {
  await pool.query(`
    DELETE iq FROM item_queue iq
    INNER JOIN auction_items ai ON ai.id = iq.item_id
    WHERE ai.status = 'active'
  `);
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

  if (!prevShuffleLocked && body.shuffleLocked === true) {
    applySureWinPinsToItems(body.items);
  }

  const [oldItemRows] = await pool.query(
    `SELECT id, name, type, status, winner_name AS winnerName, winner_names_json AS winnerNamesJson, revoked_winner_names_json AS revokedWinnerNamesJson FROM auction_items`
  );

  const [oldQueueRows] = await pool.query(
    'SELECT item_id AS itemId, member_id AS memberId FROM item_queue'
  );
  const oldQueueByItem = new Map();
  for (const q of oldQueueRows) {
    const itemId = q.itemId;
    if (!oldQueueByItem.has(itemId)) oldQueueByItem.set(itemId, new Set());
    oldQueueByItem.get(itemId).add(Number(q.memberId));
  }

  const [eventMetaRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [EVENT_MODE_META_KEY]
  );
  const saveEventMode = Object.prototype.hasOwnProperty.call(body, 'eventMode')
    ? sanitizeEventName(body.eventMode)
    : parseEventMode(eventMetaRows[0]?.value);

  const [shuffleSlotsMetaRows] = await pool.query(
    'SELECT value FROM app_meta WHERE `key` = ? LIMIT 1',
    [SHUFFLE_WINNER_SLOTS_META_KEY]
  );
  const shuffleWinnerSlotsByItemId = parseShuffleWinnerSlotsByItemJson(
    shuffleSlotsMetaRows[0]?.value
  );

  const membersByIdForValidation = new Map();
  for (const m of body.members) {
    const mid = coerceMemberId(m?.id);
    if (mid != null && mid > 0) membersByIdForValidation.set(mid, m);
  }

  for (const it of body.items) {
    const cap = maxWinnersForItemInState(it, body);
    const drawSlots =
      shuffleWinnerSlotsByItemId[it.id] != null
        ? shuffleWinnerSlotsByItemId[it.id]
        : prevShuffleLocked && body.shuffleLocked !== false
          ? cap
          : 0;
    const ids = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    const revokedLower = new Set(
      (Array.isArray(it.revokedWinnerNames) ? it.revokedWinnerNames : [])
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean)
    );
    let activeShuffle = 0;
    for (let i = 0; i < drawSlots && i < ids.length; i += 1) {
      const mid = coerceMemberId(ids[i]);
      const member = mid != null ? membersByIdForValidation.get(mid) : null;
      const nl = member?.name ? String(member.name).trim().toLowerCase() : '';
      if (nl && !revokedLower.has(nl)) activeShuffle += 1;
    }
    const rec = Array.isArray(it.recordedWinnerNames) ? it.recordedWinnerNames : [];
    let extraCount = 0;
    for (const name of rec) {
      if (typeof name !== 'string') continue;
      const nl = name.trim().toLowerCase();
      if (!nl) continue;
      let qIdx = -1;
      for (let i = 0; i < ids.length; i++) {
        const mid = coerceMemberId(ids[i]);
        const member = mid != null ? membersByIdForValidation.get(mid) : null;
        if (member?.name && String(member.name).trim().toLowerCase() === nl) {
          qIdx = i;
          break;
        }
      }
      if (qIdx < 0 || qIdx >= drawSlots) extraCount += 1;
    }
    if (activeShuffle + extraCount > cap) {
      const err = new Error(
        `Too many winners on "${it.name}" (${it.type}): max ${cap} total (${activeShuffle} shuffle + ${extraCount} added)`
      );
      err.statusCode = 400;
      throw err;
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

  /** Emperium Overrun only: 1-week (skip next Sunday) Puppet CD. Feathers = no CD. Guild League = no CD entries. */
  let nextWeeklyWins = pruneExpiredEmperiumWins(await loadWeeklyTypeWins(pool));
  if (isEmperiumWinCooldownEnabled(saveEventMode)) {
    nextWeeklyWins = await backfillWeeklyWinsFromRecordedWinners(
      pool,
      body.items,
      nextWeeklyWins
    );
    for (const entry of newWinnerMarkEntries) {
      const card = body.items.find((i) => i.id === entry.itemId);
      if (!card || !isEmperiumCooldownItem(card)) continue;
      const ign = String(entry.ign ?? '').trim().toLowerCase();
      if (!ign) continue;
      const k = `${ign}\0${entry.itemType}\0${entry.itemId ?? ''}`;
      const exists = nextWeeklyWins.some(
        (w) =>
          `${w.ign}\0${w.t}\0${w.itemId ?? ''}` === k &&
          typeof w.at === 'number' &&
          w.at > 0
      );
      if (exists) continue;
      nextWeeklyWins.push({
        ign,
        t: entry.itemType,
        itemId: entry.itemId,
        at: entry.at ?? markNow,
      });
    }

    for (const it of body.items) {
      const row = prevByItemId.get(it.id) ?? prevByItemId.get(String(it.id));
      const prevNames = parseWinnerNamesJson(row?.winnerNamesJson);
      const nextArr = Array.isArray(it.recordedWinnerNames)
        ? it.recordedWinnerNames
        : [];
      const nextLower = new Set(
        nextArr
          .filter((x) => typeof x === 'string')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      );
      for (const prevName of prevNames) {
        const nl = String(prevName).trim().toLowerCase();
        if (!nl || nextLower.has(nl)) continue;
        if (!isEmperiumCooldownItem(it)) continue;
        nextWeeklyWins = nextWeeklyWins.filter(
          (w) =>
            !(
              w.ign === nl &&
              w.t === it.type &&
              (w.itemId == null || w.itemId === it.id)
            )
        );
      }
    }

    for (const it of body.items) {
      const row = prevByItemId.get(it.id) ?? prevByItemId.get(String(it.id));
      const prevRevoked = parseWinnerNamesJson(row?.revokedWinnerNamesJson);
      const prevRevokedLower = new Set(
        prevRevoked.map((p) => String(p).trim().toLowerCase()).filter(Boolean)
      );
      const nextRevoked = Array.isArray(it.revokedWinnerNames)
        ? it.revokedWinnerNames
        : [];
      for (const name of nextRevoked) {
        if (typeof name !== 'string') continue;
        const nl = name.trim().toLowerCase();
        if (!nl || prevRevokedLower.has(nl)) continue;
        if (!isEmperiumCooldownItem(it)) continue;
        nextWeeklyWins = nextWeeklyWins.filter(
          (w) =>
            !(
              w.ign === nl &&
              w.t === it.type &&
              (w.itemId == null || w.itemId === it.id)
            )
        );
      }
      const nextRevokedLower = new Set(
        nextRevoked
          .filter((x) => typeof x === 'string')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean)
      );
      for (const prevName of prevRevoked) {
        const nl = String(prevName).trim().toLowerCase();
        if (!nl || nextRevokedLower.has(nl)) continue;
        if (!isEmperiumCooldownItem(it)) continue;
        const k = `${nl}\0${it.type}\0${it.id ?? ''}`;
        const exists = nextWeeklyWins.some(
          (w) =>
            `${w.ign}\0${w.t}\0${w.itemId ?? ''}` === k &&
            typeof w.at === 'number' &&
            w.at > 0
        );
        if (exists) continue;
        nextWeeklyWins.push({
          ign: nl,
          t: it.type,
          itemId: it.id,
          at: markNow,
        });
      }
    }
  }
  nextWeeklyWins = pruneExpiredEmperiumWins(dedupeWeeklyWinsList(nextWeeklyWins));

  const membersById = new Map();
  for (const m of body.members) {
    const mid = coerceMemberId(m?.id);
    if (mid != null && mid > 0 && typeof m?.name === 'string') {
      membersById.set(mid, m);
    }
  }
  for (const it of body.items) {
    if (it.status !== 'active') continue;
    const oldSet = oldQueueByItem.get(it.id) ?? new Set();
    const newIds = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
    for (const rawMid of newIds) {
      const mid = coerceMemberId(rawMid);
      if (mid == null || mid <= 0 || oldSet.has(mid)) continue;
      const member = membersById.get(mid);
      const ign = member?.name;
      if (!ign) continue;
      const cooldown = findEmperiumWinCooldown(
        saveEventMode,
        it,
        nextWeeklyWins,
        ign
      );
      if (cooldown) {
        throw clientError(400, 'Winner cooldown active (skip next Emperium Sunday)', {
          code: 'emperium_win_cooldown',
          extra: {
            itemName: typeof it.name === 'string' ? it.name : '',
            expiresAt: cooldown.expiresAt,
          },
        });
      }
    }
  }

  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM item_queue');
    await conn.query('DELETE FROM auction_items');

    const idRemap = new Map();

    // Existing members in DB keyed by id. We only ever UPDATE pre-existing
    // rows from a dashboard state PUT. We never INSERT a missing id because
    // membership lifecycle (create / hard-delete / soft-delete / reactivate)
    // is owned by the Bidder Registration endpoints. Resurrecting a deleted
    // row here used to leak empty-password rows and silently bring back
    // members that an admin had just removed.
    const [existingRows] = await conn.query(
      `SELECT id, name, role, active FROM members`
    );
    const existingById = new Map(
      (Array.isArray(existingRows) ? existingRows : []).map((r) => [
        Number(r.id),
        r,
      ])
    );

    for (const m of body.members) {
      const cid = coerceMemberId(m.id);
      if (cid == null) continue;
      const existing = existingById.get(cid);
      if (!existing) {
        // Row was hard-deleted server-side. Do NOT resurrect from a stale
        // dashboard state body. Skip silently — the next poll on the client
        // will drop this stale member.
        continue;
      }
      const nextName = String(m.name ?? existing.name);
      const nextRole = String(m.role ?? existing.role);
      const namesDiffer = existing.name !== nextName;
      const rolesDiffer = existing.role !== nextRole;
      if (namesDiffer || rolesDiffer) {
        await conn.query(
          `UPDATE members SET name = ?, role = ? WHERE id = ?`,
          [nextName, nextRole, cid]
        );
      }
      // Note: we intentionally never flip `active` here. Soft-delete /
      // reactivation must go through dedicated endpoints.
      idRemap.set(m.id, cid);
      idRemap.set(String(m.id), cid);
    }

    for (const m of body.members) {
      if (coerceMemberId(m.id) != null) continue;
      const [ins] = await conn.query(
        `INSERT INTO members (name, role, active) VALUES (?, ?, ?)`,
        [m.name, m.role, 1]
      );
      const newId = Number(ins.insertId);
      // Default bidder password to the assigned numeric id (Bidder Registration page).
      await conn.query(
        `UPDATE members SET password = ? WHERE id = ? AND (password IS NULL OR password = '')`,
        [String(newId), newId]
      );
      idRemap.set(m.id, newId);
      idRemap.set(String(m.id), newId);
    }

    // Build the "currently-live id" gate so queue inserts can never reference
    // a member row that doesn't exist. This includes both rows that already
    // existed in DB (existingById) and rows we just inserted via the
    // "members without an explicit id" branch above (idRemap entries).
    const existingMemberIds = new Set(existingById.keys());
    for (const v of idRemap.values()) {
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        existingMemberIds.add(v);
      }
    }

    // NOTE: we intentionally do NOT auto-deactivate members that are missing
    // from `body.members`. Deactivation is owned by the dedicated bidder
    // endpoints (`DELETE /api/bidders/:id` for hard-delete and
    // `DELETE /api/state/members/:id` for soft-delete). A stale dashboard PUT
    // used to silently flip `active=0` for any member it had not yet seen
    // (e.g. an admin just created from the Bidders tab) — that race is gone.

    for (const it of body.items) {
      await conn.query(
        `INSERT INTO auction_items (id, name, type, winner_pool_cap, winner_name, winner_names_json, revoked_winner_names_json, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          it.id,
          it.name,
          it.type,
          it.winnerPoolCap != null && Number.isFinite(Number(it.winnerPoolCap))
            ? Math.max(0, Math.floor(Number(it.winnerPoolCap)))
            : null,
          it.winnerName ?? null,
          serializeWinnerNamesJson(it.recordedWinnerNames),
          serializeWinnerNamesJson(it.revokedWinnerNames),
          it.status,
          Number(it.createdAt) || Date.now(),
        ]
      );
      const ids = Array.isArray(it.interestedMemberIds)
        ? it.interestedMemberIds
        : [];
      let pos = 0;
      for (const memberId of ids) {
        const resolved = resolveQueueMemberId(memberId, idRemap, existingMemberIds);
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
      const counts = parseRewardItemCounts(
        JSON.stringify(body.rewardItemCounts),
        body.rewardRank
      );
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [REWARD_ITEM_COUNTS_META_KEY, JSON.stringify(counts)]
      );
    }

    const shuffleLockNow = !prevShuffleLocked && body.shuffleLocked === true;
    const shuffleEventMode = Object.prototype.hasOwnProperty.call(body, 'eventMode')
      ? sanitizeEventName(body.eventMode)
      : saveEventMode;

    /** Puppet shortlist at shuffle lock → weekly_type_wins (1-week CD). Feathers excluded. */
    if (shuffleLockNow && isEmperiumWinCooldownEnabled(saveEventMode)) {
      const batchAt = Date.now();
      for (const it of body.items) {
        if (it.status !== 'active') continue;
        if (isAuctionItemHiddenForPublic(it, shuffleEventMode)) continue;
        if (!isEmperiumCooldownItem(it)) continue;
        const poolCap = maxWinnersForItemInState(it, body);
        const ids = Array.isArray(it.interestedMemberIds) ? it.interestedMemberIds : [];
        let idx = 0;
        for (const rawMid of ids) {
          const resolved = resolveQueueMemberId(rawMid, idRemap, existingMemberIds);
          if (resolved == null || resolved <= 0) {
            idx += 1;
            continue;
          }
          if (idx < poolCap) {
            const ignRaw = ignForRemappedMember(body, idRemap, resolved);
            const ign = ignRaw ? String(ignRaw).trim().toLowerCase() : '';
            if (ign) {
              const k = `${ign}\0${it.type}\0${it.id ?? ''}`;
              const exists = nextWeeklyWins.some(
                (w) =>
                  `${w.ign}\0${w.t}\0${w.itemId ?? ''}` === k &&
                  typeof w.at === 'number' &&
                  w.at > 0
              );
              if (!exists) {
                nextWeeklyWins.push({
                  ign,
                  t: it.type,
                  itemId: it.id,
                  at: batchAt,
                });
              }
            }
          }
          idx += 1;
        }
      }
      nextWeeklyWins = pruneExpiredEmperiumWins(dedupeWeeklyWinsList(nextWeeklyWins));
    }

    await saveWeeklyTypeWins(conn, nextWeeklyWins);

    await appendWinnerMarkLog(conn, newWinnerMarkEntries);

    const bidderStateRows = [];
    if (shuffleLockNow) {
      const batchAt = Date.now();
      for (const it of body.items) {
        if (it.status !== 'active') continue;
        if (isAuctionItemHiddenForPublic(it, shuffleEventMode)) continue;
        const poolCap = maxWinnersForItemInState(it, body);
        const ids = Array.isArray(it.interestedMemberIds)
          ? it.interestedMemberIds
          : [];
        let idx = 0;
        for (const rawMid of ids) {
          const resolved = resolveQueueMemberId(rawMid, idRemap, existingMemberIds);
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
          const mid = resolveQueueMemberId(v, idRemap, existingMemberIds);
          if (mid != null && mid > 0) cleaned[k] = mid;
        }
      }
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [FREE_DRAW_CHOSEN_META_KEY, JSON.stringify(cleaned)]
      );
    }

    if (shuffleLockNow) {
      const slots = {};
      for (const it of body.items) {
        if (it.status !== 'active') continue;
        if (isAuctionItemHiddenForPublic(it, shuffleEventMode)) continue;
        slots[it.id] = maxWinnersForItemInState(it, body);
      }
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [SHUFFLE_WINNER_SLOTS_META_KEY, JSON.stringify(slots)]
      );
    } else if (body.shuffleLocked === false) {
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [SHUFFLE_WINNER_SLOTS_META_KEY, '{}']
      );
    } else if (Object.prototype.hasOwnProperty.call(body, 'shuffleWinnerSlotsByItemId')) {
      const raw = body.shuffleWinnerSlotsByItemId;
      const cleaned = {};
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        for (const [k, v] of Object.entries(raw)) {
          if (typeof k !== 'string' || !k) continue;
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0) cleaned[k] = Math.floor(n);
        }
      }
      await conn.query(
        'INSERT INTO app_meta (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)',
        [SHUFFLE_WINNER_SLOTS_META_KEY, JSON.stringify(cleaned)]
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
