/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Puppet Frag Card cooldown list — mounted inside the main dashboard so the
 * header stays visible.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  Loader2,
  Search,
} from 'lucide-react';
import {
  CARD_CD_LIST_CACHE_KEY,
  fetchCardCdList,
  type CardCdTab,
  type OnCdRow,
} from './lib/apiCardCd';
import { puppetCardCdBadgeClass } from './lib/puppetCardCdDisplay';
import { fetchWithCache } from './lib/fetchCache';

type PageSize = 25 | 50 | 100;

const DEFAULT_PAGE_SIZE: PageSize = 25;
const REFRESH_MS = 30_000;

const TAB_COPY: Record<
  CardCdTab,
  { title: string; noteTitle: string; noteBody: React.ReactNode; empty: string }
> = {
  guildLeague: {
    title: 'Guild League',
    noteTitle: 'Guild League — Puppet Card CD',
    noteBody: (
      <>
        Nanalo ng <strong className="text-white">Puppet Frag Card</strong> sa{' '}
        <strong className="text-white">Tuesday</strong> Guild League? Hindi
        makakabid sa <strong className="text-white">Thursday</strong> round ng
        parehong linggo.
      </>
    ),
    empty: 'No Guild League Puppet CD right now.',
  },
  emperium: {
    title: 'Emperium Overrun',
    noteTitle: 'Emperium Overrun — Puppet Card CD',
    noteBody: (
      <>
        Nanalo ng <strong className="text-white">Puppet Frag Card</strong>? Hindi
        makakabid sa susunod na{' '}
        <strong className="text-white">Emperium Sunday</strong>.
      </>
    ),
    empty: 'No Emperium Overrun Puppet CD right now.',
  },
};

export default function CardCdSection() {
  const [guildRows, setGuildRows] = useState<OnCdRow[]>([]);
  const [emperiumRows, setEmperiumRows] = useState<OnCdRow[]>([]);
  const [activeTab, setActiveTab] = useState<CardCdTab>('guildLeague');
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const rows = activeTab === 'guildLeague' ? guildRows : emperiumRows;
  const tabCopy = TAB_COPY[activeTab];

  const load = async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent && guildRows.length === 0 && emperiumRows.length === 0) {
      setInitialLoading(true);
    }
    if (opts.silent) setRefreshing(true);
    try {
      const { data, fromCache } = await fetchWithCache(
        CARD_CD_LIST_CACHE_KEY,
        fetchCardCdList,
        { ttlMs: REFRESH_MS }
      );
      setGuildRows(data.guildLeague);
      setEmperiumRows(data.emperium);
      setError(null);
      if (!fromCache || data.guildLeague.length > 0 || data.emperium.length > 0) {
        setInitialLoading(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      void load({ silent: true });
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, []);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => row.name.toLowerCase().includes(q));
  }, [rows, searchTerm]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const pageRows = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  useEffect(() => {
    setPage(1);
  }, [searchTerm, pageSize, activeTab]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-black tracking-tight text-white">
          On CD — Puppet Card
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Bidders on Puppet Frag Card cooldown by event mode.
          {refreshing ? (
            <span className="ml-2 text-xs text-slate-500">Refreshing…</span>
          ) : null}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['guildLeague', 'emperium'] as const).map((tab) => {
          const count = tab === 'guildLeague' ? guildRows.length : emperiumRows.length;
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`rounded-xl border px-4 py-2 text-sm font-bold transition-colors ${
                active
                  ? 'border-amber-500 bg-amber-950/50 text-amber-100'
                  : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200'
              }`}
            >
              {TAB_COPY[tab].title}
              <span className="ml-2 text-xs font-semibold opacity-80">({count})</span>
            </button>
          );
        })}
      </div>

      <div
        className="rounded-xl border border-amber-700/60 bg-gradient-to-br from-amber-950/40 to-slate-900/60 px-4 py-3.5"
        role="note"
      >
        <p className="text-[11px] font-black uppercase tracking-widest text-amber-300">
          {tabCopy.noteTitle}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-amber-50/95">
          {tabCopy.noteBody}
        </p>
      </div>

      <div className="relative w-full sm:max-w-sm">
        <Search
          className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
          aria-hidden
        />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by IGN…"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-9 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-amber-500"
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[320px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">IGN</th>
                <th className="px-4 py-3">Time left</th>
              </tr>
            </thead>
            <tbody>
              {initialLoading ? (
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      Loading…
                    </span>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={2}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    {rows.length === 0
                      ? tabCopy.empty
                      : 'No on-CD bidders match your search.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((row) => (
                  <tr
                    key={`${activeTab}-${row.id}-${row.name}`}
                    className="border-b border-slate-800/70 last:border-0 transition-colors hover:bg-slate-800/40"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {row.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        title={row.cardCd.title}
                        className={`inline-flex max-w-[12rem] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${puppetCardCdBadgeClass(
                          row.cardCd.tone
                        )}`}
                      >
                        <Clock
                          className="h-3 w-3 shrink-0 opacity-80"
                          aria-hidden
                        />
                        <span className="truncate normal-case">
                          {row.cardCd.label}
                        </span>
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!initialLoading && filtered.length > 0 ? (
          <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/40 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500">
              Showing {startIndex + 1}–{endIndex} of {filtered.length}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs text-slate-400">
                Rows
                <select
                  value={pageSize}
                  onChange={(e) =>
                    setPageSize(Number(e.target.value) as PageSize)
                  }
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-amber-500"
                >
                  <option value={25}>25</option>
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                </select>
              </label>
              <div className="inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPage(1)}
                  disabled={currentPage <= 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="First page"
                >
                  <ChevronsLeft className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden />
                </button>
                <span className="min-w-[4.5rem] text-center text-xs font-bold text-slate-300">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Next page"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => setPage(totalPages)}
                  disabled={currentPage >= totalPages}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label="Last page"
                >
                  <ChevronsRight className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
