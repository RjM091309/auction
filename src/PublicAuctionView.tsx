/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, History, LayoutDashboard, RefreshCw, UserPlus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import Swal from 'sweetalert2';
import type { AuctionItem, AuctionState, GuildMember, ItemType } from './types';
import {
  PublicAddBidError,
  fetchAuctionState,
  publicAddBidToQueue,
} from './lib/apiState';
import {
  swal2QueueAlreadyListed,
  swal2QueueAlreadyOnAnotherItem,
  swal2QueueMemberAdded,
} from './lib/sweetAlert2';
import {
  dedupeIgnAcrossActiveQueues,
  pruneOrphanQueueMembers,
} from './lib/dedupeIgnAcrossQueues';
import { maxQueueSlotsAfterShuffle } from './lib/shuffleCaps';
import { displayAuctionItemName } from './lib/formatAuctionItemName';

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

  const handlePublicAddToQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queueNameInput.trim();
    const itemId = queueNameModalItemId;
    if (!raw || !itemId || !state || !queueModalItem) return;

    setQueueSubmitting(true);
    try {
      const next = await publicAddBidToQueue(itemId, raw);
      setState(dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(next)));
      void swal2QueueMemberAdded({
        ign: raw,
        itemName: displayAuctionItemName(queueModalItem.name),
      });
      setQueueNameInput('');
      setQueueNameModalItemId(null);
    } catch (err) {
      if (err instanceof PublicAddBidError) {
        if (err.code === 'already_listed') {
          void swal2QueueAlreadyListed({
            ign: raw,
            itemName: displayAuctionItemName(queueModalItem.name),
          });
        } else if (err.code === 'on_other_item') {
          void swal2QueueAlreadyOnAnotherItem({
            ign: raw,
            otherItemName: displayAuctionItemName(
              err.extra?.otherItemName ?? 'another item'
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
    () => state?.items.filter((i) => i.status === 'active') ?? [],
    [state]
  );

  const historyItems = useMemo(
    () => state?.items.filter((i) => i.status !== 'active') ?? [],
    [state]
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
                  <div className="mx-auto grid min-w-0 grid-cols-1 items-start gap-5 sm:gap-6 md:mx-auto md:max-w-2xl md:gap-6 lg:max-w-3xl xl:mx-0 xl:max-w-none xl:grid-cols-2 xl:gap-7 2xl:grid-cols-3 2xl:gap-8">
                    {activeItems.map((item) => (
                      <div key={item.id} className="min-w-0">
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
                className="space-y-6"
              >
                <h2 className="mb-4 text-xl font-bold text-white sm:mb-8 sm:text-2xl">Bidding history</h2>
                {historyItems.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-12 text-center sm:rounded-[2rem] sm:p-20 md:p-24">
                    <p className="font-medium text-slate-500">No completed auctions yet.</p>
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="group flex flex-col gap-4 rounded-2xl border border-slate-800 bg-slate-900 p-4 transition-all hover:border-slate-700 sm:flex-row sm:items-center sm:justify-between sm:rounded-3xl sm:p-6"
                    >
                      <div className="flex min-w-0 items-start gap-4 sm:items-center sm:gap-6">
                        <div className="shrink-0 rounded-xl bg-slate-800 p-3 sm:rounded-2xl sm:p-4">
                          <CheckCircle2 className="h-5 w-5 text-green-500 sm:h-6 sm:w-6" aria-hidden />
                        </div>
                        <div className="min-w-0">
                          <h3 className="mb-1 break-words text-lg font-bold leading-snug text-white sm:text-xl">
                            {displayAuctionItemName(item.name)}
                          </h3>
                          <p className="font-mono text-[10px] font-black uppercase tracking-[0.1em] text-slate-500">
                            Won by:{' '}
                            <span className="text-amber-400">{item.winnerName || 'No taker'}</span>
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
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
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500 text-white shadow-sm shadow-green-900/40"
                      title="Winner shortlist (same as admin)"
                      aria-label="In winner shortlist"
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
