/**
 * Admin audit log: bidder registration + auction dashboard actions.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  ListX,
  Loader2,
  Pencil,
  RotateCcw,
  Search,
  Settings2,
  Shuffle,
  Trophy,
  UserMinus,
  UserPlus,
  UserX,
  XCircle,
} from 'lucide-react';
import { displayAuctionItemName } from '../lib/formatAuctionItemName';
import { formatAuctionLogTime } from '../lib/formatAuctionLogTime';
import {
  BIDDER_AUDIT_CHANGED_EVENT,
  fetchBidderAuditLog,
  isBidderRegistrationAction,
  type BidderAuditAction,
  type BidderAuditEntry,
} from '../lib/apiBidderAudit';
const ACTION_FILTERS: { id: 'all' | BidderAuditAction; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'approve', label: 'Approved' },
  { id: 'reject', label: 'Rejected' },
  { id: 'create', label: 'Created' },
  { id: 'edit', label: 'Edited' },
  { id: 'delete', label: 'Deleted' },
  { id: 'shuffle_start', label: 'Shuffle' },
  { id: 'shuffle_reset', label: 'Reset' },
  { id: 'event_mode_change', label: 'Event' },
  { id: 'winner_limits_set', label: 'Limits' },
  { id: 'clear_all_queues', label: 'Clear all' },
  { id: 'queue_remove', label: 'Remove bid' },
  { id: 'winner_mark_adjust', label: 'Winner mark' },
];

function actionLabel(action: BidderAuditAction): string {
  switch (action) {
    case 'approve':
      return 'Approved';
    case 'reject':
      return 'Rejected';
    case 'create':
      return 'Created';
    case 'edit':
      return 'Edited';
    case 'delete':
      return 'Deleted';
    case 'shuffle_start':
      return 'Shuffle started';
    case 'shuffle_reset':
      return 'Shuffle reset';
    case 'event_mode_change':
      return 'Event mode';
    case 'winner_limits_set':
      return 'Winner Settings';
    case 'clear_all_queues':
      return 'Clear all';
    case 'queue_remove':
      return 'Removed from queue';
    case 'winner_mark_adjust':
      return 'Winner mark adjusted';
    default:
      return action;
  }
}

function actionBadgeClass(action: BidderAuditAction): string {
  switch (action) {
    case 'approve':
      return 'border-green-500/40 bg-green-500/10 text-green-300';
    case 'reject':
      return 'border-rose-500/40 bg-rose-500/10 text-rose-300';
    case 'create':
      return 'border-blue-500/40 bg-blue-500/10 text-blue-300';
    case 'edit':
      return 'border-amber-500/40 bg-amber-500/10 text-amber-300';
    case 'delete':
      return 'border-slate-500/40 bg-slate-500/10 text-slate-300';
    case 'shuffle_start':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-300';
    case 'shuffle_reset':
      return 'border-orange-500/40 bg-orange-500/10 text-orange-300';
    case 'event_mode_change':
      return 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300';
    case 'winner_limits_set':
      return 'border-indigo-500/40 bg-indigo-500/10 text-indigo-300';
    case 'clear_all_queues':
      return 'border-rose-500/30 bg-rose-950/30 text-rose-200';
    case 'queue_remove':
      return 'border-pink-500/40 bg-pink-500/10 text-pink-300';
    case 'winner_mark_adjust':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300';
    default:
      return 'border-slate-600 bg-slate-800 text-slate-400';
  }
}

function ActionIcon({ action }: { action: BidderAuditAction }) {
  const cls = 'h-4 w-4 stroke-[2.5]';
  switch (action) {
    case 'approve':
      return <Check className={cls} aria-hidden />;
    case 'reject':
      return <UserX className={cls} aria-hidden />;
    case 'create':
      return <UserPlus className={cls} aria-hidden />;
    case 'edit':
      return <Pencil className={cls} aria-hidden />;
    case 'delete':
      return <XCircle className={cls} aria-hidden />;
    case 'shuffle_start':
      return <Shuffle className={cls} aria-hidden />;
    case 'shuffle_reset':
      return <RotateCcw className={cls} aria-hidden />;
    case 'event_mode_change':
      return <Trophy className={cls} aria-hidden />;
    case 'winner_limits_set':
      return <Settings2 className={cls} aria-hidden />;
    case 'clear_all_queues':
      return <ListX className={cls} aria-hidden />;
    case 'queue_remove':
      return <UserMinus className={cls} aria-hidden />;
    case 'winner_mark_adjust':
      return <Check className={cls} aria-hidden />;
    default:
      return null;
  }
}

function actionTitleColor(action: BidderAuditAction): string {
  switch (action) {
    case 'approve':
      return 'text-green-400';
    case 'reject':
      return 'text-rose-300';
    case 'create':
      return 'text-blue-300';
    case 'edit':
      return 'text-amber-300';
    case 'delete':
      return 'text-slate-400';
    case 'shuffle_start':
      return 'text-violet-300';
    case 'shuffle_reset':
      return 'text-orange-300';
    case 'event_mode_change':
      return 'text-cyan-300';
    case 'winner_limits_set':
      return 'text-indigo-300';
    case 'clear_all_queues':
      return 'text-rose-200';
    case 'queue_remove':
      return 'text-pink-300';
    case 'winner_mark_adjust':
      return 'text-emerald-300';
    default:
      return 'text-slate-400';
  }
}

function AuditLogCard({ row }: { row: BidderAuditEntry }) {
  return (
    <li className="rounded-2xl border border-slate-800 bg-slate-900/80 p-3.5 sm:p-4">
      <div className="flex gap-3">
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border sm:h-9 sm:w-9 ${actionBadgeClass(row.action)}`}
        >
          <ActionIcon action={row.action} />
        </div>

        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span
                  className={`text-[10px] font-black uppercase tracking-wider ${actionTitleColor(row.action)}`}
                >
                  {actionLabel(row.action)}
                </span>
                <span
                  className={`break-words font-bold ${
                    isBidderRegistrationAction(row.action) ||
                    row.action === 'queue_remove'
                      ? 'text-amber-400'
                      : 'text-slate-100'
                  }`}
                >
                  {row.targetName}
                </span>
                {row.targetRole ? (
                  <span className="text-xs font-semibold text-slate-500">
                    ({row.targetRole})
                  </span>
                ) : null}
              </div>
            </div>
            <time
              dateTime={new Date(row.at).toISOString()}
              className="shrink-0 pt-0.5 text-right font-mono text-[11px] font-semibold leading-tight text-slate-400 sm:text-xs"
            >
              {formatAuctionLogTime(row.at)}
            </time>
          </div>

          <p className="text-xs leading-relaxed text-slate-500">
            <span className="text-slate-600">by </span>
            <span className="font-semibold text-slate-300">{row.actorName}</span>
            <span className="text-slate-600"> · </span>
            <span className="font-semibold uppercase tracking-wide text-slate-500">
              {row.actorRole}
            </span>
          </p>

          <AuditDetails entry={row} />
        </div>
      </div>
    </li>
  );
}

function entryMatchesSearch(entry: BidderAuditEntry, q: string): boolean {
  if (!q) return true;
  const hay = [
    entry.targetName,
    entry.targetRole ?? '',
    entry.actorName,
    entry.actorRole,
    actionLabel(entry.action),
    entry.details?.approvalStatus ?? '',
    entry.details?.from ?? '',
    entry.details?.to ?? '',
    entry.details?.eventMode ?? '',
    entry.details?.entriesCleared != null
      ? String(entry.details.entriesCleared)
      : '',
    entry.details?.itemName ?? '',
    entry.details?.itemType ?? '',
    ...(entry.details?.changes?.flatMap((c) => [c.field, c.from, c.to]) ?? []),
  ]
    .join(' ')
    .toLowerCase();
  return hay.includes(q);
}

function AuditDetails({ entry }: { entry: BidderAuditEntry }) {
  const d = entry.details;
  if (!d) return null;
  if (entry.action === 'approve' || entry.action === 'reject') {
    return (
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Status →{' '}
        <span
          className={
            entry.action === 'approve' ? 'text-green-400' : 'text-rose-300'
          }
        >
          {d.approvalStatus ?? (entry.action === 'approve' ? 'approved' : 'rejected')}
        </span>
      </p>
    );
  }
  if (entry.action === 'create' && d.role) {
    return (
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Role: <span className="text-slate-300">{d.role}</span>
      </p>
    );
  }
  if (
    (entry.action === 'edit' || entry.action === 'winner_limits_set') &&
    d.changes &&
    d.changes.length > 0
  ) {
    return (
      <ul className="space-y-1 rounded-lg border border-slate-800/80 bg-slate-950/40 px-2.5 py-2 text-xs text-slate-400">
        {d.changes.map((c) => (
          <li key={c.field} className="break-words leading-relaxed">
            <span className="font-semibold text-slate-500">{c.field}</span>
            {': '}
            <span className="text-slate-500">{c.from}</span>
            <span className="text-slate-600"> → </span>
            <span className="text-slate-200">{c.to}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (entry.action === 'event_mode_change' && d.from && d.to) {
    return (
      <p className="text-xs text-slate-400">
        <span className="text-slate-500">{d.from}</span>
        <span className="text-slate-600"> → </span>
        <span className="font-semibold text-cyan-300">{d.to}</span>
      </p>
    );
  }
  if (entry.action === 'shuffle_start' && d.eventMode) {
    return (
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Event: <span className="text-slate-300">{d.eventMode}</span>
      </p>
    );
  }
  if (entry.action === 'winner_mark_adjust' && d.eventMode) {
    return (
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Event: <span className="text-slate-300">{d.eventMode}</span>
      </p>
    );
  }
  if (entry.action === 'clear_all_queues' && d.entriesCleared != null) {
    return (
      <p className="text-xs text-slate-400">
        <span className="font-semibold text-slate-300">{d.entriesCleared}</span>
        {d.entriesCleared === 1 ? ' queue entry' : ' queue entries'} cleared
      </p>
    );
  }
  if (entry.action === 'queue_remove' && d.itemName) {
    return (
      <p className="text-xs text-slate-400">
        Item:{' '}
        <span className="font-semibold text-slate-200">
          {displayAuctionItemName(d.itemName)}
        </span>
        {d.itemType ? (
          <>
            <span className="text-slate-600"> · </span>
            <span className="font-mono text-[10px] uppercase tracking-wide text-slate-500">
              {d.itemType}
            </span>
          </>
        ) : null}
      </p>
    );
  }
  return null;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 10;

export interface BidderAuditLogSectionProps {
  /** When true, refetch entries (e.g. tab became visible). */
  active: boolean;
}

export default function BidderAuditLogSection({ active }: BidderAuditLogSectionProps) {
  const [entries, setEntries] = useState<BidderAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<'all' | BidderAuditAction>('all');
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);
  const [pageSizeOpen, setPageSizeOpen] = useState(false);
  const pageSizeRef = React.useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchBidderAuditLog();
      setEntries(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load audit log');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (active) void load();
  }, [active, load]);

  useEffect(() => {
    const onChanged = () => {
      if (active) void load();
    };
    window.addEventListener(BIDDER_AUDIT_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(BIDDER_AUDIT_CHANGED_EVENT, onChanged);
  }, [active, load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (actionFilter !== 'all' && e.action !== actionFilter) return false;
      return entryMatchesSearch(e, q);
    });
  }, [entries, search, actionFilter]);

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
  }, [search, actionFilter, pageSize]);

  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!pageSizeOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!pageSizeRef.current?.contains(e.target as Node)) setPageSizeOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPageSizeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [pageSizeOpen]);

  return (
    <section className="space-y-4" aria-label="Admin audit log">
      <div className="space-y-3">
            <div className="relative min-w-0 w-full">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search IGN, admin, action…"
                className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                aria-label="Search bidder audit log"
              />
            </div>
            <div
              className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:thin] sm:flex-wrap sm:overflow-visible"
              role="group"
              aria-label="Filter by action"
            >
              {ACTION_FILTERS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActionFilter(id)}
                  className={`shrink-0 cursor-pointer rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors sm:text-xs ${
                    actionFilter === id
                      ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-900/25'
                      : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {error ? (
            <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm font-medium text-rose-200">
              {error}
            </p>
          ) : null}

          {loading && entries.length === 0 ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm font-medium text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              Loading audit log…
            </p>
          ) : entries.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
              <p className="font-medium text-slate-500">
                No audit entries yet. Approve, reject, edit, or delete bidders on the{' '}
                <strong className="text-slate-300">Bidders</strong> tab — actions will
                appear here with timestamp and admin name.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center font-medium text-slate-500">
              No entries match this filter or search.
            </p>
          ) : (
            <>
              <ul className="space-y-2.5">
                {pageRows.map((row) => (
                  <AuditLogCard key={row.id} row={row} />
                ))}
              </ul>
              <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="font-black uppercase tracking-widest text-slate-500">
                      Per page
                    </span>
                    <div ref={pageSizeRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setPageSizeOpen((v) => !v)}
                        aria-haspopup="listbox"
                        aria-expanded={pageSizeOpen}
                        className="inline-flex min-w-[52px] cursor-pointer items-center justify-between gap-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-black text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
                      >
                        {pageSize}
                        <ChevronDown
                          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                            pageSizeOpen ? 'rotate-180' : ''
                          }`}
                          aria-hidden
                        />
                      </button>
                      {pageSizeOpen ? (
                        <ul
                          role="listbox"
                          className="absolute bottom-full left-0 z-20 mb-1 min-w-full overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl"
                        >
                          {PAGE_SIZE_OPTIONS.map((n) => (
                            <li key={n} role="option" aria-selected={pageSize === n}>
                              <button
                                type="button"
                                onClick={() => {
                                  setPageSize(n);
                                  setPageSizeOpen(false);
                                }}
                                className={`block w-full cursor-pointer px-3 py-1.5 text-left text-xs font-bold transition-colors hover:bg-slate-800 ${
                                  pageSize === n ? 'text-blue-400' : 'text-slate-200'
                                }`}
                              >
                                {n}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                  <span className="text-slate-500">
                    {startIndex + 1}–{endIndex} of {filtered.length}
                  </span>
                </div>
                <div className="flex items-center justify-end gap-1">
                  <span className="mr-2 hidden font-bold text-slate-400 sm:inline">
                    Page {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage(1)}
                    disabled={currentPage <= 1}
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="First page"
                  >
                    <ChevronsLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage <= 1}
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Previous page"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden />
                  </button>
                  <span className="px-2 font-bold text-slate-200 sm:hidden">
                    {currentPage}/{totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Next page"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage(totalPages)}
                    disabled={currentPage >= totalPages}
                    className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label="Last page"
                  >
                    <ChevronsRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              </div>
            </>
          )}
    </section>
  );
}
