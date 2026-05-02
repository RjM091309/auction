import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { createPool, initSchema, seedIfEmpty } from './db.js';
import { getFullState, replaceFullState } from './stateRepo.js';

const PORT = Number(process.env.PORT ?? 3333);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const pool = createPool();

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, db: 'mysql' });
  } catch (e) {
    res.status(503).json({ ok: false, error: String(e.message) });
  }
});

app.get('/api/state', async (_req, res) => {
  try {
    const state = await getFullState(pool);
    res.json(state);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: String(e.message) });
  }
});

app.put('/api/state', async (req, res) => {
  try {
    await replaceFullState(pool, req.body);
    const state = await getFullState(pool);
    res.json(state);
  } catch (e) {
    const code = e.statusCode ?? 500;
    if (code >= 500) console.error(e);
    res.status(code).json({ error: String(e.message) });
  }
});

async function main() {
  await initSchema(pool);
  await seedIfEmpty(pool);
  app.listen(PORT, () => {
    console.log(`rooc server http://127.0.0.1:${PORT}  (mysql: ${process.env.MYSQL_DATABASE ?? 'rooc'})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
