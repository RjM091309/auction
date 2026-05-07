/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  History,
  Trash2,
  Check,
  Clock,
  LayoutDashboard,
  Shuffle,
  RotateCcw,
  Search,
  ListX,
  Pencil,
  GripVertical,
  LogOut,
  XCircle,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { AuctionItem, AuctionState, ItemType, GuildMember } from './types';
import { saveState } from './lib/storage';
import { AUCTION_DATA_VERSION } from './data/auctionDefaults';
import {
  deactivateMemberOnServer,
  fetchAuctionState,
  logoutRequest,
  persistAuctionState,
} from './lib/apiState';
import { randomId } from './lib/randomId';
import { nextTempMemberId } from './lib/tempMemberId';
import {
  swal2AlreadyWonTypeThisWeek,
  swal2QueueMemberAdded,
  swal2QueueAlreadyListed,
  swal2QueueAlreadyOnAnotherItem,
  swal2NameAlreadyTaken,
  swal2MemberNameUpdated,
  swal2SaveError,
  swal2ConfirmRemoveMember,
  swal2ConfirmClearAllQueues,
  swal2ConfirmShuffleAllQueues,
  swal2ConfirmResetShuffleUnmark,
  swal2WinnerPoolFull,
  swal2WinnerLimitsUpdated,
} from './lib/sweetAlert2';
import { ignHasWeeklyTypeWin } from './lib/weeklyTypeWins';
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
import {
  defaultWinnerPoolCapForType,
  maxQueueSlotsAfterShuffle,
  shuffleQueueIdsForType,
} from './lib/shuffleCaps';
import { displayAuctionItemName } from './lib/formatAuctionItemName';
import { isAuctionItemHidden } from './lib/hiddenAuctionItems';
import { formatAuctionLogTime } from './lib/formatAuctionLogTime';
import { getAuctionWeekMondayKey } from './lib/auctionWeek';
import {
  BIDDER_STATE_LOSS,
  BIDDER_STATE_ONGOING,
  BIDDER_STATE_WIN,
  type BidderLogStateFilter,
  bidderLogEntryMatchesFilter,
  bidderLogEntryMatchesSearch,
  bidderRankingRowMatchesSearch,
  bidderStateBadgeClass,
  bidderStateLabel,
  countQueuedIgnByNormalized,
  sortBidderStateLogNewestFirst,
  summarizeBidderStateLog,
} from './lib/bidderStateLogUi';

/** How often the admin dashboard pulls server state so public joins show up without manual refresh. */
const ADMIN_STATE_POLL_MS = 2000;

/** Compare server vs local view so idle polls do not re-trigger persist. */
function auctionPollSnapshot(s: AuctionState): string {
  return JSON.stringify({
    members: s.members,
    items: s.items.map((it) => ({
      id: it.id,
      name: it.name,
      type: it.type,
      interestedMemberIds: it.interestedMemberIds,
      recordedWinnerNames: it.recordedWinnerNames,
      winnerName: it.winnerName,
      status: it.status,
      createdAt: it.createdAt,
    })),
    weeklyTypeWins: s.weeklyTypeWins,
    winnerMarkLog: s.winnerMarkLog,
    bidderStateLog: s.bidderStateLog,
    shuffleLocked: s.shuffleLocked,
    winnerShortlistUiEnabled: s.winnerShortlistUiEnabled,
    dataVersion: s.dataVersion,
  });
}

export default function AuctionDashboard({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<AuctionState | null>(null);
  const mayPersist = useRef(false);
  const skipInitialPersist = useRef(1);
  const latestState = useRef<AuctionState | null>(null);
  latestState.current = state;
  /** True while the debounced persist timer is waiting (local state not yet on server). */
  const persistDebouncePendingRef = useRef(false);
  /** True while `persistAuctionState` HTTP is in flight. */
  const persistInFlightRef = useRef(false);
  
  const [activeTab, setActiveTab] = useState<'dashboard' | 'history'>('dashboard');
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');
  const [queueAdminSubmitting, setQueueAdminSubmitting] = useState(false);
  const [editMemberId, setEditMemberId] = useState<number | null>(null);
  const [editMemberNameInput, setEditMemberNameInput] = useState('');
  const [winnerSetLimitModalOpen, setWinnerSetLimitModalOpen] = useState(false);
  const [winnerSetLimitForm, setWinnerSetLimitForm] = useState({
    fragment: defaultWinnerPoolCapForType('Fragment Card'),
    lnd: defaultWinnerPoolCapForType('LND'),
    tns: defaultWinnerPoolCapForType('TNS'),
  });

  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ItemType>('Fragment Card');
  const [newItemWinnerPoolCap, setNewItemWinnerPoolCap] = useState<number>(
    defaultWinnerPoolCapForType('Fragment Card')
  );

  /** Full-width shuffle tension bar (0–100%) */
  const [shuffleUi, setShuffleUi] = useState<{ active: boolean; pct: number }>({
    active: false,
    pct: 0,
  });
  const [bidderLogSubTab, setBidderLogSubTab] = useState<'ranking' | 'weekly'>(
    'ranking'
  );
  const [bidderLogSearch, setBidderLogSearch] = useState('');
  const [bidderRankingSearch, setBidderRankingSearch] = useState('');
  const [weeklyLogFilter, setWeeklyLogFilter] = useState<
    'all' | BidderLogStateFilter | 'm1' | 'm2' | 'm3'
  >('all');
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
          pruneOrphanQueueMembers(
            remote ?? {
              items: [],
              members: [],
              dataVersion: AUCTION_DATA_VERSION,
            }
          )
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
    persistDebouncePendingRef.current = true;
    const id = window.setTimeout(() => {
      persistDebouncePendingRef.current = false;
      const snap = latestState.current;
      if (!snap) return;
      persistInFlightRef.current = true;
      persistAuctionState(snap)
        .then((server) => {
          if (!server) return;
          setState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              winnerMarkLog: server.winnerMarkLog ?? prev.winnerMarkLog,
              bidderStateLog: server.bidderStateLog ?? prev.bidderStateLog,
              weeklyTypeWins: server.weeklyTypeWins ?? prev.weeklyTypeWins,
            };
          });
        })
        .catch(async (e) => {
          const msg = e instanceof Error ? e.message : String(e);
          console.error('[api] persist failed', e);
          void swal2SaveError(msg || 'Unknown error');
          try {
            const recovered = await fetchAuctionState();
            if (recovered) {
              setState(
                dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
              );
            }
          } catch {
            /* ignore */
          }
        })
        .finally(() => {
          persistInFlightRef.current = false;
        });
    }, 450);
    return () => {
      window.clearTimeout(id);
      persistDebouncePendingRef.current = false;
    };
  }, [state]);

  /** Merge in public (and other tab) queue changes while admin is idle; skip during debounce / save. */
  useEffect(() => {
    const applyRemote = async () => {
      if (document.visibilityState === 'hidden') return;
      if (!mayPersist.current) return;
      if (
        persistDebouncePendingRef.current ||
        persistInFlightRef.current
      ) {
        return;
      }
      const remote = await fetchAuctionState();
      if (
        persistDebouncePendingRef.current ||
        persistInFlightRef.current
      ) {
        return;
      }
      if (!remote) return;
      const normalized = dedupeIgnAcrossActiveQueues(
        pruneOrphanQueueMembers(remote)
      );
      setState((prev) => {
        if (
          persistDebouncePendingRef.current ||
          persistInFlightRef.current
        ) {
          return prev;
        }
        if (!prev) return normalized;
        if (auctionPollSnapshot(prev) === auctionPollSnapshot(normalized)) {
          return prev;
        }
        return normalized;
      });
    };

    const intervalId = window.setInterval(
      () => void applyRemote(),
      ADMIN_STATE_POLL_MS
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') void applyRemote();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const activeAuctions = useMemo(
    () => state?.items.filter((item) => item.status === 'active') ?? [],
    [state]
  );

  const visibleActiveAuctions = useMemo(
    () => activeAuctions.filter((item) => !isAuctionItemHidden(item)),
    [activeAuctions]
  );

  /** Fewer visible cards than xl columns — center the row instead of hugging the left. */
  const centerFewQueueCards =
    visibleActiveAuctions.length > 0 && visibleActiveAuctions.length < 3;

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

  const filteredBidderRankingRows = useMemo(
    () =>
      bidderStatsByIgn.filter((row) =>
        bidderRankingRowMatchesSearch(row, bidderRankingSearch)
      ),
    [bidderStatsByIgn, bidderRankingSearch]
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

  const totalActiveQueueEntries = useMemo(
    () =>
      activeAuctions.reduce((sum, it) => sum + it.interestedMemberIds.length, 0),
    [activeAuctions]
  );

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    const newItem: AuctionItem = {
      id: randomId(),
      name: newItemName,
      type: newItemType,
      winnerPoolCap: Math.max(0, Math.floor(Number(newItemWinnerPoolCap) || 0)),
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
    setNewItemWinnerPoolCap(defaultWinnerPoolCapForType(newItemType));
  };

  const handleShuffleAllQueues = async () => {
    if (!latestState.current || shuffleRunningRef.current) return;
    if (latestState.current.shuffleLocked === true) return;
    const snapshot = latestState.current;
    const activeItemsForShuffle = snapshot.items.filter((it) => it.status === 'active');
    const totalParticipants = activeItemsForShuffle.reduce(
      (sum, it) => sum + it.interestedMemberIds.length,
      0
    );
    const participantCountByType = (type: ItemType) =>
      activeItemsForShuffle
        .filter((it) => it.type === type)
        .reduce((sum, it) => sum + it.interestedMemberIds.length, 0);
    const fragmentParticipants = participantCountByType('Fragment Card');
    const lndParticipants = participantCountByType('LND');
    const tnsParticipants = participantCountByType('TNS');
    const typeLimit = (type: ItemType) => {
      const ref = snapshot.items.find((it) => it.type === type);
      return maxQueueSlotsAfterShuffle(type, ref?.winnerPoolCap);
    };
    const ok = await swal2ConfirmShuffleAllQueues({
      totalParticipants,
      fragmentParticipants,
      lndParticipants,
      tnsParticipants,
      fragmentLimit: typeLimit('Fragment Card'),
      lndLimit: typeLimit('LND'),
      tnsLimit: typeLimit('TNS'),
    });
    if (!ok) return;
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
          shuffleLocked: true,
          winnerShortlistUiEnabled: true,
          items: prev.items.map((item) => {
            if (item.status !== 'active') return item;
            return {
              ...item,
              /** Bagong shuffle round — walang green check hanggang ma-mark ulit. */
              recordedWinnerNames: [],
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
      const ignKey = (memberId: number) => {
        const n = prev.members.find((m) => m.id === memberId)?.name?.trim() ?? '';
        return n.toLowerCase();
      };
      return {
        ...prev,
        shuffleLocked: false,
        winnerShortlistUiEnabled: false,
        items: prev.items.map((item) => {
          const reopened = {
            ...item,
            status: 'active' as const,
            winnerName: null,
            recordedWinnerNames: [] as string[],
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

  const handleQueueMove = async (payload: QueueMovePayload) => {
    if (!state) return;
    let base: AuctionState = dedupeIgnAcrossActiveQueues(
      pruneOrphanQueueMembers(state)
    );
    try {
      const remote = await fetchAuctionState();
      if (remote) {
        base = dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote));
      }
    } catch {
      /* keep base from local */
    }

    const toItem = base.items.find((i) => i.id === payload.toItemId);
    const member = base.members.find((m) => m.id === payload.memberId);
    if (
      member &&
      toItem &&
      payload.fromItemId !== payload.toItemId &&
      ignHasWeeklyTypeWin(base.weeklyTypeWins, member.name, toItem.type)
    ) {
      setState(base);
      void swal2AlreadyWonTypeThisWeek({
        ign: member.name,
        itemName: displayAuctionItemName(toItem.name),
      });
      return;
    }

    const next = applyQueueMemberMove(base, payload);
    if ('error' in next) {
      setState(base);
      if (next.error === 'name_conflict' && next.toItemName) {
        const ign =
          base.members.find((m) => m.id === payload.memberId)?.name ?? '';
        void swal2QueueAlreadyOnAnotherItem({
          ign,
          otherItemName: displayAuctionItemName(next.toItemName),
        });
      } else if (next.error === 'weekly_type_win' && next.toItemName) {
        const ign =
          base.members.find((m) => m.id === payload.memberId)?.name ?? '';
        void swal2AlreadyWonTypeThisWeek({
          ign,
          itemName: displayAuctionItemName(next.toItemName),
        });
      }
      return;
    }
    setState(next);
  };

  const handleCompleteAuction = (itemId: string, winnerName: string | null) => {
    const trimmed = winnerName?.trim();
    if (!trimmed || !state) return;

    const item = state.items.find((i) => i.id === itemId);
    if (!item || item.status !== 'active') return;

    const pool = maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
    const existing = item.recordedWinnerNames ?? [];
    if (existing.some((n) => n.trim().toLowerCase() === trimmed.toLowerCase())) {
      return;
    }
    if (existing.length >= pool) {
      void swal2WinnerPoolFull({ itemType: item.type, pool });
      return;
    }

    setState((prev) => {
      if (!prev) return prev;
      const target = prev.items.find((i) => i.id === itemId);
      if (!target || target.status !== 'active') return prev;
      const ex = target.recordedWinnerNames ?? [];
      if (ex.length >= pool) return prev;
      const memberId = prev.members.find(
        (m) => m.name.trim().toLowerCase() === trimmed.toLowerCase()
      )?.id;

      return {
        ...prev,
        items: prev.items.map((it) => {
          if (it.id !== itemId) return it;
          return {
            ...it,
            recordedWinnerNames: [...ex, trimmed],
            interestedMemberIds: memberId
              ? it.interestedMemberIds.filter((id) => id !== memberId)
              : it.interestedMemberIds,
          };
        }),
      };
    });
  };

  const handleClearAllQueues = async () => {
    if (!state) return;
    const active = state.items.filter((i) => i.status === 'active');
    const totalEntries = active.reduce(
      (sum, it) => sum + it.interestedMemberIds.length,
      0
    );
    if (totalEntries === 0) return;
    const cardsWithBidders = active.filter(
      (it) => it.interestedMemberIds.length > 0
    ).length;
    const ok = await swal2ConfirmClearAllQueues(totalEntries, cardsWithBidders);
    if (!ok) return;
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) =>
          it.status === 'active'
            ? { ...it, interestedMemberIds: [] }
            : it
        ),
      };
    });
  };

  const handleDeactivateMember = async (memberId: number) => {
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

  const openWinnerSetLimitModal = () => {
    if (!state) return;
    const firstByType = (type: ItemType) => state.items.find((it) => it.type === type);
    const fragmentItem = firstByType('Fragment Card');
    const lndItem = firstByType('LND');
    const tnsItem = firstByType('TNS');
    setWinnerSetLimitForm({
      fragment: maxQueueSlotsAfterShuffle(
        'Fragment Card',
        fragmentItem?.winnerPoolCap
      ),
      lnd: maxQueueSlotsAfterShuffle('LND', lndItem?.winnerPoolCap),
      tns: maxQueueSlotsAfterShuffle('TNS', tnsItem?.winnerPoolCap),
    });
    setWinnerSetLimitModalOpen(true);
  };

  const handleSaveWinnerSetLimit = (e: React.FormEvent) => {
    e.preventDefault();
    setState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((it) => {
          if (it.type === 'Fragment Card') {
            return { ...it, winnerPoolCap: winnerSetLimitForm.fragment };
          }
          if (it.type === 'LND') {
            return { ...it, winnerPoolCap: winnerSetLimitForm.lnd };
          }
          if (it.type === 'TNS') {
            return { ...it, winnerPoolCap: winnerSetLimitForm.tns };
          }
          return it;
        }),
      };
    });
    setWinnerSetLimitModalOpen(false);
    void swal2WinnerLimitsUpdated({
      fragment: winnerSetLimitForm.fragment,
      lnd: winnerSetLimitForm.lnd,
      tns: winnerSetLimitForm.tns,
    });
  };

  const openEditMember = (memberId: number) => {
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

  const handleAddNameToQueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = queueNameInput.trim();
    const itemId = queueNameModalItemId;
    if (!raw || !itemId || queueAdminSubmitting) return;

    setQueueAdminSubmitting(true);
    try {
      const remote = await fetchAuctionState();
      const base = remote
        ? dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote))
        : state
          ? dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(state))
          : null;
      if (!base) {
        void swal2SaveError('Could not load latest auction state.');
        return;
      }

      const card = base.items.find((it) => it.id === itemId);
      if (!card) {
        void swal2SaveError('Auction card not found.');
        setQueueNameModalItemId(null);
        return;
      }

      const ignLower = raw.toLowerCase();
      const queueHasThisIgn = (it: AuctionItem) =>
        it.interestedMemberIds.some((mid) => {
          const n = base.members.find((m) => m.id === mid)?.name;
          return n != null && n.trim().toLowerCase() === ignLower;
        });

      if (queueHasThisIgn(card)) {
        setState(base);
        void swal2QueueAlreadyListed({
          ign: raw,
          itemName: displayAuctionItemName(card.name),
        });
        setQueueNameInput('');
        setQueueNameModalItemId(null);
        return;
      }

      const otherCard = base.items.find(
        (it) =>
          it.status === 'active' &&
          it.id !== itemId &&
          queueHasThisIgn(it)
      );
      if (otherCard) {
        setState(base);
        void swal2QueueAlreadyOnAnotherItem({
          ign: raw,
          otherItemName: displayAuctionItemName(otherCard.name),
        });
        setQueueNameInput('');
        setQueueNameModalItemId(null);
        return;
      }

      if (ignHasWeeklyTypeWin(base.weeklyTypeWins, raw, card.type)) {
        setState(base);
        void swal2AlreadyWonTypeThisWeek({
          ign: raw,
          itemName: displayAuctionItemName(card.name),
        });
        setQueueNameInput('');
        setQueueNameModalItemId(null);
        return;
      }

      const existing = base.members.find((m) => m.name.toLowerCase() === ignLower);
      const memberId = existing?.id ?? nextTempMemberId();
      const ex = base.members.find((m) => m.name.toLowerCase() === ignLower);
      const mid = ex?.id ?? memberId;
      const members = ex
        ? base.members
        : [...base.members, { id: mid, name: raw, role: 'Member' as const }];
      const items = base.items.map((it) => {
        if (it.id !== itemId) return it;
        if (it.interestedMemberIds.includes(mid)) return it;
        return { ...it, interestedMemberIds: [...it.interestedMemberIds, mid] };
      });

      setState({ ...base, members, items });
      void swal2QueueMemberAdded({
        ign: raw,
        itemName: displayAuctionItemName(card.name),
      });
      setQueueNameInput('');
      setQueueNameModalItemId(null);
    } finally {
      setQueueAdminSubmitting(false);
    }
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
            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-900 p-0.5 ring-1 ring-slate-700 shadow-lg shadow-black/30">
              <img
                src="/images/OUTLAST_RO.png"
                alt="Outlast Guild"
                className="h-full w-full object-contain"
                width={48}
                height={48}
                decoding="async"
              />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
                Outlast Guild Bid
              </h1>
              <p className="text-slate-400 text-sm font-medium">Auction queue</p>
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
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
            <a
              href="/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white sm:w-auto"
            >
              Public board
            </a>
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  await logoutRequest();
                  onLogout();
                })();
              }}
              className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-xs font-black uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white sm:w-auto"
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden />
              Sign out
            </button>
          </div>
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
                {visibleActiveAuctions.length > 0 && (
                  <div className="flex w-full min-w-0 flex-col items-stretch gap-3 sm:items-end">
                    <div className="flex w-full flex-wrap items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => void handleShuffleAllQueues()}
                          disabled={shuffleUi.active || state?.shuffleLocked === true}
                          aria-busy={shuffleUi.active}
                          title={
                            state?.shuffleLocked === true
                              ? 'Already shuffled this round — use Reset shuffle / Unmark all to unlock shuffle again.'
                              : undefined
                          }
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-blue-600 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <Shuffle className="h-4 w-4 shrink-0" aria-hidden />
                          {state?.shuffleLocked === true ? 'Shuffle Used' : 'Start Shuffle'}
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
                        <button
                          type="button"
                          onClick={openWinnerSetLimitModal}
                          disabled={shuffleUi.active}
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-blue-700 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          Winner set limit
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleClearAllQueues()}
                          disabled={
                            shuffleUi.active || totalActiveQueueEntries === 0
                          }
                          title={
                            totalActiveQueueEntries === 0
                              ? 'No bidders in any active queue'
                              : 'Empty every active auction card’s queue (roster unchanged)'
                          }
                          className="inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-white transition-all hover:bg-amber-900/80 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          <ListX className="h-4 w-4 shrink-0" aria-hidden />
                          Clear all lists
                        </button>
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
                <div
                  className={
                    centerFewQueueCards
                      ? 'flex w-full min-w-0 flex-wrap justify-center gap-8 md:gap-8 xl:gap-6 2xl:gap-8'
                      : 'grid min-w-0 grid-cols-1 items-start gap-8 md:grid-cols-2 xl:grid-cols-3 xl:gap-6 2xl:gap-8'
                  }
                >
                  <AnimatePresence>
                    {visibleActiveAuctions.map((item) => (
                      <div
                        key={item.id}
                        className={
                          centerFewQueueCards
                            ? visibleActiveAuctions.length === 1
                              ? 'w-full min-w-0 max-w-xl shrink-0 sm:max-w-2xl'
                              : 'w-full min-w-0 shrink-0 md:max-w-[calc(50%-1rem)] md:basis-[calc(50%-1rem)] xl:max-w-lg 2xl:max-w-xl'
                            : 'min-w-0'
                        }
                      >
                        <QueueCard
                          item={item}
                          members={state.members}
                          isShuffling={shuffleUi.active}
                          showWinnerShortlist={
                            state.winnerShortlistUiEnabled === true
                          }
                          onOpenAddName={openQueueNameModal}
                          onEditMember={openEditMember}
                          onDeactivateMember={handleDeactivateMember}
                          onMoveQueueMember={handleQueueMove}
                          onComplete={handleCompleteAuction}
                        />
                      </div>
                    ))}
                  </AnimatePresence>
                </div>
                {visibleActiveAuctions.length === 0 && (
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
                        {filteredBidderRankingRows.length === 0 ? (
                          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center font-medium text-slate-500">
                            No entries match this search.
                          </p>
                        ) : (
                          <ul
                            className="space-y-2"
                            aria-label="Win and loss counts by bidder"
                          >
                            {filteredBidderRankingRows.map((row) => (
                              <li
                                key={row.ign.toLowerCase()}
                                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 sm:px-5 sm:py-3.5"
                              >
                                <span className="min-w-0 break-words font-bold text-amber-400">
                                  {row.ign}
                                </span>
                                <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-green-400">
                                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                      Win
                                    </span>
                                    {row.wins}
                                  </span>
                                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-rose-300">
                                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                      Loss
                                    </span>
                                    {row.losses}
                                  </span>
                                  <span className="inline-flex items-baseline gap-1.5 font-mono tabular-nums text-blue-300">
                                    <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                                      Ong
                                    </span>
                                    {row.ongoing}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    ) : (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
                        <p className="font-medium text-slate-500">
                          No ranking yet. Run <strong>Shuffle all queues</strong> or mark a winner so Win /
                          Loss / Ongoing counts show up here.
                        </p>
                      </div>
                    ))}

                  {bidderLogSubTab === 'weekly' &&
                    (bidderStateLogEntries.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
                        <p className="font-medium text-slate-500">
                          No weekly log yet. Run <strong>Shuffle all queues</strong> to record loss / ongoing
                          rows; a green check means a win —{' '}
                          <code className="text-xs text-slate-400">bidder_state_log</code>.
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
                                className={`cursor-pointer rounded-xl border px-4 py-2 text-[10px] font-black uppercase tracking-wide transition-colors sm:text-xs ${
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
                          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center font-medium text-slate-500">
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
                                className="flex flex-col gap-2 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5 sm:py-4"
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
                                      {row.poolCap != null && row.queuePosition != null ? (
                                        <>
                                          <span className="text-slate-600"> · </span>
                                          <span className="text-slate-500">
                                            pool {row.poolCap} · pos {row.queuePosition}
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
                  onChange={e => setQueueNameInput(e.target.value)}
                />
              </div>
              <button
                type="submit"
                disabled={queueAdminSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                {queueAdminSubmitting ? 'Checking…' : 'Add to queue'}
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
                  onChange={(e) => {
                    const nextType = e.target.value as ItemType;
                    setNewItemType(nextType);
                    setNewItemWinnerPoolCap(defaultWinnerPoolCapForType(nextType));
                  }}
                >
                  <option value="Fragment Card">Fragment Card</option>
                  <option value="LND">Light And Dark Feathers</option>
                  <option value="TNS">Time And Space Feathers</option>
                  <option value="Ancient Item">Ancient gear</option>
                  <option value="Other">Miscellaneous</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">
                  Winner limit
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={newItemWinnerPoolCap}
                  onChange={(e) =>
                    setNewItemWinnerPoolCap(
                      Math.max(0, Math.floor(Number(e.target.value) || 0))
                    )
                  }
                />
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

        {winnerSetLimitModalOpen && (
          <Modal
            title="Winner set limit"
            onClose={() => setWinnerSetLimitModalOpen(false)}
          >
            <form onSubmit={handleSaveWinnerSetLimit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                  Puppet Frag Card
                </label>
                <input
                  autoFocus
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={winnerSetLimitForm.fragment}
                  onChange={(e) =>
                    setWinnerSetLimitForm((prev) => ({
                      ...prev,
                      fragment: Math.max(
                        0,
                        Math.floor(
                          Number((e.target.value || '0').replace(/[^\d]/g, '')) || 0
                        )
                      ),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                  LND
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={winnerSetLimitForm.lnd}
                  onChange={(e) =>
                    setWinnerSetLimitForm((prev) => ({
                      ...prev,
                      lnd: Math.max(
                        0,
                        Math.floor(
                          Number((e.target.value || '0').replace(/[^\d]/g, '')) || 0
                        )
                      ),
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                  TNS
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={winnerSetLimitForm.tns}
                  onChange={(e) =>
                    setWinnerSetLimitForm((prev) => ({
                      ...prev,
                      tns: Math.max(
                        0,
                        Math.floor(
                          Number((e.target.value || '0').replace(/[^\d]/g, '')) || 0
                        )
                      ),
                    }))
                  }
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Save winner limits
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
  isShuffling,
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
  /** While shuffle animation runs, hide names and show loading skeletons. */
  isShuffling: boolean;
  /** When false, no shortlist row styling or green “mark winner” buttons (after Reset / Unmark). */
  showWinnerShortlist: boolean;
  onOpenAddName: (itemId: string) => void;
  onEditMember: (memberId: number) => void;
  onDeactivateMember: (memberId: number) => void | Promise<void>;
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
    ? maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap)
    : 0;
  const poolCap = maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
  const recorded = item.recordedWinnerNames ?? [];
  const canMarkMoreWinners = recorded.length < poolCap;

  return (
    <motion.div 
      layout
      onClick={() => onOpenAddName(item.id)}
      title="Click to add a name to this queue"
      className="group h-auto w-full min-w-0 max-w-full self-start bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 shadow-2xl sm:p-8 flex flex-col gap-5 sm:gap-6 cursor-pointer transition-[border-color,box-shadow,background-color,transform] duration-200 ease-out hover:border-blue-500/45 hover:bg-slate-800/60 hover:shadow-blue-900/25 hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
    >
      <div>
        <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-lg border font-mono ${typeColors[item.type]}`}>
          {item.type}
        </span>
        <h3 className="text-3xl font-black text-white mt-4 tracking-tight leading-none break-words">
          {displayAuctionItemName(item.name)}
        </h3>
        {recorded.length > 0 ? (
          <p className="mt-3 text-xs font-bold leading-snug text-green-400/95">
            Marked winners ({recorded.length}/{poolCap}):{' '}
            <span className="text-green-300">{recorded.join(', ')}</span>
          </p>
        ) : null}
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
            <div className="flex flex-col gap-2">
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
                    className={`flex min-h-10 items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${
                      idx < shortlistSlots
                        ? 'bg-blue-600/20 border-blue-500/50'
                        : 'bg-slate-900 border-slate-800'
                    } transition-all`}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
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
                        {isShuffling ? (
                          <span
                            aria-hidden
                            className="block h-4 w-28 max-w-full animate-pulse rounded-md bg-slate-700/80"
                          />
                        ) : (
                          m.name
                        )}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        disabled={isShuffling}
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
                        disabled={isShuffling}
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
                      {idx < shortlistSlots &&
                        !isShuffling &&
                        canMarkMoreWinners &&
                        !recorded.some(
                          (n) =>
                            n.trim().toLowerCase() === m.name.trim().toLowerCase()
                        ) && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onComplete(item.id, m.name);
                          }}
                          title="Click to mark winner (weekly type lock). Saves immediately with your other changes."
                          aria-label={`Mark ${m.name} as winner`}
                          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg bg-green-500 text-white shadow-sm shadow-green-950/30 transition-colors hover:bg-green-400 active:scale-95"
                        >
                          <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
              <div
                className="mt-0 flex min-h-8 items-center justify-center rounded-lg border border-dashed border-transparent py-2 text-[10px] font-bold uppercase tracking-wide text-slate-600 hover:border-slate-700"
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
            </div>
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
