/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import AuctionDashboard from './AuctionDashboard';
import RegistrationPage from './RegistrationPage';
import { isKnownTabPath, isRegistrationPath } from './lib/tabRoute';

/** Top-level route the app should mount for the current URL pathname. */
type AppRoute = 'dashboard' | 'registration';

function routeFor(pathname: string): AppRoute {
  if (isRegistrationPath(pathname)) return 'registration';
  return 'dashboard';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    routeFor(window.location.pathname)
  );

  // Canonicalize the URL: dashboard tab paths (`/`, `/logs`, `/bidders`) and
  // the public `/registration` page are the only supported entries. Anything
  // else (e.g. `/admin`) is rewritten to the root.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (!isKnownTabPath(pathname) && !isRegistrationPath(pathname)) {
      window.history.replaceState(null, '', `/${search}${hash}`);
      setRoute('dashboard');
    }
  }, []);

  // Re-render when the user hits Back/Forward across the registration page
  // and the admin dashboard (popstate fires for browser nav only).
  useEffect(() => {
    const onPop = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route === 'registration') return <RegistrationPage />;
  return <AuctionDashboard />;
}
