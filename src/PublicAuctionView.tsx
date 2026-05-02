/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, CheckCircle2, Gavel, History, LayoutDashboard, RefreshCw, UserPlus } from 'lucide-react';
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

/** Draw-winner count badge — same palette as `typeColors` for that item type. */
const drawWinnerBadge: Record<
  ItemType,
  { box: string; label: string; count: string; sub: string; subMuted: string }
> = {
  'Fragment Card': {
    box: 'border-purple-500/45 bg-purple-500/18 shadow-md shadow-purple-900/20',
    label: 'text-purple-400',
    count: 'text-purple-100',
    sub: 'text-purple-200',
    subMuted: 'text-purple-400/95',
  },
  LND: {
    box: 'border-blue-500/45 bg-blue-500/18 shadow-md shadow-blue-900/20',
    label: 'text-blue-400',
    count: 'text-blue-100',
    sub: 'text-blue-200',
    subMuted: 'text-blue-400/95',
  },
  TNS: {
    box: 'border-amber-500/45 bg-amber-500/18 shadow-md shadow-amber-900/18',
    label: 'text-amber-400',
    count: 'text-amber-100',
    sub: 'text-amber-200',
    subMuted: 'text-amber-500/95',
  },
  'Ancient Item': {
    box: 'border-red-500/45 bg-red-500/18 shadow-md shadow-red-900/20',
    label: 'text-red-400',
    count: 'text-red-100',
    sub: 'text-red-200',
    subMuted: 'text-red-400/95',
  },
  Other: {
    box: 'border-slate-500/45 bg-slate-600/35 shadow-md shadow-slate-900/25',
    label: 'text-slate-400',
    count: 'text-slate-100',
    sub: 'text-slate-200',
    subMuted: 'text-slate-400',
  },
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
        <div className="max-w-screen-2xl mx-auto flex flex-col gap-4 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-900/20">
              <Gavel className="h-6 w-6 text-white" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-white sm:text-2xl">
                Outlast Guild Bid
              </h1>
              <p className="text-sm font-medium text-slate-400">
                Queues &amp; bidding history{' '}
                <span className="rounded-md border border-slate-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-slate-300">
                  Join queues
                </span>
              </p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
            <nav
              className="flex w-full sm:w-auto rounded-2xl border border-slate-800 bg-slate-900 p-1 gap-1"
              aria-label="Public views"
            >
              <button
                type="button"
                onClick={() => setActiveTab('queues')}
                className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                  activeTab === 'queues'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <LayoutDashboard className="h-4 w-4 shrink-0" aria-hidden />
                Queues
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('logs')}
                className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                  activeTab === 'logs'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:bg-slate-800/80 hover:text-white'
                }`}
              >
                <History className="h-4 w-4 shrink-0" aria-hidden />
                Logs
              </button>
            </nav>
            <button
              type="button"
              onClick={() => void load({ silent: true })}
              disabled={refreshing}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50 sm:w-auto"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${refreshing ? 'animate-spin' : ''}`} aria-hidden />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-10 sm:px-8 sm:py-12">
        <div className="mx-auto max-w-screen-2xl space-y-8">
          <p className="text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">
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
                className="space-y-8"
              >
                {activeItems.length === 0 ? (
                  <div className="rounded-[2rem] border border-dashed border-slate-800 bg-slate-900/40 p-24 text-center">
                    <p className="font-medium text-slate-500">No active auction items right now.</p>
                  </div>
                ) : (
                  <div className="grid min-w-0 grid-cols-1 items-start gap-8 md:grid-cols-2 xl:grid-cols-3 xl:gap-6 2xl:gap-8">
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
                <h2 className="mb-8 text-2xl font-bold text-white">Bidding history</h2>
                {historyItems.length === 0 ? (
                  <div className="rounded-[2rem] border border-dashed border-slate-800 bg-slate-900/40 p-24 text-center">
                    <p className="font-medium text-slate-500">No completed auctions yet.</p>
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.id}
                      className="group flex items-center justify-between rounded-3xl border border-slate-800 bg-slate-900 p-6 transition-all hover:border-slate-700"
                    >
                      <div className="flex items-center gap-8">
                        <div className="rounded-2xl bg-slate-800 p-4">
                          <CheckCircle2 className="h-6 w-6 text-green-500" aria-hidden />
                        </div>
                        <div>
                          <h3 className="mb-1 text-xl font-bold text-white">
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
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
        className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 overflow-hidden shadow-2xl"
      >
        <h3 className="text-2xl font-black text-white mb-8">{title}</h3>
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
  const dw = drawWinnerBadge[item.type];

  return (
    <motion.article
      layout
      className="w-full min-w-0 max-w-full self-start rounded-[2.5rem] border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8"
    >
      <div className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <span
            className={`inline-block rounded-lg border px-3 py-1 font-mono text-[10px] font-black uppercase tracking-[0.2em] ${typeColors[item.type]}`}
          >
            {item.type}
          </span>
          <h2 className="mt-4 text-3xl font-black leading-none tracking-tight text-white">
            {displayAuctionItemName(item.name)}
          </h2>
        </div>
        <div
          className={`flex shrink-0 flex-col items-center rounded-2xl border px-3 py-2.5 text-center sm:px-3.5 sm:py-3 ${dw.box}`}
          title={`After shuffle, only the top ${winnerPickPoolSize} in this queue are in the winner draw (same as admin shortlist).`}
        >
          <span
            className={`text-[9px] font-black uppercase tracking-[0.18em] ${dw.label}`}
          >
            Draw winner
          </span>
          <span
            className={`my-0.5 font-mono text-[1.65rem] font-black leading-none tabular-nums sm:text-3xl [text-decoration:none] ${dw.count}`}
          >
            {winnerPickPoolSize}
          </span>
          <span
            className={`max-w-[7.5rem] text-[9px] font-bold leading-snug [text-decoration:none] ${dw.sub}`}
          >
            {winnerPickPoolSize === 1
              ? 'Only 1 can win'
              : `Only ${winnerPickPoolSize} can win`}
            <span
              className={`mt-0.5 block font-semibold [text-decoration:none] ${dw.subMuted}`}
            >
              after shuffle
            </span>
          </span>
        </div>
      </div>

      <div className="rounded-3xl border border-slate-800 bg-slate-950 p-3 sm:p-4">
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
        <div className="mt-6">
          <button
            type="button"
            onClick={onRequestAddName}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-blue-500/40 bg-blue-600/15 py-4 text-sm font-black uppercase tracking-widest text-blue-200 transition-colors hover:border-blue-400/60 hover:bg-blue-600/25"
          >
            <UserPlus className="h-5 w-5 shrink-0" aria-hidden />
            Join this queue
          </button>
        </div>
      ) : null}
    </motion.article>
  );
}
