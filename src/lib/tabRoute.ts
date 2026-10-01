/**
 * Map between the dashboard tab and the browser URL pathname.
 *
 *   /              → 'dashboard'    (Queues)
 *   /bidders       → 'bidders'      (Bidder Registration — admin)
 *   (Logs `/logs` and On CD `/card-cd` are hidden for now; those paths
 *    redirect to `/`. Their sections/components are kept for re-enabling.)
 *   /tournament    → 'tournament'   (3v3 double-elim brackets — public view)
 *   GET /api/card-cd → lightweight on-CD rows (server-computed)
 *   /registration  → public sign-up page (separate top-level route)
 */

export type DashboardTab = 'dashboard' | 'history' | 'bidders' | 'cardCd' | 'tournament';

const PATH_BY_TAB: Record<DashboardTab, string> = {
  dashboard: '/',
  history: '/logs',
  bidders: '/bidders',
  cardCd: '/card-cd',
  tournament: '/tournament',
};

export const PUBLIC_REGISTRATION_PATH = '/registration';
export const PUBLIC_CARD_CD_PATH = '/card-cd';

function normalizePath(pathname: string): string {
  return (pathname.split('?')[0] ?? '').replace(/\/+$/, '') || '/';
}

export function pathForTab(tab: DashboardTab): string {
  return PATH_BY_TAB[tab];
}

export function tabFromPath(pathname: string): DashboardTab {
  const clean = normalizePath(pathname);
  if (clean === '/bidders') return 'bidders';
  if (clean === '/tournament') return 'tournament';
  return 'dashboard';
}

/** True when the URL points at a path the app knows how to render. */
export function isKnownTabPath(pathname: string): boolean {
  const clean = normalizePath(pathname);
  return (
    clean === '/' ||
    clean === '/bidders' ||
    clean === '/tournament'
  );
}

/** True when the URL is the standalone public registration page. */
export function isRegistrationPath(pathname: string): boolean {
  return normalizePath(pathname) === PUBLIC_REGISTRATION_PATH;
}

/** True when the URL is a standalone public page (not the admin dashboard). */
export function isPublicStandalonePath(pathname: string): boolean {
  return isRegistrationPath(pathname);
}
