/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import AuctionDashboard from './AuctionDashboard';
import RegistrationPage from './RegistrationPage';
import { isKnownTabPath, isPublicStandalonePath } from './lib/tabRoute';

/** Top-level route the app should mount for the current URL pathname. */
type AppRoute = 'dashboard' | 'registration';

function routeFor(pathname: string): AppRoute {
  if (isPublicStandalonePath(pathname)) return 'registration';
  return 'dashboard';
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() =>
    routeFor(window.location.pathname)
  );

  // Canonicalize the URL: dashboard tab paths (`/`, `/logs`, `/bidders`,
  // `/card-cd`) and `/registration` are the only supported entries.
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    if (!isKnownTabPath(pathname) && !isPublicStandalonePath(pathname)) {
      window.history.replaceState(null, '', `/${search}${hash}`);
      setRoute('dashboard');
    }
  }, []);

  useEffect(() => {
    const onPop = () => setRoute(routeFor(window.location.pathname));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  if (route === 'registration') return <RegistrationPage />;
  return <AuctionDashboard />;
}
