/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Eye, EyeOff, Gavel, KeyRound } from 'lucide-react';
import { loginRequest } from './lib/apiState';

export default function LoginPage({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const r = await loginRequest(username.trim(), password);
      if ('ok' in r && r.ok) {
        onLoggedIn();
        return;
      }
      setErr('error' in r ? r.error : 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-md rounded-[2rem] border border-slate-800 bg-slate-900 p-10 shadow-2xl shadow-blue-950/40"
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 shadow-lg shadow-blue-900/30">
            <Gavel className="h-7 w-7 text-white" aria-hidden />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-white">Outlast Guild Bid</h1>
          <p className="text-sm font-medium text-slate-400">Sign in to manage the auction queue</p>
        </div>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-5">
          <div className="space-y-2">
            <label
              htmlFor="login-user"
              className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Username
            </label>
            <input
              id="login-user"
              autoComplete="username"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950 px-5 py-4 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
              placeholder="admin"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor="login-pass"
              className="ml-1 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500"
            >
              Password
            </label>
            <div className="relative">
              <input
                id="login-pass"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950 py-4 pl-5 pr-14 text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                tabIndex={-1}
                aria-pressed={showPassword}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 shrink-0" aria-hidden />
                ) : (
                  <Eye className="h-5 w-5 shrink-0" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {err ? (
            <p className="rounded-xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-center text-sm font-medium text-red-200">
              {err}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 py-4 text-sm font-black uppercase tracking-widest text-white shadow-xl shadow-blue-900/30 transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
