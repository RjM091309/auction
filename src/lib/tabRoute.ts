/**
 * Map between the dashboard tab and the browser URL pathname.
 *
 *   /              → 'dashboard'    (Queues)
 *   /logs          → 'history'      (Logs)
 *   /bidders       → 'bidders'      (Bidder Registration — admin)
 *   /registration  → public sign-up page (separate top-level route)
 */

export type DashboardTab = 'dashboard' | 'history' | 'bidders';

const PATH_BY_TAB: Record<DashboardTab, string> = {
  dashboard: '/',
  history: '/logs',
  bidders: '/bidders',
};

export const PUBLIC_REGISTRATION_PATH = '/registration';

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
  return 'dashboard';
}

/** True when the URL points at a path the app knows how to render. */
export function isKnownTabPath(pathname: string): boolean {
  const clean = normalizePath(pathname);
  return clean === '/' || clean === '/logs' || clean === '/bidders';
}

/** True when the URL is the standalone public registration page. */
export function isRegistrationPath(pathname: string): boolean {
  return normalizePath(pathname) === PUBLIC_REGISTRATION_PATH;
}
