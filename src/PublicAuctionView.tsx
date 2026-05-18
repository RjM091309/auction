/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import type {
  AuctionItem,
  AuctionState,
  GuildMember,
  GuildRank,
  ItemType,
} from './types';
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
import {
  findOtherActiveQueueBlocking,
  shuffleLockClosesPublicSignup,
  weeklyTypeWinBlocksQueueJoin,
} from './lib/queueEligibility';
import {
  maxQueueSlotsAfterShuffle,
  shuffleQueueIdsForType,
} from './lib/shuffleCaps';
import { displayAuctionItemName } from './lib/formatAuctionItemName';
import { formatAuctionLogTime } from './lib/formatAuctionLogTime';
import { filterToCurrentAuctionWeek, getAuctionWeekMondayKey } from './lib/auctionWeek';
import { isAuctionItemHidden } from './lib/hiddenAuctionItems';
import {
  computeWinnerAssignmentLabelsFromItems,
  featherItemsPerWinnerUnit,
  featherPageCountBeforePartialFree,
  featherRewardSpanFourItemPages,
  fragmentGeneralPageSpan,
  freeItemsFromTotalItems,
  parseGuildRank,
  totalItemsForTypeByRank,
  winnerAssignmentLabelTitle,
  formatFreePoolPageDisplay,
  freePoolPageLabelTitle,
} from './lib/pageAssignment';
import {
  BIDDER_STATE_LOSS,
  BIDDER_STATE_ONGOING,
  BIDDER_STATE_WIN,
  type BidderLogStateFilter,
  buildBidderOutcomeDaysByIgnKey,
  bidderLogEntryMatchesFilter,
  bidderLogEntryMatchesSearch,
  bidderRankingRowMatchesSearch,
  bidderStateBadgeClass,
  bidderStateLabel,
  countQueuedIgnByNormalized,
  sortBidderStateLogNewestFirst,
  summarizeBidderStateLog,
} from './lib/bidderStateLogUi';
import { BidderRankingExpandableRows } from './components/BidderRankingExpandableRows';

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

const PUBLIC_STATE_POLL_MS_RAW = Number(import.meta.env.VITE_PUBLIC_STATE_POLL_MS ?? 4000);
const PUBLIC_STATE_POLL_MS =
  Number.isFinite(PUBLIC_STATE_POLL_MS_RAW) && PUBLIC_STATE_POLL_MS_RAW >= 1000
    ? Math.round(PUBLIC_STATE_POLL_MS_RAW)
    : 4000;
const PUBLIC_SHUFFLE_VISUAL_MS_RAW = Number(
  import.meta.env.VITE_PUBLIC_SHUFFLE_VISUAL_MS ?? 20_000
);
const PUBLIC_SHUFFLE_VISUAL_MS =
  Number.isFinite(PUBLIC_SHUFFLE_VISUAL_MS_RAW) && PUBLIC_SHUFFLE_VISUAL_MS_RAW >= 1000
    ? Math.round(PUBLIC_SHUFFLE_VISUAL_MS_RAW)
    : 20_000;

export default function PublicAuctionView() {
  const [state, setState] = useState<AuctionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [publicShuffleUi, setPublicShuffleUi] = useState<{
    active: boolean;
    spinOffsetByItemId: Record<string, number>;
    revealCountByItemId: Record<string, number>;
    previewQueueByItemId: Record<string, number[]>;
  }>({
    active: false,
    spinOffsetByItemId: {},
    revealCountByItemId: {},
    previewQueueByItemId: {},
  });
  const [activeTab, setActiveTab] = useState<'queues' | 'logs'>('queues');
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');
  const [ignSuggestionsOpen, setIgnSuggestionsOpen] = useState(false);
  const [queueSubmitting, setQueueSubmitting] = useState(false);
  const [bidderLogSubTab, setBidderLogSubTab] = useState<'ranking' | 'weekly'>(
    'ranking'
  );
  const [bidderLogSearch, setBidderLogSearch] = useState('');
  const [bidderRankingSearch, setBidderRankingSearch] = useState('');
  const [weeklyLogFilter, setWeeklyLogFilter] = useState<
    'all' | BidderLogStateFilter | 'm1' | 'm2' | 'm3'
  >('all');
  const prevShuffleLockedRef = useRef<boolean>(false);
  const hasInitialShuffleStateRef = useRef<boolean>(false);
  const publicShuffleRafRef = useRef<number | null>(null);
  const publicShuffleRunningRef = useRef(false);

  const startPublicShuffleVisual = useCallback((snapshot: AuctionState) => {
    if (publicShuffleRunningRef.current) return;
    publicShuffleRunningRef.current = true;
    const activeItems = snapshot.items.filter((it) => it.status === 'active');
    const previewQueueByItemId: Record<string, number[]> = {};
    for (const it of activeItems) {
      previewQueueByItemId[it.id] = shuffleQueueIdsForType(
        it.interestedMemberIds,
        it.type
      );
    }
    setPublicShuffleUi({
      active: true,
      spinOffsetByItemId: {},
      revealCountByItemId: {},
      previewQueueByItemId,
    });

    const t0 = performance.now();
    const activeItemIds = activeItems.map((it) => it.id);
    const spinOffsetByItemIdLocal: Record<string, number> = {};
    let lastPickAt = 0;
    const revealWindowForType = (
      type: ItemType
    ): { start: number; end: number } => {
      if (type === 'TNS') return { start: 0.18, end: 0.5 };
      if (type === 'LND') return { start: 0.5, end: 0.78 };
      if (type === 'Fragment Card') return { start: 0.78, end: 1.0 };
      return { start: 0.55, end: 1.0 };
    };

    const tick = (now: number) => {
      const raw = Math.min(1, (now - t0) / PUBLIC_SHUFFLE_VISUAL_MS);
      const pickIntervalMs = Math.round(75 + raw * 190);
      if (lastPickAt === 0 || now - lastPickAt >= pickIntervalMs) {
        const spinOffsetByItemId: Record<string, number> = {};
        const revealCountByItemId: Record<string, number> = {};
        for (const itemId of activeItemIds) {
          const item = snapshot.items.find((it) => it.id === itemId);
          const previewIds = previewQueueByItemId[itemId] ?? [];
          const len = previewIds.length;
          if (len <= 0) continue;
          const winnerSlots = Math.max(
            0,
            item ? maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap) : 0
          );
          const window = item ? revealWindowForType(item.type) : { start: 0.55, end: 1.0 };
          const revealProgress =
            raw <= window.start
              ? 0
              : raw >= window.end
                ? 1
                : (raw - window.start) / Math.max(0.001, window.end - window.start);
          const revealCount = Math.min(
            winnerSlots,
            Math.max(0, Math.floor(revealProgress * winnerSlots))
          );
          revealCountByItemId[itemId] = revealCount;
          const remaining = Math.max(0, len - revealCount);
          const done = revealCount >= winnerSlots;
          if (!done && remaining > 0) {
            const prev = spinOffsetByItemIdLocal[itemId] ?? 0;
            const step = Math.max(1, Math.floor(Math.random() * 3) + 1);
            const next = (prev + step) % remaining;
            spinOffsetByItemIdLocal[itemId] = next;
            spinOffsetByItemId[itemId] = next;
          } else {
            spinOffsetByItemIdLocal[itemId] = 0;
            spinOffsetByItemId[itemId] = 0;
          }
        }
        lastPickAt = now;
        setPublicShuffleUi({
          active: true,
          spinOffsetByItemId,
          revealCountByItemId,
          previewQueueByItemId,
        });
      }
      if (raw < 1) {
        publicShuffleRafRef.current = requestAnimationFrame(tick);
        return;
      }
      publicShuffleRafRef.current = null;
      publicShuffleRunningRef.current = false;
      setPublicShuffleUi({
        active: false,
        spinOffsetByItemId: {},
        revealCountByItemId: {},
        previewQueueByItemId: {},
      });
    };
    publicShuffleRafRef.current = requestAnimationFrame(tick);
  }, []);

  const queueModalItem = useMemo(
    () => state?.items.find((i) => i.id === queueNameModalItemId) ?? null,
    [state, queueNameModalItemId]
  );

  /** Unique IGNs from guild roster (same `members` table / API as admin). */
  const rosterIgnSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const names: string[] = [];
    for (const m of state?.members ?? []) {
      const n = m.name.trim();
      if (!n) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      names.push(n);
    }
    names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return names;
  }, [state?.members]);

  const filteredIgnSuggestions = useMemo(() => {
    const q = queueNameInput.trim().toLowerCase();
    const src = rosterIgnSuggestions;
    if (!q) return src.slice(0, 80);
    return src.filter((n) => n.toLowerCase().includes(q)).slice(0, 80);
  }, [rosterIgnSuggestions, queueNameInput]);

  const publicSignupClosedByShuffle = useMemo(
    () =>
      shuffleLockClosesPublicSignup(
        state?.shuffleLocked === true,
        state?.eventMode
      ),
    [state?.shuffleLocked, state?.eventMode]
  );

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const remote = await fetchAuctionState();
      if (remote) {
        const nowLocked = remote.shuffleLocked === true;
        if (!hasInitialShuffleStateRef.current) {
          // First load (or page refresh): capture baseline only, no visual trigger.
          prevShuffleLockedRef.current = nowLocked;
          hasInitialShuffleStateRef.current = true;
        } else if (!prevShuffleLockedRef.current && nowLocked) {
          // Only play visual on actual in-session transition false -> true.
          startPublicShuffleVisual(remote);
          prevShuffleLockedRef.current = nowLocked;
        } else {
          prevShuffleLockedRef.current = nowLocked;
        }
        setState(remote);
      } else if (!silent) {
        setState(null);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [startPublicShuffleVisual]);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load({ silent: true }), PUBLIC_STATE_POLL_MS);
    return () => {
      window.clearInterval(id);
      if (publicShuffleRafRef.current != null) {
        cancelAnimationFrame(publicShuffleRafRef.current);
        publicShuffleRafRef.current = null;
      }
      publicShuffleRunningRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (publicSignupClosedByShuffle) {
      setQueueNameModalItemId(null);
      setQueueNameInput('');
      setIgnSuggestionsOpen(false);
    }
  }, [publicSignupClosedByShuffle]);

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

      setState(remote);
      const fresh = remote;

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
      if (
        shuffleLockClosesPublicSignup(
          fresh.shuffleLocked === true,
          fresh.eventMode
        )
      ) {
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

      const otherCard = findOtherActiveQueueBlocking(
        fresh.eventMode,
        fresh.items,
        fresh.members,
        ignLower,
        itemId,
        card.type,
        { skipHiddenBlockingItems: true }
      );
      if (otherCard) {
        void swal2QueueAlreadyOnAnotherItem({
          ign: raw,
          otherItemName: displayAuctionItemName(otherCard.name),
        });
        return;
      }

      if (
        weeklyTypeWinBlocksQueueJoin(
          fresh.eventMode,
          card.type,
          fresh.weeklyTypeWins,
          raw
        )
      ) {
        void swal2AlreadyWonTypeThisWeek({
          ign: raw,
          itemName: displayAuctionItemName(card.name),
          emperiumFragmentCardWinner:
            (fresh.eventMode ?? 'Emperium Overrun') === 'Emperium Overrun' &&
            card.type === 'Fragment Card',
        });
        return;
      }

      const next = await publicAddBidToQueue(itemId, raw);
      setState(next);

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
          const item = queueModalItem;
          void swal2AlreadyWonTypeThisWeek({
            ign: raw,
            itemName: displayAuctionItemName(
              err.extra?.itemName ?? item?.name ?? 'this item'
            ),
            emperiumFragmentCardWinner:
              (state?.eventMode ?? 'Emperium Overrun') === 'Emperium Overrun' &&
              item?.type === 'Fragment Card',
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
  const featherPageStartByItemId = useMemo(() => {
    const rank = parseGuildRank(state?.rewardRank);
    const counts = state?.rewardItemCounts ?? {
      fragment: totalItemsForTypeByRank('Fragment Card', rank),
      lnd: totalItemsForTypeByRank('LND', rank),
      tns: totalItemsForTypeByRank('TNS', rank),
    };
    const featherItems = (state?.items ?? [])
      .filter(
        (it) =>
          it.status === 'active' &&
          (it.type === 'Fragment Card' || it.type === 'LND' || it.type === 'TNS')
      )
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    const out: Record<string, number> = {};
    let nextPage = 1;
    for (const it of featherItems) {
      out[it.id] = nextPage;
      const totalItems =
        it.type === 'Fragment Card'
          ? counts.fragment
          : it.type === 'LND'
            ? counts.lnd
            : counts.tns;
      nextPage +=
        it.type === 'Fragment Card'
          ? fragmentGeneralPageSpan(totalItems)
          : featherRewardSpanFourItemPages(it.type, totalItems);
    }
    return out;
  }, [state?.items, state?.rewardRank, state?.rewardItemCounts]);

  const publicRewardRank = useMemo(
    () => parseGuildRank(state?.rewardRank),
    [state?.rewardRank]
  );
  const publicRewardItemCounts = useMemo(
    () =>
      state?.rewardItemCounts ?? {
        fragment: totalItemsForTypeByRank('Fragment Card', publicRewardRank),
        lnd: totalItemsForTypeByRank('LND', publicRewardRank),
        tns: totalItemsForTypeByRank('TNS', publicRewardRank),
      },
    [state?.rewardItemCounts, publicRewardRank]
  );

  const bidderStateLogEntries = state?.bidderStateLog ?? [];

  const bidderStateLogEntriesSorted = useMemo(
    () => sortBidderStateLogNewestFirst(bidderStateLogEntries),
    [bidderStateLogEntries]
  );

  const bidderStateLogThisAuctionWeek = useMemo(
    () => filterToCurrentAuctionWeek(bidderStateLogEntriesSorted),
    [bidderStateLogEntriesSorted]
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
        bidderStateLogThisAuctionWeek,
        publicSignupClosedByShuffle,
        queueIgnCounts
      ),
    [bidderStateLogThisAuctionWeek, publicSignupClosedByShuffle, queueIgnCounts]
  );

  const filteredBidderRankingRows = useMemo(
    () =>
      bidderStatsByIgn.filter((row) =>
        bidderRankingRowMatchesSearch(row, bidderRankingSearch)
      ),
    [bidderStatsByIgn, bidderRankingSearch]
  );

  const bidderRankingDayDetails = useMemo(
    () => buildBidderOutcomeDaysByIgnKey(bidderStateLogThisAuctionWeek),
    [bidderStateLogThisAuctionWeek]
  );

  /** Weekly list: win/loss only — ongoing rows stay in DB for ranking math but are not shown here. */
  const filteredBidderLogEntries = useMemo(
    () => {
      const weekKey = getAuctionWeekMondayKey();
      const outcomeFilter: BidderLogStateFilter =
        weeklyLogFilter === 'loss' || weeklyLogFilter === 'win' ? weeklyLogFilter : 'all';
      const typeFilter: 'all' | 'm1' | 'm2' | 'm3' =
        weeklyLogFilter === 'm1' || weeklyLogFilter === 'm2' || weeklyLogFilter === 'm3'
          ? weeklyLogFilter
          : 'all';

      return bidderStateLogEntriesSorted.filter(
        (row) =>
          getAuctionWeekMondayKey(row.at) === weekKey &&
          row.state !== BIDDER_STATE_ONGOING &&
          (typeFilter === 'all' ||
            (typeFilter === 'm1' && row.itemType === 'Fragment Card') ||
            (typeFilter === 'm2' && row.itemType === 'LND') ||
            (typeFilter === 'm3' && row.itemType === 'TNS')) &&
          bidderLogEntryMatchesFilter(row, outcomeFilter) &&
          bidderLogEntryMatchesSearch(row, bidderLogSearch)
      );
    },
    [bidderStateLogEntriesSorted, weeklyLogFilter, bidderLogSearch]
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
                          rewardRank={publicRewardRank}
                          rewardItemCounts={publicRewardItemCounts}
                          featherPageStart={featherPageStartByItemId[item.id]}
                          isShuffling={publicShuffleUi.active}
                          shuffleSpinOffset={publicShuffleUi.spinOffsetByItemId[item.id]}
                          shuffleRevealCount={publicShuffleUi.revealCountByItemId[item.id]}
                          shufflePreviewIds={publicShuffleUi.previewQueueByItemId[item.id]}
                          shuffleDone={
                            (publicShuffleUi.revealCountByItemId[item.id] ?? 0) >=
                            maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap)
                          }
                          showWinnerShortlist={
                            state?.winnerShortlistUiEnabled === true
                          }
                          shuffleLocked={state?.shuffleLocked === true}
                          freeDrawChosenMemberId={
                            (state?.freeDrawChosenByItemId ?? {})[item.id] ?? null
                          }
                          showJoinQueue={!publicSignupClosedByShuffle}
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
                      className={`flex min-h-10 min-w-0 flex-1 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:px-4 sm:text-sm ${
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
                      className={`flex min-h-10 min-w-0 flex-1 cursor-pointer touch-manipulation items-center justify-center rounded-xl px-3 py-2.5 text-xs font-bold uppercase tracking-wide transition-all sm:px-4 sm:text-sm ${
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
                      <div className="space-y-3">
                        <div className="flex w-full flex-col gap-3 sm:flex-row sm:justify-start">
                          <div className="relative min-w-0 w-full sm:max-w-md">
                            <Search
                              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                              aria-hidden
                            />
                            <input
                              type="search"
                              value={bidderRankingSearch}
                              onChange={(e) => setBidderRankingSearch(e.target.value)}
                              placeholder="Search IGN, counts…"
                              className="w-full rounded-xl border border-slate-700 bg-slate-900 py-2.5 pl-9 pr-3 text-sm text-white placeholder:text-slate-600 focus:border-blue-500/60 focus:outline-none focus:ring-2 focus:ring-blue-600/30"
                              aria-label="Search ranking"
                            />
                          </div>
                        </div>
                        <p className="text-xs text-slate-500">
                          Open a name to see each day (weekday + date in auction timezone), item, and{' '}
                          <strong className="font-semibold text-slate-400">Win</strong> /{' '}
                          <strong className="font-semibold text-slate-400">Loss</strong> /{' '}
                          <strong className="font-semibold text-slate-400">Ongoing</strong>.
                        </p>
                        {filteredBidderRankingRows.length === 0 ? (
                          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center text-sm font-medium text-slate-500">
                            No entries match this search.
                          </p>
                        ) : (
                          <BidderRankingExpandableRows
                            rows={filteredBidderRankingRows}
                            dayDetailsByIgn={bidderRankingDayDetails}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center sm:p-12">
                        <p className="text-sm font-medium text-slate-500">
                          No ranking yet. Join a queue or ask an admin to shuffle or mark a winner so Win /
                          Loss counts show up here.
                        </p>
                      </div>
                    ))}

                  {bidderLogSubTab === 'weekly' &&
                    (bidderStateLogEntries.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center sm:p-12">
                        <p className="text-sm font-medium text-slate-500">
                          No weekly log yet. After shuffle, Win / Loss are in{' '}
                          <code className="text-xs text-slate-400">bidder_state_log</code>; admin green checks
                          are listed in the winner mark log.
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
                                ['m1', 'PFC'] as const,
                                ['m2', 'LND'] as const,
                                ['m3', 'TNS'] as const,
                              ] satisfies readonly [
                                'all' | BidderLogStateFilter | 'm1' | 'm2' | 'm3',
                                string
                              ][]
                            ).map(([id, label]) => (
                              <button
                                key={id}
                                type="button"
                                onClick={() => setWeeklyLogFilter(id)}
                                className={`cursor-pointer rounded-xl border px-3 py-2 text-[10px] font-black uppercase tracking-wide transition-colors sm:px-4 sm:text-xs ${
                                  weeklyLogFilter === id
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
              setIgnSuggestionsOpen(false);
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
                  autoComplete="off"
                  aria-autocomplete="list"
                  aria-expanded={
                    ignSuggestionsOpen &&
                    (filteredIgnSuggestions.length > 0 || rosterIgnSuggestions.length === 0)
                  }
                  aria-controls="public-ign-suggestions"
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={queueNameInput}
                  onChange={(e) => {
                    setQueueNameInput(e.target.value);
                    // Stay open after pick+clear: blur/refocus does not run; only onFocus opened before.
                    setIgnSuggestionsOpen(true);
                  }}
                  onFocus={() => setIgnSuggestionsOpen(true)}
                  onBlur={() => {
                    window.setTimeout(() => setIgnSuggestionsOpen(false), 180);
                  }}
                  disabled={queueSubmitting}
                />
                {ignSuggestionsOpen &&
                rosterIgnSuggestions.length > 0 &&
                filteredIgnSuggestions.length > 0 ? (
                  <ul
                    id="public-ign-suggestions"
                    role="listbox"
                    className="max-h-52 overflow-y-auto rounded-2xl border border-slate-600 bg-slate-950 py-1 shadow-lg shadow-black/30"
                  >
                    {filteredIgnSuggestions.map((name) => (
                      <li key={name.toLowerCase()} role="option">
                        <button
                          type="button"
                          className="flex w-full px-4 py-2.5 text-left text-sm font-bold text-slate-200 transition-colors hover:bg-slate-800 hover:text-white"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setQueueNameInput(name);
                            setIgnSuggestionsOpen(false);
                          }}
                        >
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : ignSuggestionsOpen && rosterIgnSuggestions.length === 0 ? (
                  <p
                    id="public-ign-suggestions"
                    className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/95 px-4 py-3 text-xs font-medium text-slate-500"
                  >
                    No guild roster in state yet. Add members from the admin dashboard.
                  </p>
                ) : ignSuggestionsOpen &&
                  rosterIgnSuggestions.length > 0 &&
                  filteredIgnSuggestions.length === 0 ? (
                  <p
                    id="public-ign-suggestions"
                    className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-xs font-medium text-slate-500"
                  >
                    No roster names match &quot;{queueNameInput.trim()}&quot;.
                  </p>
                ) : null}
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
  rewardRank,
  rewardItemCounts,
  featherPageStart,
  isShuffling,
  shuffleSpinOffset,
  shuffleRevealCount,
  shufflePreviewIds,
  shuffleDone,
  showWinnerShortlist,
  shuffleLocked,
  freeDrawChosenMemberId,
  showJoinQueue,
  onRequestAddName,
}: {
  item: AuctionItem;
  members: GuildMember[];
  rewardRank: GuildRank;
  rewardItemCounts: { fragment: number; lnd: number; tns: number };
  featherPageStart?: number;
  isShuffling: boolean;
  shuffleSpinOffset?: number;
  shuffleRevealCount?: number;
  shufflePreviewIds?: number[];
  shuffleDone?: boolean;
  /** Same as admin: off after Reset / Unmark until Shuffle again. */
  showWinnerShortlist: boolean;
  /** After main shuffle; used with free draw highlight. */
  shuffleLocked?: boolean;
  /** Member highlighted as the free-draw pick (same as admin dashboard). */
  freeDrawChosenMemberId?: number | null;
  /** Hidden after admin runs “Shuffle all queues” until Reset shuffle. */
  showJoinQueue: boolean;
  onRequestAddName: () => void;
}) {
  const displayIds =
    isShuffling && Array.isArray(shufflePreviewIds)
      ? shufflePreviewIds
      : item.interestedMemberIds;
  const shortlistSlots = showWinnerShortlist
    ? maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap)
    : 0;

  /** Same cap as admin shortlist rows after “Shuffle all queues”. */
  const winnerPickPoolSize = maxQueueSlotsAfterShuffle(
    item.type,
    item.winnerPoolCap
  );
  const winnerPageRanges = (() => {
    const totalItems =
      item.type === 'Fragment Card'
        ? rewardItemCounts.fragment
        : item.type === 'LND'
          ? rewardItemCounts.lnd
          : item.type === 'TNS'
            ? rewardItemCounts.tns
            : 1;
    const pageStart =
      item.type === 'Fragment Card' || item.type === 'LND' || item.type === 'TNS'
        ? featherPageStart ?? 1
        : 1;
    return computeWinnerAssignmentLabelsFromItems(
      item.type,
      totalItems,
      item.interestedMemberIds.length,
      pageStart,
      rewardRank
    );
  })();
  const freeItems =
    item.type === 'LND'
      ? freeItemsFromTotalItems(item.type, rewardItemCounts.lnd, rewardRank)
      : item.type === 'TNS'
        ? freeItemsFromTotalItems(item.type, rewardItemCounts.tns, rewardRank)
        : 0;
  const freePageInfo = (() => {
    if (item.type !== 'LND' && item.type !== 'TNS') return null;
    const pageStart = featherPageStart ?? 1;
    const totalItems = item.type === 'LND' ? rewardItemCounts.lnd : rewardItemCounts.tns;
    const offset = featherPageCountBeforePartialFree(item.type, totalItems, rewardRank);
    return freeItems > 0 ? { pageLabel: `P${pageStart + offset}`, freeItems } : null;
  })();
  const featherSlotUnit = featherItemsPerWinnerUnit(rewardRank);
  const resolvedRevealCount =
    typeof shuffleRevealCount === 'number' && Number.isInteger(shuffleRevealCount)
      ? Math.max(0, Math.min(shuffleRevealCount, displayIds.length))
      : 0;
  const resolvedSpinOffset =
    typeof shuffleSpinOffset === 'number' && Number.isInteger(shuffleSpinOffset)
      ? Math.max(0, Math.min(shuffleSpinOffset, Math.max(0, displayIds.length - 1)))
      : 0;
  const rotatedDisplayIds = (() => {
    if (!isShuffling || shuffleDone) return displayIds;
    const reveal = resolvedRevealCount;
    const head = displayIds.slice(0, reveal);
    const tail = displayIds.slice(reveal);
    if (tail.length <= 1) return displayIds;
    const offset = resolvedSpinOffset % tail.length;
    const rotatedTail = tail.slice(offset).concat(tail.slice(0, offset));
    return head.concat(rotatedTail);
  })();

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
            {!isShuffling && showWinnerShortlist && freeItems > 0 && (
              <span className="mt-0.5 block font-semibold text-sky-300/95 [text-decoration:none]">
                {freePageInfo ? (
                  <span className="block">
                    + FREE {formatFreePoolPageDisplay(freePageInfo.pageLabel)} ({freePageInfo.freeItems} items, partial{' '}
                    {featherSlotUnit}-item page)
                  </span>
                ) : (
                  <span className="block">
                    +{freeItems} free item{freeItems === 1 ? '' : 's'}
                  </span>
                )}
              </span>
            )}
          </span>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 sm:rounded-3xl sm:p-4">
        {displayIds.length === 0 ? (
          <p className="py-10 text-center text-xs font-bold text-slate-500">No bidders in this queue yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {displayIds.map((slotMid, idx) => {
              const mid = isShuffling ? (rotatedDisplayIds[idx] ?? slotMid) : slotMid;
              const m = members.find((x) => x.id === mid);
              if (!m) return null;
              const shortlist = isShuffling ? idx < resolvedRevealCount : idx < shortlistSlots;
              const isFreeDrawPickRow =
                !isShuffling &&
                shuffleLocked === true &&
                showWinnerShortlist &&
                freeItems > 0 &&
                (item.type === 'LND' || item.type === 'TNS') &&
                typeof freeDrawChosenMemberId === 'number' &&
                freeDrawChosenMemberId === mid;
              const pageLabel =
                !isShuffling && shortlist && idx < winnerPageRanges.length
                  ? winnerPageRanges[idx]
                  : null;
              return (
                <li
                  key={isShuffling ? `slot-${item.id}-${idx}` : mid}
                  className={`flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${
                    shortlist
                      ? 'border-blue-500/50 bg-blue-600/20'
                      : isShuffling
                        ? 'border-blue-400/60 bg-blue-500/15'
                        : isFreeDrawPickRow
                          ? 'border-sky-500/40 bg-slate-800/90 ring-1 ring-inset ring-sky-500/15 shadow-[inset_0_1px_0_0_rgba(56,189,248,0.06)]'
                          : 'border-slate-800 bg-slate-900'
                  }`}
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <span
                      className={`min-w-0 flex-1 break-words font-bold leading-normal [overflow-wrap:anywhere] ${
                        isFreeDrawPickRow ? 'text-slate-100' : 'text-slate-200'
                      }`}
                    >
                      {isShuffling ? (
                        <span
                          className={
                            !shuffleDone && idx >= resolvedRevealCount
                              ? 'animate-pulse text-white'
                              : ''
                          }
                        >
                          {m.name}
                        </span>
                      ) : (
                        m.name
                      )}
                    </span>
                    {isFreeDrawPickRow ? (
                      freePageInfo ? (
                        <span
                          className="flex shrink-0 flex-wrap items-center justify-end gap-1"
                          title={freePoolPageLabelTitle(freePageInfo.pageLabel)}
                        >
                          <span className="rounded-md border border-sky-500/45 bg-sky-950/60 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-200">
                            Free
                          </span>
                          <span className="rounded-lg border border-sky-400/35 bg-sky-950/50 px-2 py-0.5 font-mono text-[10px] font-black uppercase tabular-nums tracking-wide text-sky-100">
                            {formatFreePoolPageDisplay(freePageInfo.pageLabel)}
                          </span>
                        </span>
                      ) : (
                        <span
                          title="Free draw pool"
                          className="shrink-0 rounded-md border border-sky-500/45 bg-sky-950/60 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-sky-200"
                        >
                          Free
                        </span>
                      )
                    ) : null}
                    {pageLabel ? (
                      <span
                        title={winnerAssignmentLabelTitle(pageLabel)}
                        className="shrink-0 rounded-lg border border-blue-500/60 bg-blue-500/15 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-blue-200"
                      >
                        {pageLabel}
                      </span>
                    ) : null}
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
            {!isShuffling && showWinnerShortlist && freeItems > 0 && (
              <li className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-slate-600/70 bg-slate-800/50 px-3 py-2.5 text-[10px] font-black uppercase tracking-wide text-slate-300 sm:px-3 sm:py-3">
                {freePageInfo ? (
                  <span className="text-sky-200/95">{`FREE (partial ${featherSlotUnit}-item page): ${formatFreePoolPageDisplay(freePageInfo.pageLabel)} (${freePageInfo.freeItems} items)`}</span>
                ) : (
                  <span className="text-sky-200/95">FREE items: {freeItems}</span>
                )}
              </li>
            )}
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
