import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import {
  createPool,
  initSchema,
  migrateMembersActiveColumn,
  migrateAuctionWinnerNamesJson,
  migrateAuctionWinnerPoolCapColumn,
  migrateWinnerMarkLogTable,
  migrateBidderStateLogTable,
  migrateMembersIntPk,
  migrateOverrunRewardsRunsTable,
  seedIfEmpty,
  verifyMysqlConnection,
} from './db.js';
import {
  getFullState,
  replaceFullState,
  deactivateMember,
  publicAddBidToQueue,
} from './stateRepo.js';
import {
  handleLogin,
  handleLogout,
  handleMe,
  requireAuth,
} from './auth.js';
import { clientIp, describeAdminStatePut } from './auditLog.js';
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

app.put('/api/state', requireAuth, async (req, res) => {
  try {
    const prev = await getFullState(pool);
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
  await migrateAuctionWinnerNamesJson(pool);
  await migrateAuctionWinnerPoolCapColumn(pool);
  await migrateWinnerMarkLogTable(pool);
  await migrateBidderStateLogTable(pool);
  await migrateMembersIntPk(pool);
  await migrateOverrunRewardsRunsTable(pool);
  await seedIfEmpty(pool);
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
