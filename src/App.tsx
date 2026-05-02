/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { fetchAuthMe } from './lib/apiState';
import { isAdminPath } from './lib/adminPath';
import LoginPage from './LoginPage';
import AuctionDashboard from './AuctionDashboard';
import PublicAuctionView from './PublicAuctionView';

export default function App() {
  const adminRoute = useMemo(() => isAdminPath(window.location.pathname), []);
  const [session, setSession] = useState<'loading' | 'out' | 'in'>(() =>
    adminRoute ? 'loading' : 'in'
  );

  useEffect(() => {
    if (!adminRoute) return;
    let cancelled = false;
    (async () => {
      try {
        const { authed } = await fetchAuthMe();
        if (cancelled) return;
        setSession(authed ? 'in' : 'out');
      } catch {
        if (!cancelled) setSession('out');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [adminRoute]);

  if (!adminRoute) {
    return <PublicAuctionView />;
  }

  if (session === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center">
        <p className="text-slate-500 text-sm font-medium">Checking session…</p>
      </div>
    );
  }

  if (session === 'out') {
    return <LoginPage onLoggedIn={() => setSession('in')} />;
  }

  return <AuctionDashboard onLogout={() => setSession('out')} />;
}
