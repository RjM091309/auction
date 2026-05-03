/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock,
  History,
  LayoutDashboard,
  RefreshCw,
  Search,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Swal from 'sweetalert2';
import type { AuctionItem, AuctionState, GuildMember, ItemType } from './types';
import {
  PublicAddBidError,
  fetchAuctionState,
  publicAddBidToQueue,
} from './lib/apiState';
import {
  swal2AlreadyWonTypeThisWeek,
  swal2QueueAlreadyListed,
  swal2QueueAlreadyOnAnotherItem,
  swal2QueueMemberAdded,
} from './lib/sweetAlert2';
import { ignHasWeeklyTypeWin } from './lib/weeklyTypeWins';
import {
  dedupeIgnAcrossActiveQueues,
  pruneOrphanQueueMembers,
} from './lib/dedupeIgnAcrossQueues';
import { maxQueueSlotsAfterShuffle } from './lib/shuffleCaps';
import { displayAuctionItemName } from './lib/formatAuctionItemName';
import { formatAuctionLogTime } from './lib/formatAuctionLogTime';
import { isAuctionItemHidden } from './lib/hiddenAuctionItems';
import {
  BIDDER_STATE_LOSS,
  BIDDER_STATE_ONGOING,
  BIDDER_STATE_WIN,
  type BidderLogStateFilter,
  bidderLogEntryMatchesFilter,
  bidderLogEntryMatchesSearch,
  bidderStateBadgeClass,
  bidderStateLabel,
  countQueuedIgnByNormalized,
  sortBidderStateLogNewestFirst,
  summarizeBidderStateLog,
} from './lib/bidderStateLogUi';

const typeColors: Record<
  ItemType,
  string
> = {
  'Fragment Card': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
  LND: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  TNS: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  'Ancient Item': 'text-red-400 border-red-500/30 bg-red-500/10',
  Other: 'text-slate-400 border-slate-700 bg-slate-800',
};

export default function PublicAuctionView() {
  const [state, setState] = useState<AuctionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'queues' | 'logs'>('queues');
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [bidderLogFilter, setBidderLogFilter] =
    useState<BidderLogStateFilter>('all');
  const [bidderLogSubTab, setBidderLogSubTab] = useState<'ranking' | 'weekly'>(
    'ranking'
  );
  const [bidderLogSearch, setBidderLogSearch] = useState('');

  const queueModalItem = useMemo(
    () => state?.items.find((i) => i.id === queueNameModalItemId) ?? null,
    [state, queueNameModalItemId]
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const remote = await fetchAuctionState();
      if (remote) {
        setState(dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote)));
      } else if (!silent) {
        setState(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load({ silent: true }), 12_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (state?.shuffleLocked === true) {
      setQueueNameModalItemId(null);
      setQueueNameInput('');
    }
  }, [state?.shuffleLocked]);

  useEffect(() => {
    setBidderLogFilter((f) => (f === 'ongoing' ? 'all' : f));
  }, []);

  /** Kapag binuksan ang join modal, i-refresh ang state para hindi stale ang `weeklyTypeWins`. */
  useEffect(() => {
    if (queueNameModalItemId) void load({ silent: true });
  }, [queueNameModalItemId, load]);

  const handlePublicAddToQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queueNameInput.trim();
    const itemId = queueNameModalItemId;
    if (!raw || !itemId || queueSubmitting) return;

    setQueueSubmitting(true);
    try {
      const remote = await fetchAuctionState();
      if (!remote) {
        void Swal.fire({
          icon: 'error',
          title: 'Could not verify',
          text: 'Could not load latest queues. Check your connection and try again.',
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
        return;
      }

      const fresh = dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote));
      setState(fresh);

      const card = fresh.items.find((it) => it.id === itemId);
      if (!card) {
        void Swal.fire({
          icon: 'error',
          title: 'Item not found',
          text: 'This auction card is no longer available.',
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
        setQueueNameModalItemId(null);
        return;
      }
      if (card.status !== 'active') {
        void Swal.fire({
          icon: 'info',
          title: 'Not active',
          text: 'This auction is not open for bids.',
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
        return;
      }
      if (isAuctionItemHidden(card)) {
        void Swal.fire({
          icon: 'error',
          title: 'Not available',
          text: 'This item is not open for public bids.',
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
        return;
      }
      if (fresh.shuffleLocked === true) {
        void Swal.fire({
          icon: 'info',
          title: 'Join queue closed',
          text: 'Queue signup is closed until the next reset.',
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
        return;
      }

      const ignLower = raw.toLowerCase();
      const queueHasThisIgn = (it: AuctionItem) =>
        it.interestedMemberIds.some((mid) => {
          const n = fresh.members.find((m) => m.id === mid)?.name;
          return n != null && n.trim().toLowerCase() === ignLower;
        });

      if (queueHasThisIgn(card)) {
        void swal2QueueAlreadyListed({
          ign: raw,
          itemName: displayAuctionItemName(card.name),
        });
        return;
      }

      const otherCard = fresh.items.find(
        (it) =>
          it.status === 'active' && it.id !== itemId && queueHasThisIgn(it)
      );
      if (otherCard) {
        void swal2QueueAlreadyOnAnotherItem({
          ign: raw,
          otherItemName: displayAuctionItemName(otherCard.name),
        });
        return;
      }

      if (ignHasWeeklyTypeWin(fresh.weeklyTypeWins, raw, card.type)) {
        void swal2AlreadyWonTypeThisWeek({
          ign: raw,
          itemName: displayAuctionItemName(card.name),
        });
        return;
      }

      const next = await publicAddBidToQueue(itemId, raw);
      const normalized = dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(next));
      setState(normalized);

      void swal2QueueMemberAdded({
        ign: raw,
        itemName: displayAuctionItemName(card.name),
      });
      setQueueNameInput('');
      setQueueNameModalItemId(null);
    } catch (err) {
      if (err instanceof PublicAddBidError) {
        if (err.code === 'already_listed') {
          void swal2QueueAlreadyListed({
            ign: raw,
            itemName: displayAuctionItemName(
              err.extra?.itemName ?? queueModalItem?.name ?? 'this item'
            ),
          });
        } else if (err.code === 'on_other_item') {
          void swal2QueueAlreadyOnAnotherItem({
            ign: raw,
            otherItemName: displayAuctionItemName(
              err.extra?.otherItemName ?? 'another item'
            ),
          });
        } else if (err.code === 'already_won_type_this_week') {
          void swal2AlreadyWonTypeThisWeek({
            ign: raw,
            itemName: displayAuctionItemName(
              err.extra?.itemName ?? queueModalItem?.name ?? 'this item'
            ),
          });
        } else if (err.code === 'shuffle_locked') {
          void Swal.fire({
            icon: 'info',
            title: 'Join queue closed',
            text: err.message,
            background: '#020617',
            color: '#f1f5f9',
            confirmButtonColor: '#2563eb',
          });
        } else {
          void Swal.fire({
            icon: 'error',
            title: 'Could not add',
            text: err.message,
            background: '#020617',
            color: '#f1f5f9',
            confirmButtonColor: '#2563eb',
          });
        }
      } else {
        void Swal.fire({
          icon: 'error',
          title: 'Could not add',
          text: String(err),
          background: '#020617',
          color: '#f1f5f9',
          confirmButtonColor: '#2563eb',
        });
      }
    } finally {
      setQueueSubmitting(false);
    }
  };

  const activeItems = useMemo(
    () =>
      state?.items.filter(
        (i) => i.status === 'active' && !isAuctionItemHidden(i)
      ) ?? [],
    [state]
  );

  /** Match admin: if Fragment (etc.) is hidden, center 1–2 cards instead of a sparse grid. */
  const centerFewPublicQueueCards =
    activeItems.length > 0 && activeItems.length < 3;

  const bidderStateLogEntries = state?.bidderStateLog ?? [];

  const bidderStateLogEntriesSorted = useMemo(
    () => sortBidderStateLogNewestFirst(bidderStateLogEntries),
    [bidderStateLogEntries]
  );

  const queueIgnCounts = useMemo(
    () =>
      countQueuedIgnByNormalized(
        state?.items ?? [],
        state?.members ?? [],
        isAuctionItemHidden
      ),
    [state?.items, state?.members]
  );

  const bidderStatsByIgn = useMemo(
    () =>
      summarizeBidderStateLog(
        bidderStateLogEntriesSorted,
        state?.shuffleLocked === true,
        queueIgnCounts
      ),
    [bidderStateLogEntriesSorted, state?.shuffleLocked, queueIgnCounts]
  );

  /** Weekly list: win/loss only — ongoing rows stay in DB for ranking math but are not shown here. */
  const filteredBidderLogEntries = useMemo(
    () =>
      bidderStateLogEntriesSorted.filter(
        (row) =>
          row.state !== BIDDER_STATE_ONGOING &&
          bidderLogEntryMatchesFilter(row, bidderLogFilter) &&
          bidderLogEntryMatchesSearch(row, bidderLogSearch)
      ),
    [bidderStateLogEntriesSorted, bidderLogFilter, bidderLogSearch]
  );

  if (loading && !state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center">
        <p className="text-slate-500 text-sm font-medium">Loading live queues…</p>
      </div>
    );
  }

  if (!loading && !state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-center text-slate-400">Could not load queues. Check your connection or try again.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-xl bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-500"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4 lg:min-w-[12rem] lg:flex-1">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 p-0.5 ring-1 ring-slate-700 shadow-lg shadow-black/30 sm:h-12 sm:w-12">
              <img
                src="/images/OUTLAST_RO.png"
                alt="Outlast Guild"
                className="h-full w-full object-contain"
                width={48}
                height={48}
                decoding="async"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl md:text-2xl">
                Outlast Guild Bid
              </h1>
              <p className="mt-0.5 text-xs font-medium leading-snug text-slate-400 sm:text-sm">
                Queues &amp; bidding history{' '}
                <span className="whitespace-nowrap rounded-md border border-slate-600 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-slate-300 sm:px-2 sm:text-[10px]">
                  Join queues
                </span>
              </p>
            </div>
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch sm:justify-center lg:w-auto lg:flex-nowrap lg:justify-end lg:gap-3">
            <nav
              className="mx-auto flex w-full min-w-0 max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-1 sm:mx-0 sm:w-auto sm:min-w-0 lg:mx-0 lg:max-w-none"
              aria-label="Public views"
            >
              <button
                type="button"
                onClick={() => setActiveTab('queues')}
                className={`flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:flex-initial sm:px-4 sm:text-sm ${
                  activeTab === 'queues'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">Queues</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`flex min-h-11 min-w-0 flex-1 touch-manipulation items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:flex-initial sm:px-4 sm:text-sm ${
                  activeTab === 'logs'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <History className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">Logs</span>
              </button>
            </nav>
            <button
              type="button"
              onClick={() => void load({ silent: true })}
              disabled={refreshing}
              className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50 sm:w-auto sm:shrink-0"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="px-4 py-6 sm:px-6 sm:py-8 md:py-10 lg:px-8 lg:py-12">
        <div className="mx-auto max-w-screen-2xl space-y-5 sm:space-y-6 lg:space-y-8">
          <p className="px-1 text-center text-[9px] font-medium uppercase leading-relaxed tracking-wide text-slate-500 sm:text-[10px]">
            Data updates automatically about every 12 seconds.
          </p>

          <AnimatePresence mode="wait">
            {activeTab === 'queues' && (
              <motion.div
                key="pub-queues"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
                className="space-y-6 lg:space-y-8"
              >
                {activeItems.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center sm:rounded-[2rem] sm:p-20 md:p-24">
                    <p className="font-medium text-slate-500">No active auction items right now.</p>
                  </div>
                ) : (
                  <div
                    className={
                      centerFewPublicQueueCards
                        ? 'mx-auto flex min-w-0 w-full flex-wrap justify-center gap-5 sm:gap-6 md:gap-6 xl:gap-7 2xl:gap-8'
                        : 'mx-auto grid min-w-0 grid-cols-1 items-start gap-5 sm:gap-6 md:mx-auto md:max-w-2xl md:gap-6 lg:max-w-3xl xl:mx-0 xl:max-w-none xl:grid-cols-2 xl:gap-7 2xl:grid-cols-3 2xl:gap-8'
                    }
                  >
                    {activeItems.map((item) => (
                      <div
                        key={item.id}
                        className={
                          centerFewPublicQueueCards
                            ? activeItems.length === 1
                              ? 'w-full min-w-0 max-w-xl shrink-0 sm:max-w-2xl'
                              : 'w-full min-w-0 shrink-0 md:max-w-[calc(50%-1rem)] md:basis-[calc(50%-1rem)] xl:max-w-lg 2xl:max-w-xl'
                            : 'min-w-0'
                        }
                      >
                        <PublicQueueCard
                          item={item}
                          members={state?.members ?? []}
                          showWinnerShortlist={state?.winnerShortlistUiEnabled !== false}
                          showJoinQueue={state?.shuffleLocked !== true}
                          onRequestAddName={() => setQueueNameModalItemId(item.id)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'logs' && (
              <motion.div
                key="pub-logs"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.2 }}
                className="space-y-10"
              >
                <section className="space-y-4" aria-label="Bid outcomes">
                  <nav
                    className="mx-auto flex w-full min-w-0 max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-1 sm:mx-0"
                    aria-label="Ranking and weekly log"
                  >
                    <button
                      type="button"
                      onClick={() => setBidderLogSubTab('ranking')}
                      className={`flex min-h-10 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:px-4 sm:text-sm ${
                        bidderLogSubTab === 'ranking'
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      Ranking
                    </button>
                    <button
                      type="button"
                      onClick={() => setBidderLogSubTab('weekly')}
                      className={`flex min-h-10 min-w-0 flex-1 touch-manipulation items-center justify-center rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:px-4 sm:text-sm ${
                        bidderLogSubTab === 'weekly'
                          ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                          : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                      }`}
                    >
                      Weekly logs
                    </button>
                  </nav>

                  {bidderLogSubTab === 'ranking' &&
                    (bidderStatsByIgn.length > 0 ? (
                      <ul
                        className="space-y-2"
                        aria-label="Win and loss counts by bidder"
                      >
                        {bidderStatsByIgn.map((row) => (
                          <li
                            key={row.ign.toLowerCase()}
                            className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5"
                          >
                            <span className="min-w-0 break-words font-bold text-amber-400">
                              {row.ign}
                            </span>
                            <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-xs sm:text-sm">
                              <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-green-400">
                                <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                                  Win
                                </span>
                                {row.wins}
                              </span>
                              <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-rose-300">
                                <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                                  Loss
                                </span>
                                {row.losses}
                              </span>
                              <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-blue-300">
                                <span className="text-[9px] font-black uppercase tracking-wide text-slate-500 sm:text-[10px]">
                                  Ong
                                </span>
                                {row.ongoing}
                              </span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center sm:p-12">
                        <p className="text-sm font-medium text-slate-500">
                          No ranking yet. Join a queue or ask an admin to shuffle or mark a winner so Win /
                          Loss / Ongoing counts show up here.
                        </p>
                      </div>
                    ))}

                  {bidderLogSubTab === 'weekly' &&
                    (bidderStateLogEntries.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center sm:p-12">
                        <p className="text-sm font-medium text-slate-500">
                          No weekly log yet. After an admin runs <strong>Shuffle all queues</strong>, loss
                          and ongoing rows are written here; a green check means a win (
                          <code className="text-xs text-slate-400">bidder_state_log</code>).
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-nowrap sm:items-center sm:gap-4">
                          <div className="relative min-w-0 w-full sm:max-w-md">
                            <Search
                              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                              aria-hidden
                            />
                            <input
                              type="search"
                              value={bidderLogSearch}
                              onChange={(e) => setBidderLogSearch(e.target.value)}
                              placeholder="Search IGN, item, type…"
                              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                              aria-label="Search weekly log"
                            />
                          </div>
                          <div
                            className="flex flex-wrap justify-end gap-2 self-end sm:ml-auto sm:self-center sm:shrink-0"
                            role="group"
                            aria-label="Filter weekly log by outcome"
                          >
                            {(
                              [
                                ['all', 'All'] as const,
                                ['loss', 'Loss'] as const,
                                ['win', 'Win'] as const,
                              ] satisfies readonly [BidderLogStateFilter, string][]
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setBidderLogFilter(id)}
                                className={`rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors sm:px-4 sm:text-xs ${
                                  bidderLogFilter === id
                                    ? 'border-blue-500 bg-blue-600 text-white shadow-md shadow-blue-900/25'
                                    : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-500 hover:bg-slate-800 hover:text-white'
                                }`}
                              >
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {filteredBidderLogEntries.length === 0 ? (
                          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center text-sm font-medium text-slate-500">
                            No entries match this filter or search.
                          </p>
                        ) : (
                          <ul className="space-y-2">
                            {filteredBidderLogEntries.map((row, idx) => (
                              <li
                                key={
                                  row.id ??
                                  `${row.at}-${row.itemId}-${row.ign}-${row.state}-${idx}`
                                }
                                className="flex flex-col gap-1 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4"
                              >
                                <div className="flex min-w-0 items-center gap-3">
                                  <div
                                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${bidderStateBadgeClass(row.state)}`}
                                  >
                                    {row.state === BIDDER_STATE_WIN ? (
                                      <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                                    ) : row.state === BIDDER_STATE_ONGOING ? (
                                      <Clock className="h-4 w-4" aria-hidden />
                                    ) : (
                                      <XCircle className="h-4 w-4" aria-hidden />
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-bold text-white">
                                      <span className="text-amber-400">{row.ign}</span>
                                      <span className="text-slate-500"> · </span>
                                      <span className="text-slate-200">
                                        {displayAuctionItemName(row.itemName)}
                                      </span>
                                    </p>
                                    <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-500">
                                      {row.itemType}
                                      <span className="text-slate-600"> · </span>
                                      <span
                                        className={`font-sans font-semibold tracking-wide ${
                                          row.state === BIDDER_STATE_WIN
                                            ? 'text-green-400'
                                            : row.state === BIDDER_STATE_ONGOING
                                              ? 'text-blue-300'
                                              : 'text-rose-300'
                                        }`}
                                      >
                                        {bidderStateLabel(row.state)}
                                      </span>
                                      {row.poolCap != null &&
                                      row.queuePosition != null ? (
                                        <>
                                          <span className="text-slate-600"> · </span>
                                          <span className="text-slate-500">
                                            pool {row.poolCap} · #{row.queuePosition}
                                          </span>
                                        </>
                                      ) : null}
                                    </p>
                                  </div>
                                </div>
                                <time
                                  dateTime={new Date(row.at).toISOString()}
                                  className="shrink-0 self-end text-right font-mono text-xs font-semibold text-slate-400 sm:self-auto sm:text-right"
                                >
                                  {formatAuctionLogTime(row.at)}
                                </time>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ))}
                </section>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <AnimatePresence>
        {queueNameModalItemId && queueModalItem && (
          <PublicAddNameModal
            title="Add name to queue"
            onClose={() => {
              setQueueNameModalItemId(null);
              setQueueNameInput('');
            }}
          >
            <form key={queueNameModalItemId} onSubmit={handlePublicAddToQueue} className="space-y-6">
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                For:{' '}
                <span className="text-white font-bold">
                  {displayAuctionItemName(queueModalItem.name)}
                </span>
              </p>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">
                  Character name (IGN)
                </label>
                <input
                  autoFocus
                  required
                  placeholder="e.g. ShadowHunter"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={queueNameInput}
                  onChange={(e) => setQueueNameInput(e.target.value)}
                  disabled={queueSubmitting}
                />
              </div>
              <button
                type="submit"
                disabled={queueSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                {queueSubmitting ? 'Adding…' : 'Add to queue'}
              </button>
            </form>
          </PublicAddNameModal>
        )}
      </AnimatePresence>
    </div>
  );
}

function PublicAddNameModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4 md:p-6">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-md"
      />
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="relative max-h-[min(90dvh,720px)] w-full max-w-xl overflow-y-auto rounded-t-[2rem] border border-slate-800 border-b-0 bg-slate-900 p-6 pb-8 shadow-2xl sm:rounded-[2rem] sm:border-b sm:p-8 md:p-10"
      >
        <h3 className="mb-6 text-xl font-black text-white sm:mb-8 sm:text-2xl">{title}</h3>
        {children}
      </motion.div>
    </div>
  );
}

function PublicQueueCard({
  item,
  members,
  showWinnerShortlist,
  showJoinQueue,
  onRequestAddName,
}: {
  item: AuctionItem;
  members: GuildMember[];
  /** Same as admin: off after Reset / Unmark until Shuffle again. */
  showWinnerShortlist: boolean;
  /** Hidden after admin runs “Shuffle all queues” until Reset shuffle. */
  showJoinQueue: boolean;
  onRequestAddName: () => void;
}) {
  const shortlistSlots = showWinnerShortlist
    ? maxQueueSlotsAfterShuffle(item.type)
    : 0;

  /** Same cap as admin shortlist rows after “Shuffle all queues”. */
  const winnerPickPoolSize = maxQueueSlotsAfterShuffle(item.type);

  return (
    <motion.article
      layout
      className="w-full min-w-0 max-w-full self-start rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-2xl sm:rounded-[2rem] sm:p-6 md:rounded-[2.5rem] md:p-8"
    >
      <div className="mb-5 flex flex-col gap-4 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-lg border px-2.5 py-1 font-mono text-[9px] font-black uppercase tracking-[0.2em] sm:px-3 sm:text-[10px] ${typeColors[item.type]}`}
          >
            {item.type}
          </span>
          <h2 className="mt-3 break-words text-2xl font-black leading-tight tracking-tight text-white sm:mt-4 sm:text-3xl sm:leading-none">
            {displayAuctionItemName(item.name)}
          </h2>
        </div>
        <div
          className="flex w-full shrink-0 flex-row items-center justify-between gap-3 rounded-2xl border border-slate-600/45 bg-slate-800/50 px-4 py-3 text-left sm:w-auto sm:max-w-[9.5rem] sm:flex-col sm:items-center sm:justify-center sm:px-3 sm:py-2.5 sm:text-center md:px-3.5 md:py-3"
          title={`After shuffle, only the top ${winnerPickPoolSize} in this queue are in the winner draw (same as admin shortlist).`}
        >
          <div className="min-w-0 flex-1 sm:flex-none sm:text-center">
            <span className="block text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">
              Draw winner
            </span>
            <span className="mt-0.5 block font-mono text-2xl font-black leading-none tabular-nums text-slate-100 [text-decoration:none] sm:text-[1.65rem] md:text-3xl">
              {winnerPickPoolSize}
            </span>
          </div>
          <span className="max-w-[11rem] text-right text-[9px] font-bold leading-snug text-slate-400 [text-decoration:none] sm:max-w-[7.5rem] sm:text-center">
            {winnerPickPoolSize === 1
              ? 'Only 1 can win'
              : `Only ${winnerPickPoolSize} can win`}
            <span className="mt-0.5 block font-semibold text-slate-500 [text-decoration:none]">
              after shuffle
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:rounded-3xl sm:p-4">
        {item.interestedMemberIds.length === 0 ? (
          <p className="py-10 text-center text-xs font-bold text-slate-500">No bidders in this queue yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {item.interestedMemberIds.map((mid, idx) => {
              const m = members.find((x) => x.id === mid);
              if (!m) return null;
              const shortlist = idx < shortlistSlots;
              return (
                <li
                  key={mid}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${
                    shortlist ? 'border-blue-500/50 bg-blue-600/20' : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${
                        shortlist ? 'bg-blue-500 text-white' : 'bg-slate-800 text-slate-500'
                      }`}
                    >
                      {idx + 1}
                    </span>
                    <span className="min-w-0 flex-1 break-words font-bold leading-normal text-slate-200 [overflow-wrap:anywhere]">
                      {m.name}
                    </span>
                  </div>
                  {shortlist ? (
                    <div
                      className="pointer-events-none flex h-8 w-8 shrink-0 cursor-default select-none items-center justify-center rounded-lg bg-green-600/85 text-white shadow-sm shadow-green-950/30"
                      title="Shortlist slot after shuffle (read-only). Only an admin can mark winners in the dashboard."
                      aria-hidden
                    >
                      <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {showJoinQueue ? (
        <div className="mt-5 sm:mt-6">
          <button
            type="button"
            onClick={onRequestAddName}
            className="inline-flex min-h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-2xl border border-blue-500/40 bg-blue-600/15 py-3.5 text-sm font-black uppercase tracking-widest text-blue-200 transition-colors active:scale-[0.99] hover:border-blue-400/60 hover:bg-blue-600/25 sm:py-4"
          >
            <UserPlus className="h-5 w-5 shrink-0" aria-hidden />
            Join this queue
          </button>
        </div>
      ) : null}
    </motion.article>
  );
}
