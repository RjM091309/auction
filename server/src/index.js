import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import {
  createPool,
  initSchema,
  migrateMembersActiveColumn,
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
    const id = req.params.memberId;
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

async function main() {
  await verifyMysqlConnection(pool);
  await initSchema(pool);
  await migrateMembersActiveColumn(pool);
  await seedIfEmpty(pool);
  app.listen(PORT, () => {
    console.log(`rooc server http://127.0.0.1:${PORT}  (mysql: ${process.env.MYSQL_DATABASE ?? 'rooc'})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
