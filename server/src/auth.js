/**
 * Auth shim.
 *
 * The legacy admin login page (`/api/auth/login` + cookie session) was
 * removed from the frontend. We keep `requireAuth` as a no-op middleware
 * because dozens of routes still wire it in as a marker for "this used to
 * be admin-only" — pulling it out from every route would be a noisy diff
 * for no behaviour change. The Bidders page has its own bearer-token auth
 * (see `server/src/bidders.js`) which is the real gate now.
 */

export function requireAuth(_req, _res, next) {
  return next();
}
