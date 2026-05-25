/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public guild-registration page. Lives at `/registration` and is reachable
 * without any admin / Bidders-tab session. Users supply their IGN and a
 * password; the server creates a `Member`-role row in the `members` table.
 *
 * Privileged roles (Officer / Admin / Developer) are NOT exposed here —
 * those must be created from the admin Bidders tab.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  ShieldCheck,
  UserPlus,
  XCircle,
} from 'lucide-react';
import Swal from 'sweetalert2';
import {
  PublicIgnCheck,
  publicCheckIgn,
  publicRegisterRequest,
} from './lib/apiBidders';

const SWAL_DARK = {
  background: '#020617',
  color: '#f1f5f9',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function swalError(message: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'error',
    title: 'Registration failed',
    width: 'min(28rem, calc(100vw - 2rem))',
    html: `<p style="margin:0;line-height:1.55;font-size:14px;color:#fecaca;text-align:center">${escapeHtml(
      message
    )}</p>`,
    confirmButtonText: 'OK',
    confirmButtonColor: '#dc2626',
  }).then(() => undefined);
}

function swalSuccess(ign: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'success',
    title: 'Registration complete',
    width: 'min(28rem, calc(100vw - 2rem))',
    html: `<p style="margin:0;line-height:1.55;font-size:14px;color:#bbf7d0;text-align:center">Welcome, <b>${escapeHtml(
      ign
    )}</b>! You can now join an auction queue.</p>`,
    confirmButtonText: 'Go to auction',
    confirmButtonColor: '#2563eb',
  }).then(() => undefined);
}

type AvailabilityState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; ign: string }
  | { kind: 'taken'; ign: string; reason: string };

export default function RegistrationPage() {
  const [ign, setIgn] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityState>({
    kind: 'idle',
  });
  const debounceRef = useRef<number | null>(null);
  const lastCheckedRef = useRef<string>('');

  // Debounced live IGN availability check. Each keystroke schedules a probe
  // 400ms later; previous probes are cancelled. Server enforces uniqueness
  // again at submit time, so this is purely a UX hint.
  useEffect(() => {
    if (debounceRef.current != null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const trimmed = ign.trim();
    if (!trimmed) {
      setAvailability({ kind: 'idle' });
      return;
    }
    if (trimmed.length < 2) {
      setAvailability({
        kind: 'taken',
        ign: trimmed,
        reason: 'IGN must be at least 2 characters',
      });
      return;
    }
    if (trimmed.length > 32) {
      setAvailability({
        kind: 'taken',
        ign: trimmed,
        reason: 'IGN must be at most 32 characters',
      });
      return;
    }
    setAvailability({ kind: 'checking' });
    debounceRef.current = window.setTimeout(async () => {
      try {
        const out: PublicIgnCheck = await publicCheckIgn(trimmed);
        // Drop responses for a probe that's no longer the active query.
        if (out.ign.trim().toLowerCase() !== trimmed.toLowerCase()) return;
        lastCheckedRef.current = trimmed.toLowerCase();
        setAvailability(
          out.available
            ? { kind: 'available', ign: trimmed }
            : { kind: 'taken', ign: trimmed, reason: out.reason ?? 'IGN already registered' }
        );
      } catch {
        // Network blip — leave the UI without a check, let server-side
        // validation surface the real error at submit time.
        setAvailability({ kind: 'idle' });
      }
    }, 400);

    return () => {
      if (debounceRef.current != null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [ign]);

  const ignTrim = ign.trim();
  const passwordTrim = password.trim();
  const confirmTrim = confirmPassword.trim();

  const passwordMismatch =
    confirmTrim.length > 0 && passwordTrim !== confirmTrim;
  const passwordTooShort = passwordTrim.length > 0 && passwordTrim.length < 4;

  const canSubmit =
    !submitting &&
    ignTrim.length >= 2 &&
    ignTrim.length <= 32 &&
    availability.kind !== 'taken' &&
    availability.kind !== 'checking' &&
    passwordTrim.length >= 4 &&
    !passwordMismatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await publicRegisterRequest(ignTrim, passwordTrim);
      await swalSuccess(ignTrim);
      // Hard-navigate so the dashboard mounts cleanly with no stale state.
      window.location.href = '/';
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the server returned "already registered", reflect it in the
      // availability indicator too so the form stays accurate.
      if (/already.*registered/i.test(msg)) {
        setAvailability({
          kind: 'taken',
          ign: ignTrim,
          reason: 'IGN already registered',
        });
      }
      await swalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const ignStatusNode = (() => {
    if (!ignTrim) return null;
    if (availability.kind === 'checking') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Checking…
        </span>
      );
    }
    if (availability.kind === 'available') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> IGN available
        </span>
      );
    }
    if (availability.kind === 'taken') {
      return (
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-300">
          <XCircle className="h-3.5 w-3.5" aria-hidden /> {availability.reason}
        </span>
      );
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100">
      <section className="mx-auto max-w-md">
        <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40">
          <header className="border-b border-slate-800 bg-gradient-to-br from-blue-600/15 via-slate-900 to-slate-900 px-6 py-7">
            <div className="flex items-center gap-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600/20 text-blue-300">
                <UserPlus className="h-6 w-6" aria-hidden />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tight text-white">
                  Guild registration
                </h1>
                <p className="mt-0.5 text-xs leading-snug text-slate-400">
                  Sign up to join auction queues. 
                </p>
              </div>
            </div>
          </header>

          <form onSubmit={handleSubmit} className="space-y-5 px-6 py-6">
            <div>
              <label
                htmlFor="register-ign"
                className="block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >
                IGN
              </label>
              <input
                id="register-ign"
                type="text"
                value={ign}
                onChange={(e) => setIgn(e.target.value)}
                disabled={submitting}
                autoComplete="username"
                autoFocus
                spellCheck={false}
                maxLength={32}
                className={`mt-1.5 w-full rounded-xl border bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 disabled:opacity-50 ${
                  availability.kind === 'taken'
                    ? 'border-rose-500/60 focus:border-rose-400'
                    : availability.kind === 'available'
                      ? 'border-emerald-500/60 focus:border-emerald-400'
                      : 'border-slate-700 focus:border-blue-500'
                }`}
                placeholder="Your in-game name"
              />
              <div className="mt-1.5 min-h-[1.1rem] leading-tight">
                {ignStatusNode}
              </div>
            </div>

            <div>
              <label
                htmlFor="register-password"
                className="block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >
                Password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="register-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                  maxLength={128}
                  className={`w-full rounded-xl border bg-slate-950 px-3 py-2 pr-10 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 disabled:opacity-50 ${
                    passwordTooShort
                      ? 'border-rose-500/60 focus:border-rose-400'
                      : 'border-slate-700 focus:border-blue-500'
                  }`}
                  placeholder="Min. 4 characters"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={submitting}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
              {passwordTooShort && (
                <p className="mt-1.5 text-[11px] font-bold text-rose-300">
                  Password must be at least 4 characters.
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor="register-confirm"
                className="block text-[10px] font-black uppercase tracking-widest text-slate-400"
              >
                Confirm password
              </label>
              <div className="relative mt-1.5">
                <input
                  id="register-confirm"
                  type={showConfirm ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                  maxLength={128}
                  className={`w-full rounded-xl border bg-slate-950 px-3 py-2 pr-10 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 disabled:opacity-50 ${
                    passwordMismatch
                      ? 'border-rose-500/60 focus:border-rose-400'
                      : 'border-slate-700 focus:border-blue-500'
                  }`}
                  placeholder="Repeat your password"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm((v) => !v)}
                  disabled={submitting}
                  aria-label={showConfirm ? 'Hide password' : 'Show password'}
                  title={showConfirm ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50"
                >
                  {showConfirm ? (
                    <EyeOff className="h-4 w-4" aria-hidden />
                  ) : (
                    <Eye className="h-4 w-4" aria-hidden />
                  )}
                </button>
              </div>
              {passwordMismatch && (
                <p className="mt-1.5 text-[11px] font-bold text-rose-300">
                  Passwords do not match.
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                  Registering…
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" aria-hidden />
                  Register
                </>
              )}
            </button>

            <p className="text-center text-[10px] leading-relaxed text-slate-500">
              Already have an account?{' '}
              <a
                href="/"
                className="font-bold text-blue-400 transition-colors hover:text-blue-300"
              >
                Go to auction
              </a>
            </p>
          </form>
        </div>
      </section>
    </div>
  );
}
