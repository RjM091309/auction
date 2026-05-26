/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Sign-in gate for the Bidder Registration page. Only members with role
 * Officer/Admin/Developer may pass. The user picks their IGN from a dropdown
 * (populated from `/api/bidders/eligible`) and types the password stored on
 * their `members` row. On success the server returns a session token that
 * the parent component stores in `sessionStorage`.
 */

import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  LogIn,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import Swal from 'sweetalert2';
import {
  BidderActor,
  BidderRole,
  EligibleActor,
  authBidderRequest,
  fetchEligibleActors,
} from './lib/apiBidders';

const SWAL_DARK = {
  background: '#020617',
  color: '#f1f5f9',
};

function swalError(message: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'error',
    title: 'Sign-in failed',
    width: 'min(28rem, calc(100vw - 2rem))',
    html: `<p style="margin:0;line-height:1.55;font-size:14px;color:#fecaca;text-align:center">${escapeHtml(
      message
    )}</p>`,
    confirmButtonText: 'OK',
    confirmButtonColor: '#dc2626',
  }).then(() => undefined);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roleBadgeClass(role: BidderRole): string {
  if (role === 'Developer') return 'bg-violet-900/40 text-violet-300';
  if (role === 'Admin') return 'bg-sky-900/40 text-sky-300';
  if (role === 'Officer') return 'bg-amber-900/40 text-amber-300';
  return 'bg-slate-800 text-slate-300';
}

/** Anything renderable in NameDropdown — needs id + name + role only. */
export interface NameDropdownOption {
  id: number;
  name: string;
  role: BidderRole;
}

interface NameDropdownProps {
  options: NameDropdownOption[];
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyMessage?: string;
}

/**
 * Select2-style searchable dropdown:
 *  - Click toggles the panel, which auto-focuses the search input.
 *  - Typing filters options live by IGN or role.
 *  - ArrowUp/Down navigate the visible options, Enter selects, Esc closes.
 *  - Outside-click and Esc close the panel.
 *
 * Exported so the auction-dashboard "Join queue" modal can reuse it.
 */
export function NameDropdown({
  options,
  value,
  onChange,
  disabled,
  placeholder = '— Select your IGN —',
  emptyMessage = 'No matches',
}: NameDropdownProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  // React's `useId` gives us a stable-but-unique suffix per mount so the
  // input's `name` attribute (e.g. `ign-filter-:r3:`) is unguessable by
  // Chrome/Edge autofill, which key off well-known names like `username`.
  const inputDomId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      // Defer focus so the panel is in the DOM first.
      const t1 = setTimeout(() => inputRef.current?.focus(), 0);
      // Chrome/Edge will sometimes still drop a cached value into a text
      // input even with `autoComplete="off"` (especially if the user once
      // typed e.g. "admin" into a since-removed login form on the same
      // origin). We force-clear on the next two macrotasks so any sneaky
      // autofill — whether it fires on mount, on focus, or slightly later
      // from a password manager — is reset before the user notices.
      setQuery('');
      const t2 = setTimeout(() => setQuery(''), 0);
      const t3 = setTimeout(() => setQuery(''), 60);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
    setQuery('');
    setActiveIdx(0);
    return undefined;
  }, [open]);

  const selected = useMemo(
    () => options.find((o) => o.name === value) ?? null,
    [options, value]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) || o.role.toLowerCase().includes(q)
    );
  }, [options, query]);

  // Keep the active row inside the filtered list.
  useEffect(() => {
    setActiveIdx((i) => Math.min(Math.max(0, i), Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  // Scroll the active option into view.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-idx="${activeIdx}"]`
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIdx]);

  const commit = (idx: number) => {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.name);
    setOpen(false);
  };

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      commit(activeIdx);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled || options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 transition-colors hover:border-slate-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="flex items-center gap-2 truncate">
          {selected ? (
            <>
              <span className="font-bold">{selected.name}</span>
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${roleBadgeClass(
                  selected.role
                )}`}
              >
                {selected.role}
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              {options.length === 0 ? emptyMessage : placeholder}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-xl shadow-black/40">
          <div className="relative border-b border-slate-800 bg-slate-950/40 px-2 py-2">
            <Search
              className="absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500"
              aria-hidden
            />
            <input
              ref={inputRef}
              // Layered defence against browser autofill (Chrome/Edge will
              // happily drop a cached "admin"/"username" into ANY text-ish
              // input that lives near a form). `type="search"` + a
              // randomized `name` + every password-manager opt-out, plus
              // the explicit `setQuery('')` resets in the `open` effect,
              // is what it takes to keep this filter field truly empty
              // when the dropdown opens.
              type="search"
              name={`ign-filter-${inputDomId}`}
              id={`ign-filter-${inputDomId}`}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              aria-autocomplete="list"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder="Search IGN or role…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-7 text-xs text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500 [&::-webkit-search-cancel-button]:hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Clear search"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-200"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
          <ul
            ref={listRef}
            role="listbox"
            className="custom-scrollbar max-h-56 overflow-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-3 text-center text-xs text-slate-500">
                {emptyMessage}
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.name === value;
                const isActive = idx === activeIdx;
                return (
                  <li key={opt.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      data-idx={idx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => commit(idx)}
                      className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'bg-blue-600 text-white'
                          : isActive
                            ? 'bg-slate-800 text-slate-100'
                            : 'text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <span className="font-bold">{opt.name}</span>
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${roleBadgeClass(
                            opt.role
                          )} ${isSelected ? 'ring-1 ring-white/30' : ''}`}
                        >
                          {opt.role}
                        </span>
                      </span>
                      {isSelected && <Check className="h-4 w-4 shrink-0" aria-hidden />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-slate-800 bg-slate-950/40 px-3 py-1.5 text-[10px] text-slate-500">
            {filtered.length} of {options.length}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The reusable IGN + password form. Used by both the full-page `BidderAuthGate`
 * (Bidders tab) and the smaller `BidderAuthModal` (queue-remove confirmation).
 */
interface BidderAuthFormProps {
  onAuth: (actor: BidderActor) => void;
  submitLabel?: string;
  /**
   * If provided, restrict the IGN dropdown to these roles. The server still
   * authenticates against the same eligible-actor endpoint, but the UI hides
   * IGNs that cannot perform the gated action. After the server returns the
   * authed actor we re-check the role and reject any actor outside this list
   * to defend against a tampered client.
   */
  allowedRoles?: BidderRole[];
}

export function BidderAuthForm({
  onAuth,
  submitLabel = 'Sign in',
  allowedRoles,
}: BidderAuthFormProps) {
  const [options, setOptions] = useState<EligibleActor[]>([]);
  const [loadingOpts, setLoadingOpts] = useState(true);
  const [optsError, setOptsError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoadingOpts(true);
      setOptsError(null);
      try {
        const list = await fetchEligibleActors();
        if (!cancelled) setOptions(list);
      } catch (e) {
        if (!cancelled) setOptsError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoadingOpts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredOptions = useMemo(() => {
    if (!allowedRoles || allowedRoles.length === 0) return options;
    const set = new Set(allowedRoles);
    return options.filter((o) => set.has(o.role));
  }, [options, allowedRoles]);

  const canSubmit = !!name && !!password.trim() && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const actor = await authBidderRequest(name, password.trim());
      if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(actor.role)) {
        void swalError(`This action requires ${allowedRoles.join(' or ')}.`);
        return;
      }
      onAuth(actor);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void swalError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
          IGN
        </label>
        <div className="mt-1.5">
          <NameDropdown
            options={filteredOptions}
            value={name}
            onChange={setName}
            disabled={loadingOpts || submitting}
            emptyMessage={
              allowedRoles && allowedRoles.length > 0
                ? `No ${allowedRoles.join('/')} accounts`
                : 'No matches'
            }
          />
        </div>
        {optsError && (
          <p className="mt-1.5 text-[11px] text-rose-300">{optsError}</p>
        )}
        {loadingOpts && (
          <p className="mt-1.5 text-[11px] text-slate-500">Loading IGNs…</p>
        )}
      </div>
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
          Password / ingame ID number
        </label>
        <div className="relative mt-1.5">
          <input
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={submitting}
            autoComplete="current-password"
            className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pr-10 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500 disabled:opacity-50"
            placeholder="Enter your password or ingame ID number"
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            disabled={submitting}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            title={showPassword ? 'Hide password' : 'Show password'}
            tabIndex={-1}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {showPassword ? (
              <EyeOff className="h-4 w-4" aria-hidden />
            ) : (
              <Eye className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
      </div>
      <button
        type="submit"
        disabled={!canSubmit}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogIn className="h-4 w-4" aria-hidden />
        {submitting ? 'Signing in…' : submitLabel}
      </button>
    </form>
  );
}

interface BidderAuthGateProps {
  onAuth: (actor: BidderActor) => void;
}

export default function BidderAuthGate({ onAuth }: BidderAuthGateProps) {
  return (
    <section className="mx-auto max-w-md py-6">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/40">
        <div className="mb-5 flex items-center gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600/20 text-blue-300">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Bidders sign-in</h2>
            <p className="text-xs text-slate-400">
              Officer, Admin, or Developer access required.
            </p>
          </div>
        </div>
        <BidderAuthForm onAuth={onAuth} />
      </div>
    </section>
  );
}
