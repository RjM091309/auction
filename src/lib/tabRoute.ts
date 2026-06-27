/**
 * Map between the dashboard tab and the browser URL pathname.
 *
 *   /              → 'dashboard'    (Queues)
 *   /logs          → 'history'      (Logs)
 *   /bidders       → 'bidders'      (Bidder Registration — admin)
 *   /card-cd       → 'cardCd'       (On CD list — public, no login)
 *   GET /api/card-cd → lightweight on-CD rows (server-computed)
 *   /registration  → public sign-up page (separate top-level route)
 */

export type DashboardTab = 'dashboard' | 'history' | 'bidders' | 'cardCd';

const PATH_BY_TAB: Record<DashboardTab, string> = {
  dashboard: '/',
  history: '/logs',
  bidders: '/bidders',
  cardCd: '/card-cd',
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
  if (clean === '/logs') return 'history';
  if (clean === '/bidders') return 'bidders';
  if (clean === '/card-cd') return 'cardCd';
  return 'dashboard';
}

/** True when the URL points at a path the app knows how to render. */
export function isKnownTabPath(pathname: string): boolean {
  const clean = normalizePath(pathname);
  return (
    clean === '/' ||
    clean === '/logs' ||
    clean === '/bidders' ||
    clean === '/card-cd'
  );
}

/** True when the URL is the standalone public registration page. */
export function isRegistrationPath(pathname: string): boolean {
  return normalizePath(pathname) === PUBLIC_REGISTRATION_PATH;
}

/** True when the URL is the public Puppet Card CD tab. */
export function isCardCdPath(pathname: string): boolean {
  return normalizePath(pathname) === PUBLIC_CARD_CD_PATH;
}

/** True when the URL is a standalone public page (not the admin dashboard). */
export function isPublicStandalonePath(pathname: string): boolean {
  return isRegistrationPath(pathname);
}
