import crypto from 'crypto';

/** Admin login — set `AUCTION_ADMIN_USERNAME` and `AUCTION_ADMIN_PASSWORD` in `.env` (not in source). */
const LOGIN_USER = (process.env.AUCTION_ADMIN_USERNAME ?? '').trim();
const LOGIN_PASSWORD = process.env.AUCTION_ADMIN_PASSWORD ?? '';

if (!LOGIN_USER || !LOGIN_PASSWORD) {
  console.error(
    '[auth] Set AUCTION_ADMIN_USERNAME and AUCTION_ADMIN_PASSWORD in the environment (e.g. project `.env`).'
  );
  process.exit(1);
}

const COOKIE_NAME = 'rooc_sess';
const MAX_AGE_SEC = 7 * 24 * 60 * 60;
const SESSION_SECRET =
  process.env.AUCTION_SESSION_SECRET || 'rooc-hardcoded-session-signing-key-change-in-prod';

function signPayload(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

export function createSessionToken() {
  const exp = Date.now() + MAX_AGE_SEC * 1000;
  const payload = String(exp);
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const i = token.lastIndexOf('.');
  if (i <= 0) return false;
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return signPayload(payload) === sig;
}

export function getCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function getSessionToken(req) {
  return getCookie(req, COOKIE_NAME);
}

function buildSetCookie(value, maxAgeSec) {
  const parts = [
    `${COOKIE_NAME}=${value ? encodeURIComponent(value) : ''}`,
    'HttpOnly',
    'Path=/',
    `Max-Age=${maxAgeSec}`,
    'SameSite=Lax',
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', buildSetCookie(token, MAX_AGE_SEC));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', buildSetCookie('', 0));
}

export function requireAuth(_req, _res, next) {
  // Auth temporarily disabled — frontend login page was removed, so the
  // dashboard at `/` calls the API directly without a session cookie.
  return next();
}

function timingSafeUtf8Equal(a, b) {
  const x = Buffer.from(String(a), 'utf8');
  const y = Buffer.from(String(b), 'utf8');
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

export function handleLogin(req, res) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  const userOk = timingSafeUtf8Equal(username, LOGIN_USER);
  const passOk = timingSafeUtf8Equal(password, LOGIN_PASSWORD);
  if (!userOk || !passOk) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  setSessionCookie(res, createSessionToken());
  return res.json({ ok: true });
}

export function handleLogout(_req, res) {
  clearSessionCookie(res);
  res.json({ ok: true });
}

export function handleMe(req, res) {
  const token = getSessionToken(req);
  res.json({ ok: true, authed: verifySessionToken(token) });
}
