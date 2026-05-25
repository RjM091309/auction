import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import {
  createPool,
  initSchema,
  migrateMembersActiveColumn,
  migrateMembersOfficerRole,
  migrateMembersPasswordColumn,
  migrateAuctionWinnerNamesJson,
  migrateAuctionWinnerPoolCapColumn,
  migrateWinnerMarkLogTable,
  migrateBidderStateLogTable,
  migrateMembersIntPk,
  migrateOverrunRewardsRunsTable,
  migrateDefaultAuctionItems,
  migrateIllusionFragCardDisplayOrder,
  seedIfEmpty,
  verifyMysqlConnection,
} from './db.js';
import {
  getFullState,
  replaceFullState,
  deactivateMember,
  removeMemberFromItemQueue,
  publicAddBidToQueue,
  setEventMode,
  clearAllActiveQueues,
} from './stateRepo.js';
import {
  handleLogin,
  handleLogout,
  handleMe,
  requireAuth,
} from './auth.js';
import { clientIp, describeAdminStatePut } from './auditLog.js';
import {
  listBidders,
  createBidder,
  updateBidder,
  deleteBidder,
  authBidder,
  signOutActor,
  listEligibleActors,
  getFreshActor,
  listActiveMembers,
  verifyMemberCredentials,
  publicRegisterMember,
  publicCheckIgnAvailability,
} from './bidders.js';
import {
  defaultOverrunRewardsConfig,
  loadOverrunRewardsConfig,
  loadOverrunRanking,
  saveOverrunRewardsConfig,
  saveOverrunRanking,
  runOverrunRewards,
} from './overrunRewards.js';
import { getOverrunSundayKey } from './overrunWeek.js';
import { getAuctionWeekTimezone } from './auctionWeek.js';

const PORT = Number(process.env.PORT ?? 3333);

const app = express();

/** Hardening (clickjacking, MIME sniffing). Hindi nito pinipigilan ang DevTools — imposible iyon sa browser ng user. */
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const pool = createPool();

app.post('/api/auth/login', handleLogin);
app.post('/api/auth/logout', handleLogout);
app.get('/api/auth/me', handleMe);

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'mysql' });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message) });
  }
});

/** Public read — bid board at `/`. Writes still require auth. */
app.get('/api/state', async (_req, res) => {
  try {
    const state = await getFullState(pool);
    res.json(state);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/**
 * Self-service "Join queue" support endpoints. These are exposed to the
 * authenticated dashboard (requireAuth) but accept ANY active member (not
 * just privileged roles) — every guild member must be able to add themselves
 * to a queue after proving their identity.
 */
app.get('/api/members/active', requireAuth, async (_req, res) => {
  try {
    const members = await listActiveMembers(pool);
    res.json({ members });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.post('/api/members/verify', requireAuth, async (req, res) => {
  try {
    const actor = await verifyMemberCredentials(pool, req.body, {
      ip: clientIp(req),
    });
    console.log(
      `[audit] member-verify ok id=${actor.id} name="${actor.name}" role=${actor.role} ip=${clientIp(req)}`
    );
    res.json({ actor });
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

/**
 * Public: live IGN availability check for the `/registration` form. No auth
 * required. Returns `{ ign, available, reason? }` and is cheap enough to
 * call on every keystroke (server still validates length / format).
 */
app.get('/api/public/registration/check', async (req, res) => {
  try {
    const ign =
      typeof req.query?.ign === 'string' ? req.query.ign : '';
    const out = await publicCheckIgnAvailability(pool, ign);
    res.json(out);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

/**
 * Public: create a new `Member`-role account from the `/registration` page.
 * No auth required, but the endpoint:
 *   • forces role = 'Member' (privileged roles must be created by an admin)
 *   • rejects duplicate IGNs (case-insensitive) inside a transaction
 *   • per-IP rate-limited so the endpoint can't be spammed
 */
app.post('/api/public/register', async (req, res) => {
  try {
    const created = await publicRegisterMember(pool, req.body, {
      ip: clientIp(req),
    });
    console.log(
      `[audit] register: public ign="${created.name}" id=${created.id} ip=${clientIp(req)}`
    );
    res.status(201).json({ ok: true, member: created });
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

/** Public: add character name to one active queue (no edit/delete elsewhere). */
app.post('/api/public/queue/add', async (req, res) => {
  try {
    const state = await publicAddBidToQueue(pool, req.body);
    const ign =
      typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const itemId =
      typeof req.body?.itemId === 'string' ? req.body.itemId.trim() : '';
    console.log(
      `[audit] add: public queue ign="${ign}" item=${itemId} ip=${clientIp(req)}`
    );
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    const payload = { error: String(e.message ?? 'Error') };
    if (e.code) payload.code = e.code;
    if (e.extra) payload.extra = e.extra;
    res.status(code).json(payload);
  }
});

/**
 * Privileged event-mode toggle. Only Admin and Developer accounts are
 * allowed to flip Guild League ↔ Emperium Overrun. Authentication is the
 * same session token the Bidders page hands out, sent as a Bearer header.
 */
app.post('/api/state/event-mode', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    if (!actor) {
      return res
        .status(401)
        .json({ error: 'You must sign in as Admin or Developer to change the event mode' });
    }
    if (actor.role !== 'Admin' && actor.role !== 'Developer') {
      return res
        .status(403)
        .json({ error: 'Only Admin or Developer can change the event mode' });
    }
    const rawMode =
      typeof req.body?.eventMode === 'string' ? req.body.eventMode : '';
    if (rawMode !== 'Guild League' && rawMode !== 'Emperium Overrun') {
      return res.status(400).json({ error: 'Invalid event mode' });
    }
    const state = await setEventMode(pool, rawMode);
    console.log(
      `[audit] event-mode set=${rawMode} by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
    );
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

/**
 * Privileged bulk-clear: empties every active auction item's queue in one
 * shot. Restricted to Admin / Developer because it is destructive and
 * irreversible. Bearer-authed against the Bidders-tab session token.
 */
app.post('/api/state/clear-queues', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    if (!actor) {
      return res
        .status(401)
        .json({ error: 'You must sign in as Admin or Developer to clear all queues' });
    }
    if (actor.role !== 'Admin' && actor.role !== 'Developer') {
      return res
        .status(403)
        .json({ error: 'Only Admin or Developer can clear all queues' });
    }
    const state = await clearAllActiveQueues(pool);
    console.log(
      `[audit] clear-all-queues by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
    );
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

app.put('/api/state', requireAuth, async (req, res) => {
  try {
    const prev = await getFullState(pool);

    // Shuffle transitions are privileged:
    //   • false → true  (Start Shuffle)  — Officer / Admin / Developer
    //   • true  → false (Reset Shuffle)  — Admin / Developer ONLY (stricter,
    //     because reset clears the winner pool and re-opens queues)
    // Other state PUTs that don't flip the lock pass through unchanged.
    const willLockShuffle =
      prev.shuffleLocked !== true && req.body?.shuffleLocked === true;
    const willResetShuffle =
      prev.shuffleLocked === true && req.body?.shuffleLocked !== true;
    if (willLockShuffle) {
      const actor = await getFreshActor(pool, bearerToken(req));
      if (!actor) {
        return res
          .status(401)
          .json({ error: 'You must sign in as Officer/Admin/Developer to start the shuffle' });
      }
      console.log(
        `[audit] shuffle-start by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
      );
    } else if (willResetShuffle) {
      const actor = await getFreshActor(pool, bearerToken(req));
      if (!actor) {
        return res
          .status(401)
          .json({ error: 'You must sign in as Admin or Developer to reset the shuffle' });
      }
      if (actor.role !== 'Admin' && actor.role !== 'Developer') {
        return res
          .status(403)
          .json({ error: 'Only Admin or Developer can reset the shuffle' });
      }
      console.log(
        `[audit] shuffle-reset by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
      );
    }

    // Winner-set-limit save (rewardRank or rewardItemCounts changing) is
    // restricted to Officer / Admin / Developer. We detect a change by
    // comparing the previous snapshot to the incoming body. Routine state
    // PUTs that don't touch these fields aren't affected.
    if (winnerLimitsChanged(prev, req.body)) {
      const actor = await getFreshActor(pool, bearerToken(req));
      if (!actor) {
        return res
          .status(401)
          .json({ error: 'You must sign in as Officer/Admin/Developer to change winner set limits' });
      }
      console.log(
        `[audit] winner-limits-set rank=${req.body?.rewardRank ?? '?'} by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
      );
    }

    await replaceFullState(pool, req.body);
    const ip = clientIp(req);
    const auditLines = describeAdminStatePut(prev, req.body);
    if (auditLines.length === 0) {
      console.log(`[audit] state saved (no diff vs previous snapshot) ip=${ip}`);
    } else {
      for (const line of auditLines) {
        console.log(`[audit] ${line} ip=${ip}`);
      }
    }
    const state = await getFullState(pool);
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

app.delete('/api/items/:itemId/queue/:memberId', requireAuth, async (req, res) => {
  try {
    // Removing a bidder from an auction queue requires the same privileged
    // session the Bidders page uses — Officer, Admin, or Developer.
    const actor = await getFreshActor(pool, bearerToken(req));
    if (!actor) {
      return res
        .status(401)
        .json({ error: 'You must sign in as Officer/Admin/Developer to remove from the queue' });
    }
    const state = await removeMemberFromItemQueue(
      pool,
      req.params.itemId,
      req.params.memberId
    );
    console.log(
      `[audit] queue remove item=${req.params.itemId} member=${req.params.memberId} by=${actor.name} role=${actor.role} ip=${clientIp(req)}`
    );
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message ?? 'Error') });
  }
});

app.delete('/api/members/:memberId', requireAuth, async (req, res) => {
  try {
    const id = parseInt(String(req.params.memberId), 10);
    const before = await getFullState(pool);
    const m = before.members.find((x) => x.id === id);
    const state = await deactivateMember(pool, id);
    const label = m ? `"${m.name}" (${id})` : id;
    console.log(`[audit] delete: member ${label} ip=${clientIp(req)}`);
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

/**
 * Detect a winner-set-limit change between the previous full state and an
 * incoming `/api/state` PUT body. True if the rank changed or any of the
 * rewardItemCounts fields (fragment / feathers / per-card fragment cap)
 * was modified. Used to gate the privileged Officer/Admin/Developer
 * authorization on the PUT.
 */
function winnerLimitsChanged(prev, body) {
  if (!body || typeof body !== 'object') return false;
  const prevRank = String(prev?.rewardRank ?? '');
  const nextRank =
    typeof body.rewardRank === 'string' ? body.rewardRank : prevRank;
  if (prevRank !== nextRank) return true;
  const a = prev?.rewardItemCounts ?? {};
  const b = body.rewardItemCounts ?? {};
  if (!b || typeof b !== 'object') return false;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  if (num(a.fragment) !== num(b.fragment)) return true;
  if (num(a.feathers) !== num(b.feathers)) return true;
  const aMap =
    a.fragmentByItemId && typeof a.fragmentByItemId === 'object'
      ? a.fragmentByItemId
      : {};
  const bMap =
    b.fragmentByItemId && typeof b.fragmentByItemId === 'object'
      ? b.fragmentByItemId
      : {};
  const keys = new Set([...Object.keys(aMap), ...Object.keys(bMap)]);
  for (const k of keys) {
    if (num(aMap[k]) !== num(bMap[k])) return true;
  }
  return false;
}

/** Extract bearer token (Bidders-tab session) from the Authorization header. */
function bearerToken(req) {
  const auth = req.headers['authorization'] || req.headers['Authorization'];
  if (typeof auth !== 'string') return null;
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim() || null;
}

/** Public: list IGNs eligible to sign in to the Bidders page (gate dropdown). */
app.get('/api/bidders/eligible', requireAuth, async (_req, res) => {
  try {
    const actors = await listEligibleActors(pool);
    res.json({ actors });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Bidders-tab sign-in. Returns a session token used as Bearer on subsequent calls. */
app.post('/api/bidders/auth', requireAuth, async (req, res) => {
  try {
    const result = await authBidder(pool, req.body, { ip: clientIp(req) });
    console.log(
      `[audit] bidder-auth signin id=${result.actor.id} name="${result.actor.name}" role=${result.actor.role} ip=${clientIp(req)}`
    );
    res.json(result);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

app.post('/api/bidders/signout', requireAuth, async (req, res) => {
  signOutActor(bearerToken(req));
  res.json({ ok: true });
});

/** Who-am-I lookup so the client can validate a stored token after reloads. */
app.get('/api/bidders/me', requireAuth, async (req, res) => {
  const actor = await getFreshActor(pool, bearerToken(req));
  if (!actor) return res.status(401).json({ error: 'Not signed in' });
  res.json({ actor });
});

/** Bidder Registration CRUD (admin tab). All require a signed-in actor. */
app.get('/api/bidders', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    if (!actor) return res.status(401).json({ error: 'You must sign in to perform this action' });
    const bidders = await listBidders(pool, actor);
    res.json({ bidders });
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

app.post('/api/bidders', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    const bidder = await createBidder(pool, req.body, actor);
    console.log(
      `[audit] bidder create id=${bidder.id} name="${bidder.name}" by=${actor?.name} ip=${clientIp(req)}`
    );
    res.json({ bidder });
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

app.put('/api/bidders/:id', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    const bidder = await updateBidder(pool, req.params.id, req.body, actor);
    console.log(
      `[audit] bidder update id=${bidder.id} name="${bidder.name}" active=${bidder.active ? 1 : 0} by=${actor?.name} ip=${clientIp(
        req
      )}`
    );
    res.json({ bidder });
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

app.delete('/api/bidders/:id', requireAuth, async (req, res) => {
  try {
    const actor = await getFreshActor(pool, bearerToken(req));
    const result = await deleteBidder(pool, req.params.id, actor);
    console.log(`[audit] bidder delete id=${result.id} by=${actor?.name} ip=${clientIp(req)}`);
    res.json(result);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

/** Admin: get overrun rewards config (dynamic rank → quantities). */
app.get('/api/admin/overrun/config', requireAuth, async (_req, res) => {
  try {
    const cfg = await loadOverrunRewardsConfig(pool);
    res.json(cfg);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Admin: update overrun rewards config. */
app.put('/api/admin/overrun/config', requireAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const cfg = {
      ...defaultOverrunRewardsConfig(),
      ...body,
      bands: Array.isArray(body.bands)
        ? body.bands
        : defaultOverrunRewardsConfig().bands,
    };
    await saveOverrunRewardsConfig(pool, cfg);
    console.log(
      `[audit] overrun config saved enabled=${cfg.enabled === true ? '1' : '0'} tz=${cfg.tz || getAuctionWeekTimezone()} ip=${clientIp(
        req
      )}`
    );
    res.json(await loadOverrunRewardsConfig(pool));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Admin: get saved ranking list used for Sunday payout. */
app.get('/api/admin/overrun/ranking', requireAuth, async (_req, res) => {
  try {
    const ranking = await loadOverrunRanking(pool);
    res.json({ ranking });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Admin: set ranking list used for Sunday payout. Body: { ranking: [{ ign, rank }...] } */
app.put('/api/admin/overrun/ranking', requireAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ranking = Array.isArray(body.ranking) ? body.ranking : [];
    await saveOverrunRanking(pool, ranking);
    console.log(
      `[audit] overrun ranking saved rows=${ranking.length} ip=${clientIp(req)}`
    );
    res.json({ ranking: await loadOverrunRanking(pool) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/**
 * Admin: run rewards now for this Sunday key.
 * Body: { ranking: [{ ign, rank }...], force?: boolean }
 */
app.post('/api/admin/overrun/run', requireAuth, async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const ranking = Array.isArray(body.ranking) ? body.ranking : [];
    const force = body.force === true;
    const result = await runOverrunRewards(pool, {
      ranking,
      requestedBy: 'admin',
      force,
    });
    console.log(
      `[audit] overrun run ok=${result.ok ? '1' : '0'} sunday=${result.sundayKey} skipped=${
        result.skipped ? '1' : '0'
      } reason=${result.reason || ''} ip=${clientIp(req)}`
    );
    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

/** Admin: view last N overrun runs (audit/history). */
app.get('/api/admin/overrun/runs', requireAuth, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const [rows] = await pool.query(
      `SELECT id, sunday_key AS sundayKey, created_at_ms AS createdAtMs, status, message
       FROM overrun_rewards_runs
       ORDER BY created_at_ms DESC
       LIMIT ?`,
      [limit]
    );
    res.json({ runs: rows });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

async function main() {
  await verifyMysqlConnection(pool);
  await initSchema(pool);
  await migrateMembersActiveColumn(pool);
  await migrateMembersOfficerRole(pool);
  await migrateMembersPasswordColumn(pool);
  await migrateAuctionWinnerNamesJson(pool);
  await migrateAuctionWinnerPoolCapColumn(pool);
  await migrateWinnerMarkLogTable(pool);
  await migrateBidderStateLogTable(pool);
  await migrateMembersIntPk(pool);
  await migrateOverrunRewardsRunsTable(pool);
  await seedIfEmpty(pool);
  await migrateDefaultAuctionItems(pool);
  await migrateIllusionFragCardDisplayOrder(pool);
  app.listen(PORT, () => {
    console.log(`rooc server http://127.0.0.1:${PORT}  (mysql: ${process.env.MYSQL_DATABASE ?? 'rooc'})`);
  });

  // Lightweight Sunday checker (no external cron dependency).
  // Runs when admin has enabled rewards; idempotent by sunday_key unique row.
  const tz = getAuctionWeekTimezone();
  let lastKey = '';
  setInterval(async () => {
    try {
      const state = await getFullState(pool);
      if (state.eventMode !== 'Emperium Overrun') return;
      const cfg = await loadOverrunRewardsConfig(pool);
      if (cfg.enabled !== true) return;
      const key = getOverrunSundayKey(Date.now(), cfg.tz || tz);
      if (key === lastKey) return;
      lastKey = key;
      const ranking = await loadOverrunRanking(pool);
      if (!Array.isArray(ranking) || ranking.length === 0) {
        console.log(
          `[audit] overrun sunday reached but no ranking sunday=${key} tz=${cfg.tz || tz}`
        );
        return;
      }
      const result = await runOverrunRewards(pool, {
        ranking,
        requestedBy: 'scheduler',
      });
      console.log(
        `[audit] overrun scheduler run ok=${result.ok ? '1' : '0'} sunday=${result.sundayKey} skipped=${
          result.skipped ? '1' : '0'
        } reason=${result.reason || ''}`
      );
    } catch (e) {
      console.error('[overrun scheduler]', e);
    }
  }, 60_000);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
