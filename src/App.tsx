/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  History,
  Trash2,
  CheckCircle2,
  Check,
  LayoutDashboard,
  Shuffle,
  RotateCcw,
  Gavel,
  Pencil,
  GripVertical,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AuctionItem, AuctionState, ItemType, GuildMember } from './types';
import { saveState, loadState } from './lib/storage';
import { deactivateMemberOnServer, fetchAuctionState, persistAuctionState } from './lib/apiState';
import { randomId } from './lib/randomId';
import {
  swal2QueueMemberAdded,
  swal2QueueAlreadyListed,
  swal2QueueAlreadyOnAnotherItem,
  swal2NameAlreadyTaken,
  swal2MemberNameUpdated,
  swal2SaveError,
  swal2ConfirmRemoveMember,
  swal2ConfirmResetShuffleUnmark,
} from './lib/sweetAlert2';
import {
  dedupeIgnAcrossActiveQueues,
  pruneOrphanQueueMembers,
} from './lib/dedupeIgnAcrossQueues';
import {
  applyQueueMemberMove,
  parseQueueDragPayload,
  QUEUE_DRAG_MIME,
  type QueueMovePayload,
} from './lib/queueMove';
import { maxQueueSlotsAfterShuffle, shuffleQueueIdsForType } from './lib/shuffleCaps';

export default function App() {
  const [state, setState] = useState<AuctionState | null>(null);
  const mayPersist = useRef(false);
  const skipInitialPersist = useRef(1);
  const latestState = useRef<AuctionState | null>(null);
  latestState.current = state;
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');
  const [editMemberId, setEditMemberId] = useState<string | null>(null);
  const [editMemberNameInput, setEditMemberNameInput] = useState('');

  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ItemType>('Fragment Card');

  /** Full-width shuffle tension bar (0–100%) */
  const [shuffleUi, setShuffleUi] = useState<{ active: boolean; pct: number }>({
    active: false,
    pct: 0,
  });
  const shuffleRafRef = useRef<number | null>(null);
  const shuffleRunningRef = useRef(false);
  const shuffleUnmountRef = useRef(false);

  const queueModalItem = useMemo(
    () => state?.items.find((i) => i.id === queueNameModalItemId) ?? null,
    [state, queueNameModalItemId]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remote = await fetchAuctionState();
      if (cancelled) return;
      setState(
        dedupeIgnAcrossActiveQueues(
          pruneOrphanQueueMembers(remote ?? loadState())
        )
      );
      mayPersist.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    shuffleUnmountRef.current = false;
    return () => {
      shuffleUnmountRef.current = true;
      if (shuffleRafRef.current != null) {
        cancelAnimationFrame(shuffleRafRef.current);
        shuffleRafRef.current = null;
      }
      shuffleRunningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    saveState(state);
  }, [state]);

  useEffect(() => {
    if (!state || !mayPersist.current) return;
    if (skipInitialPersist.current > 0) {
      skipInitialPersist.current -= 1;
      return;
    }
    const id = window.setTimeout(() => {
      const snap = latestState.current;
      if (!snap) return;
      persistAuctionState(snap).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[api] persist failed', e);
          void swal2SaveError(msg || 'Unknown error');
        });
    }, 450);
    return () => window.clearTimeout(id);
  }, [state]);

  const activeAuctions = useMemo(
    () => state?.items.filter((item) => item.status === 'active') ?? [],
    [state]
  );

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    const newItem: AuctionItem = {
      id: randomId(),
      name: newItemName,
      type: newItemType,
      winnerName: null,
      status: 'active',
      interestedMemberIds: [],
      createdAt: Date.now(),
    };
    setState((prev) =>
      prev ? { ...prev, items: [newItem, ...prev.items] } : prev
    );
    setIsAddItemOpen(false);
    setNewItemName('');
  };

  const handleShuffleAllQueues = () => {
    if (!latestState.current || shuffleRunningRef.current) return;
    shuffleRunningRef.current = true;
    setShuffleUi({ active: true, pct: 0 });

    const durationMs = 2400;
    const t0 = performance.now();

    const tick = (now: number) => {
      if (shuffleUnmountRef.current) {
        shuffleRunningRef.current = false;
        shuffleRafRef.current = null;
        setShuffleUi({ active: false, pct: 0 });
        return;
      }
      const raw = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - raw, 2.8);
      const pct = Math.min(100, Math.round(eased * 100));
      setShuffleUi({ active: true, pct });

      if (raw < 1) {
        shuffleRafRef.current = requestAnimationFrame(tick);
        return;
      }

      shuffleRafRef.current = null;
      shuffleRunningRef.current = false;
      setState((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          winnerShortlistUiEnabled: true,
          items: prev.items.map((item) => {
            if (item.status !== 'active') return item;
            return {
              ...item,
              interestedMemberIds: shuffleQueueIdsForType(
                item.interestedMemberIds,
                item.type
              ),
            };
          }),
        };
      });
      setShuffleUi({ active: false, pct: 0 });
    };

    shuffleRafRef.current = requestAnimationFrame(tick);
  };

  const handleResetShuffleUnmarkAll = async () => {
    if (!state) return;
    const ok = await swal2ConfirmResetShuffleUnmark();
    if (!ok) return;
    setState((prev) => {
      if (!prev) return prev;
      const ignKey = (memberId: string) => {
        const n = prev.members.find((m) => m.id === memberId)?.name?.trim() ?? '';
        return n.toLowerCase();
      };
      return {
        ...prev,
        winnerShortlistUiEnabled: false,
        items: prev.items.map((item) => {
          const reopened = {
            ...item,
            status: 'active' as const,
            winnerName: null,
          };
          const ids = [...reopened.interestedMemberIds].sort((a, b) => {
            const ka = ignKey(a);
            const kb = ignKey(b);
            const c = ka.localeCompare(kb, undefined, { sensitivity: 'base' });
            if (c !== 0) return c;
            return a.localeCompare(b);
          });
          return { ...reopened, interestedMemberIds: ids };
        }),
      };
    });
  };

  const handleQueueMove = (payload: QueueMovePayload) => {
    if (!state) return;
    const next = applyQueueMemberMove(state, payload);
    if ('error' in next) {
      if (next.error === 'name_conflict' && next.toItemName) {
        const ign =
          state.members.find((m) => m.id === payload.memberId)?.name ?? '';
        void swal2QueueAlreadyOnAnotherItem({
          ign,
          otherItemName: next.toItemName,
        });
      }
      return;
    }
    setState(next);
  };

  const handleCompleteAuction = (itemId: string, winnerName: string | null) => {
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.id === itemId ? { ...item, status: 'completed', winnerName } : item
        ),
      };
    });
  };

  const handleDeactivateMember = async (memberId: string) => {
    if (!state) return;
    const m = state.members.find((x) => x.id === memberId);
    if (!m) return;
    const ok = await swal2ConfirmRemoveMember(m.name);
    if (!ok) return;
    try {
      const next = await deactivateMemberOnServer(memberId);
      setState(dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(next)));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      void swal2SaveError(msg || 'Could not remove bidder');
    }
  };

  const openQueueNameModal = (itemId: string) => {
    setEditMemberId(null);
    setEditMemberNameInput('');
    setQueueNameModalItemId(itemId);
    setQueueNameInput('');
  };

  const openEditMember = (memberId: string) => {
    if (!state) return;
    const m = state.members.find((x) => x.id === memberId);
    if (!m) return;
    setQueueNameModalItemId(null);
    setQueueNameInput('');
    setEditMemberId(memberId);
    setEditMemberNameInput(m.name);
  };

  const handleSaveEditMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state || !editMemberId) return;
    const raw = editMemberNameInput.trim();
    if (!raw) return;

    const ignLower = raw.toLowerCase();
    const taken = state.members.some(
      (m) => m.id !== editMemberId && m.name.trim().toLowerCase() === ignLower
    );
    if (taken) {
      void swal2NameAlreadyTaken();
      return;
    }

    const prevName =
      state.members.find((m) => m.id === editMemberId)?.name.trim() ?? '';
    if (prevName === raw) {
      setEditMemberId(null);
      setEditMemberNameInput('');
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        members: prev.members.map((m) =>
          m.id === editMemberId ? { ...m, name: raw } : m
        ),
      };
    });
    setEditMemberId(null);
    setEditMemberNameInput('');
    void swal2MemberNameUpdated({ previousName: prevName, newName: raw });
  };

  const handleAddNameToQueue = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queueNameInput.trim();
    const itemId = queueNameModalItemId;
    if (!raw || !itemId || !state) return;

    const card = state.items.find((it) => it.id === itemId);
    if (!card) return;

    const ignLower = raw.toLowerCase();
    const queueHasThisIgn = (it: AuctionItem) =>
      it.interestedMemberIds.some((mid) => {
        const n = state.members.find((m) => m.id === mid)?.name;
        return n != null && n.trim().toLowerCase() === ignLower;
      });

    if (queueHasThisIgn(card)) {
      void swal2QueueAlreadyListed({
        ign: raw,
        itemName: card.name,
      });
      setQueueNameInput('');
      setQueueNameModalItemId(null);
      return;
    }

    const otherCard = state.items.find(
      (it) =>
        it.status === 'active' &&
        it.id !== itemId &&
        queueHasThisIgn(it)
    );
    if (otherCard) {
      void swal2QueueAlreadyOnAnotherItem({
        ign: raw,
        otherItemName: otherCard.name,
      });
      setQueueNameInput('');
      setQueueNameModalItemId(null);
      return;
    }

    const existing = state.members.find(
      (m) => m.name.toLowerCase() === ignLower
    );
    const memberId = existing?.id ?? randomId();

    setState((prev) => {
      if (!prev) return prev;
      const ex = prev.members.find((m) => m.name.toLowerCase() === ignLower);
      const mid = ex?.id ?? memberId;
      const members = ex
        ? prev.members
        : [...prev.members, { id: mid, name: raw, role: 'Member' as const }];

      const items = prev.items.map((it) => {
        if (it.id !== itemId) return it;
        if (it.interestedMemberIds.includes(mid)) return it;
        return { ...it, interestedMemberIds: [...it.interestedMemberIds, mid] };
      });

      return { ...prev, members, items };
    });

    void swal2QueueMemberAdded({
      ign: raw,
      itemName: card.name,
    });

    setQueueNameInput('');
    setQueueNameModalItemId(null);
  };

  if (!state) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 font-sans flex items-center justify-center">
        <p className="text-slate-500 text-sm font-medium">Loading auction…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/90 backdrop-blur-md">
        <div className="max-w-screen-2xl mx-auto px-6 sm:px-8 py-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4 min-w-0">
            <div className="shrink-0 w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Gavel className="text-white w-6 h-6" aria-hidden />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate underline decoration-blue-600/50 decoration-4 underline-offset-4">
                Outlast Guild Bid
              </h1>
              <p className="text-slate-400 text-sm font-medium">Auction queue</p>
            </div>
          </div>
          <nav
            className="flex w-full sm:w-auto rounded-2xl bg-slate-900 p-1 border border-slate-800 gap-1"
            aria-label="Main"
          >
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                activeTab === 'dashboard'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" aria-hidden />
              Queues
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                activeTab === 'history'
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
              }`}
            >
              <History className="w-4 h-4 shrink-0" aria-hidden />
              Logs
            </button>
          </nav>
        </div>
      </header>

      <main className="min-h-screen">
        <div className="max-w-screen-2xl mx-auto px-6 sm:px-8 py-10 sm:py-12">
          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-8"
              >
                {activeAuctions.length > 0 && (
                  <div className="flex w-full min-w-0 flex-col items-stretch gap-3 sm:items-end">
                    <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                      <p className="max-w-md text-right text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Drag <GripVertical className="inline h-3 w-3 align-text-bottom text-slate-400" aria-hidden /> to
                        move a bid to another card or reorder. Shuffle randomizes the full queue; only the top Frag 2 /
                        LND 6 / TNS 8 slots show the winner checkmark. Reset sorts A–Z, clears winner marks, and hides
                        checks until you shuffle again.
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={handleShuffleAllQueues}
                          disabled={shuffleUi.active}
                          aria-busy={shuffleUi.active}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-blue-600 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Shuffle className="h-4 w-4 shrink-0" aria-hidden />
                          Shuffle all queues
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResetShuffleUnmarkAll()}
                          disabled={shuffleUi.active}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-amber-700 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
                          Reset shuffle / Unmark all
                        </button>
                      </div>
                    </div>
                    <AnimatePresence>
                      {shuffleUi.active && (
                        <motion.div
                          key="shuffle-progress"
                          role="progressbar"
                          aria-valuenow={shuffleUi.pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Shuffling auction queues"
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.22 }}
                          className="w-full overflow-hidden rounded-2xl border border-blue-500/50 bg-slate-950/95 px-4 py-3 shadow-[0_0_32px_rgba(37,99,235,0.35)] ring-1 ring-blue-400/20"
                        >
                          <div className="mb-2 flex items-baseline justify-between gap-3">
                            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-blue-300">
                              Shuffling queues
                            </span>
                            <span className="font-mono text-sm font-black tabular-nums text-white">
                              {shuffleUi.pct}
                              <span className="text-blue-400">%</span>
                            </span>
                          </div>
                          <div className="relative h-3.5 w-full overflow-hidden rounded-full bg-slate-900 shadow-inner">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-blue-700 via-cyan-400 to-blue-500 shadow-[0_0_20px_rgba(34,211,238,0.65)]"
                              style={{ width: `${shuffleUi.pct}%` }}
                            />
                            <div
                              className="pointer-events-none absolute inset-0 animate-pulse rounded-full bg-gradient-to-r from-transparent via-white/25 to-transparent"
                              aria-hidden
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )}
                <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-2 xl:grid-cols-3 xl:gap-6 2xl:gap-8 min-w-0">
                  <AnimatePresence>
                    {activeAuctions.map(item => (
                      <QueueCard 
                        key={item.id} 
                        item={item} 
                        members={state.members}
                        showWinnerShortlist={state.winnerShortlistUiEnabled !== false}
                        onOpenAddName={openQueueNameModal}
                        onEditMember={openEditMember}
                        onDeactivateMember={handleDeactivateMember}
                        onMoveQueueMember={handleQueueMove}
                        onComplete={handleCompleteAuction}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                {activeAuctions.length === 0 && (
                  <div className="bg-slate-900/40 border border-dashed border-slate-800 rounded-[2rem] p-24 text-center">
                    <p className="text-slate-500 font-medium">No items listed. Use Add Item to get started.</p>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'history' && (
              <motion.div 
                key="history"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                className="space-y-6"
              >
                <h2 className="text-2xl font-bold text-white mb-8">Bidding History</h2>
                {state.items.filter(i => i.status !== 'active').map(item => (
                  <div key={item.id} className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex justify-between items-center group transition-all hover:border-slate-700">
                    <div className="flex items-center gap-8">
                       <div className="p-4 bg-slate-800 rounded-2xl">
                          <CheckCircle2 className="text-green-500 w-6 h-6" />
                       </div>
                       <div>
                          <h3 className="text-xl font-bold text-white mb-1">{item.name}</h3>
                          <p className="text-[10px] font-black uppercase text-slate-500 tracking-[0.1em] font-mono">Won by: <span className="text-amber-400">{item.winnerName || 'No taker'}</span></p>
                       </div>
                    </div>
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {queueNameModalItemId && queueModalItem && (
          <Modal
            title="Add name to queue"
            onClose={() => {
              setQueueNameModalItemId(null);
              setQueueNameInput('');
            }}
          >
            <form key={queueNameModalItemId} onSubmit={handleAddNameToQueue} className="space-y-6">
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                For: <span className="text-white font-bold">{queueModalItem.name}</span>
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
                  onChange={e => setQueueNameInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Add to queue
              </button>
            </form>
          </Modal>
        )}

        {editMemberId && (
          <Modal
            title="Edit character name"
            onClose={() => {
              setEditMemberId(null);
              setEditMemberNameInput('');
            }}
          >
            <form
              key={editMemberId}
              onSubmit={handleSaveEditMember}
              className="space-y-6"
            >
              <p className="text-sm text-slate-400 font-medium leading-relaxed">
                Fix a typo or wrong IGN. This updates the name everywhere it appears in queues.
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
                  value={editMemberNameInput}
                  onChange={(e) => setEditMemberNameInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Save name
              </button>
            </form>
          </Modal>
        )}

        {isAddItemOpen && (
          <Modal title="New bid item" onClose={() => setIsAddItemOpen(false)}>
            <form onSubmit={handleAddItem} className="space-y-8">
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">Item name</label>
                <input 
                  autoFocus required
                  placeholder="e.g. Puppet Card, +15 Ancient gear"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">Type</label>
                <select 
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold focus:outline-none focus:ring-2 focus:ring-blue-600/50 appearance-none"
                  value={newItemType}
                  onChange={e => setNewItemType(e.target.value as ItemType)}
                >
                  <option value="Fragment Card">Fragment Card</option>
                  <option value="LND">Light And Dark Feathers</option>
                  <option value="TNS">Time And Space Feathers</option>
                  <option value="Ancient Item">Ancient gear</option>
                  <option value="Other">Miscellaneous</option>
                </select>
              </div>
              <button 
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Confirm Add Item
              </button>
            </form>
          </Modal>
        )}

      </AnimatePresence>
    </div>
  );
}

function QueueCard({
  item,
  members,
  showWinnerShortlist,
  onOpenAddName,
  onEditMember,
  onDeactivateMember,
  onMoveQueueMember,
  onComplete,
}: {
  key?: React.Key;
  item: AuctionItem;
  members: GuildMember[];
  /** When false, no shortlist row styling or green “mark winner” buttons (after Reset / Unmark). */
  showWinnerShortlist: boolean;
  onOpenAddName: (itemId: string) => void;
  onEditMember: (memberId: string) => void;
  onDeactivateMember: (memberId: string) => void | Promise<void>;
  onMoveQueueMember: (p: QueueMovePayload) => void;
  onComplete: (id: string, winner: string | null) => void;
}) {
  const [dropHighlight, setDropHighlight] = useState(false);

  const typeColors = {
    'Fragment Card': 'text-purple-400 border-purple-500/30 bg-purple-500/10',
    'LND': 'text-blue-400 border-blue-500/30 bg-blue-500/10',
    'TNS': 'text-amber-400 border-amber-500/30 bg-amber-500/10',
    'Ancient Item': 'text-red-400 border-red-500/30 bg-red-500/10',
    'Other': 'text-slate-400 border-slate-700 bg-slate-800'
  };

  /** Rows that can be marked winner — Frag 2 / LND 6 / TNS 8; else top 1; 0 when shortlist UI is off after reset. */
  const shortlistSlots = showWinnerShortlist
    ? maxQueueSlotsAfterShuffle(item.type) ?? 1
    : 0;

  return (
    <motion.div 
      layout
      onClick={() => onOpenAddName(item.id)}
      title="Click to add a name to this queue"
      className="group h-auto w-full min-w-0 max-w-full self-start bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 shadow-2xl sm:p-8 flex flex-col gap-5 sm:gap-6 cursor-pointer transition-[border-color,box-shadow,background-color,transform] duration-200 ease-out hover:border-blue-500/45 hover:bg-slate-800/60 hover:shadow-blue-900/25 hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
    >
      <div className="flex justify-between items-start">
        <div>
          <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-lg border font-mono ${typeColors[item.type]}`}>
            {item.type}
          </span>
          <h3 className="text-3xl font-black text-white mt-4 tracking-tight leading-none">{item.name}</h3>
        </div>
      </div>

      <div
        className={`bg-slate-950 border border-slate-800 rounded-3xl p-3 sm:p-4 flex flex-col gap-2 min-w-0 transition-shadow ${
          dropHighlight ? 'ring-2 ring-blue-500/50 ring-offset-2 ring-offset-slate-900' : ''
        }`}
        onDragEnter={(e) => {
          if (Array.from(e.dataTransfer.types || []).includes(QUEUE_DRAG_MIME)) {
            setDropHighlight(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setDropHighlight(false);
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
        }}
      >
        <AnimatePresence mode="popLayout">
          {item.interestedMemberIds.length === 0 ? (
            <div
              className="flex min-h-[120px] flex-col items-center justify-center gap-2 p-8"
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropHighlight(false);
                const d = parseQueueDragPayload(e);
                if (!d) return;
                onMoveQueueMember({
                  fromItemId: d.fromItemId,
                  toItemId: item.id,
                  memberId: d.memberId,
                  insertBeforeMemberId: null,
                });
              }}
            >
              <p className="text-xs text-slate-500 font-bold text-center">
                No one in queue yet. Click the card to add a name.
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                Or drop a bid here to move it to this card
              </p>
            </div>
          ) : (
            <>
              {item.interestedMemberIds.map((mid, idx) => {
                const m = members.find((member) => member.id === mid);
                if (!m) return null;
                return (
                  <motion.div
                    layout
                    key={mid}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      e.dataTransfer.dropEffect = 'move';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDropHighlight(false);
                      const d = parseQueueDragPayload(e);
                      if (!d) return;
                      if (d.fromItemId === item.id && d.memberId === mid) return;
                      onMoveQueueMember({
                        fromItemId: d.fromItemId,
                        toItemId: item.id,
                        memberId: d.memberId,
                        insertBeforeMemberId: mid,
                      });
                    }}
                    className={`flex min-h-10 items-center justify-between gap-2 p-2.5 sm:p-3 rounded-2xl border ${
                      idx < shortlistSlots
                        ? 'bg-blue-600/20 border-blue-500/50'
                        : 'bg-slate-900 border-slate-800'
                    } transition-all`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex shrink-0 items-center gap-2">
                        <div
                          draggable
                          title="Drag to another card or row"
                          onDragStart={(e) => {
                            e.stopPropagation();
                            e.dataTransfer.setData(
                              QUEUE_DRAG_MIME,
                              JSON.stringify({ fromItemId: item.id, memberId: mid })
                            );
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragEnd={(e) => {
                            e.stopPropagation();
                            setDropHighlight(false);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="-ml-0.5 flex h-8 w-7 shrink-0 cursor-grab items-center justify-center rounded-lg text-slate-500 active:cursor-grabbing hover:bg-slate-800 hover:text-slate-300"
                          aria-label="Drag to move bid"
                        >
                          <GripVertical className="h-4 w-4" aria-hidden />
                        </div>
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black ${
                            idx < shortlistSlots
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-800 text-slate-500'
                          }`}
                        >
                          {idx + 1}
                        </span>
                      </div>
                      <span
                        title={m.name}
                        className="min-w-0 flex-1 break-words font-bold leading-normal text-slate-200 [overflow-wrap:anywhere]"
                      >
                        {m.name}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditMember(mid);
                        }}
                        title="Edit name"
                        aria-label="Edit character name"
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onDeactivateMember(mid);
                        }}
                        title="Remove bidder (inactive in DB)"
                        aria-label={`Remove ${m.name} from roster`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-950/50 hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                      {idx < shortlistSlots && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onComplete(item.id, m.name);
                          }}
                          title="Mark this person as winner"
                          aria-label={`Mark ${m.name} as winner`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500 text-white hover:bg-green-400 transition-colors active:scale-95"
                        >
                          <Check className="h-4 w-4 stroke-[2.5]" />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
              <div
                className="mt-1 flex min-h-8 items-center justify-center rounded-lg border border-dashed border-transparent py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:border-slate-700"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setDropHighlight(false);
                  const d = parseQueueDragPayload(e);
                  if (!d) return;
                  onMoveQueueMember({
                    fromItemId: d.fromItemId,
                    toItemId: item.id,
                    memberId: d.memberId,
                    insertBeforeMemberId: null,
                  });
                }}
              >
                Drop at end of queue
              </div>
            </>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Modal({ title, children, onClose }: { title: string, children: React.ReactNode, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} className="absolute inset-0 bg-slate-950/80 backdrop-blur-md" />
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative w-full max-w-xl bg-slate-900 border border-slate-800 rounded-[2.5rem] p-10 overflow-hidden shadow-2xl">
        <h3 className="text-2xl font-black text-white mb-8">{title}</h3>
        {children}
      </motion.div>
    </div>
  );
}
