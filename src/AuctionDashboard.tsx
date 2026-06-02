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
  GripVertical,
  UserPlus,
  X,
  XCircle,
  Eye,
  EyeOff,
  Trophy,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  AuctionItem,
  AuctionState,
  GuildRank,
  GuildMember,
  ItemType,
  WeeklyEventType,
} from './types';
import { saveState } from './lib/storage';
import { AUCTION_DATA_VERSION } from './data/auctionDefaults';
import {
  activeFragmentAuctionItems,
  buildFragmentLimitsByItemId,
  featherLogTypeMatches,
  fragmentCountForItem,
} from './lib/featherMigration';
import {
  findMemberByIgnIdentity,
  ignMatchesForQueueIdentity,
  matchingIgnOnQueueItem,
} from './lib/ignQueueIdentity';
import { displayAuctionItemTypeBadge, auctionItemTypeColorClass } from './lib/auctionItemTypeColors';
import {
  defaultEventModeForQueues,
  findOtherActiveQueueBlockingWithMatch,
  shuffleLockClosesPublicSignup,
  weeklyTypeWinBlocksQueueJoin,
} from './lib/queueEligibility';
import { findEmperiumWinCooldown } from './lib/emperiumWinCooldown';
import { emperiumWinCooldownExpiresAt } from './lib/overrunWeek';
import {
  deactivateMemberOnServer,
  removeMemberFromItemQueueOnServer,
  fetchAuctionState,
  persistAuctionState,
  publicAddBidToQueue,
  PublicAddBidError,
  setEventModeOnServer,
  clearAllActiveQueuesOnServer,
} from './lib/apiState';
import { randomId } from './lib/randomId';
import { nextTempMemberId } from './lib/tempMemberId';
import {
  swal2QueueMemberAdded,
  swal2QueueAlreadyListed,
  swal2QueueAlreadyOnAnotherItem,
  swal2NameAlreadyTaken,
  swal2MemberNameUpdated,
  swal2SaveError,
  swal2ConfirmRemoveFromQueue,
  swal2ConfirmRemoveMember,
  swal2ConfirmClearAllQueues,
  swal2ConfirmShuffleAllQueues,
  swal2ConfirmShuffleDrawFree,
  swal2ConfirmResetShuffleUnmark,
  swal2ConfirmUnmarkWinner,
  swal2ConfirmUnmarkAddedWinner,
  swal2WinnerMarked,
  swal2WinnerUnmarked,
  swal2WinnerPoolFull,
  swal2EmperiumWinCooldown,
  swal2WinnerLimitsUpdated,
  swal2ConfirmSaveEventMode,
  swal2EventModeSaved,
} from './lib/sweetAlert2';
import {
  dedupeIgnAcrossActiveQueues,
  normalizeWinnerPoolCapsForLimits,
  normalizeQueuesForEventMode,
  pruneOrphanQueueMembers,
} from './lib/dedupeIgnAcrossQueues';
import {
  applyQueueMemberMove,
  parseQueueDragPayload,
  QUEUE_DRAG_MIME,
  type QueueMovePayload,
} from './lib/queueMove';
import {
  buildQueueBaselineFromState,
  mergeQueuesForPersist,
  type QueueBaselineByItemId,
} from './lib/mergeAuctionQueues';
import {
  defaultWinnerPoolCapForType,
  maxQueueSlotsAfterShuffle,
  shuffleFreeDrawTail,
  shuffleQueueIdsForType,
} from './lib/shuffleCaps';
import { applySureWinPin } from './lib/sureWinPin';
import { displayAuctionItemName } from './lib/formatAuctionItemName';
import {
  shuffleRevealWindowForItem,
  sortAuctionItemsForDisplay,
} from './lib/auctionItemDisplayOrder';
import { isAuctionItemHidden } from './lib/hiddenAuctionItems';
import { resolveEffectiveRewardContext, displayWinnerPoolCapForItem } from './lib/rewardContext';
import { formatAuctionLogTime } from './lib/formatAuctionLogTime';
import { filterToCurrentAuctionWeek, getAuctionWeekMondayKey } from './lib/auctionWeek';
import {
  featherItemsPerWinnerUnit,
  defaultFeathersItemsPerWinner,
  featherPageCountBeforePartialFree,
  featherRewardSpanFourItemPages,
  fragmentGeneralPageSpan,
  freeItemsFromTotalItems,
  GUILD_RANK_OPTIONS,
  parseGuildRank,
  totalItemsForTypeByRank,
  winnerSlotsFromTotalItems,
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
import BidderAuditLogSection from './components/BidderAuditLogSection';
import BidderRegistration from './BidderRegistration';
import BidderAuthModal from './BidderAuthModal';
import { NameDropdown } from './BidderAuthGate';
import {
  ActiveMember,
  BidderActor,
  clearStoredActor,
  fetchActiveMembers,
  fetchPendingBidders,
  loadStoredActor,
  storeActor,
  verifyMemberRequest,
  verifyStoredActor,
} from './lib/apiBidders';
import { notifyBidderAuditChanged } from './lib/apiBidderAudit';
import { DashboardTab, pathForTab, tabFromPath } from './lib/tabRoute';

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
      revokedWinnerNames: it.revokedWinnerNames,
      winnerName: it.winnerName,
      status: it.status,
      createdAt: it.createdAt,
    })),
    weeklyTypeWins: s.weeklyTypeWins,
    winnerMarkLog: s.winnerMarkLog,
    bidderStateLog: s.bidderStateLog,
    shuffleLocked: s.shuffleLocked,
    winnerShortlistUiEnabled: s.winnerShortlistUiEnabled,
    eventMode: s.eventMode,
    rewardRank: s.rewardRank,
    rewardItemCounts: s.rewardItemCounts,
    dataVersion: s.dataVersion,
    freeDrawChosenByItemId: s.freeDrawChosenByItemId ?? {},
    shuffleWinnerSlotsByItemId: s.shuffleWinnerSlotsByItemId ?? {},
  });
}

const DEFAULT_EVENT_MODE: WeeklyEventType = 'Emperium Overrun';

function rankPresetLimits(rank: GuildRank): { fragment: number; feathers: number } {
  return {
    fragment: totalItemsForTypeByRank('Fragment Card', rank),
    feathers: totalItemsForTypeByRank('Feathers', rank),
  };
}

function guildRankButtonLabel(rank: GuildRank): string {
  if (rank === 'Emperium overrun') return 'Emperium Overrun';
  return rank;
}

export default function AuctionDashboard() {
  const [state, setState] = useState<AuctionState | null>(null);
  const mayPersist = useRef(false);
  const skipInitialPersist = useRef(1);
  const latestState = useRef<AuctionState | null>(null);
  latestState.current = state;
  /** True while the debounced persist timer is waiting (local state not yet on server). */
  const persistDebouncePendingRef = useRef(false);
  /** True while `persistAuctionState` HTTP is in flight. */
  const persistInFlightRef = useRef(false);
  /** IGN sets per item from last server poll — used so admin save does not wipe new public bids. */
  const queueBaselineRef = useRef<QueueBaselineByItemId>(new Map());
  /** Skip one debounced persist after applying a read-only server poll. */
  const skipPersistAfterPollRef = useRef(false);
  /** Skip one debounced persist after an immediate save (e.g. clear all queues). */
  const skipPersistOnceRef = useRef(false);
  const persistDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [clearQueuesSaving, setClearQueuesSaving] = useState(false);

  const cancelPendingPersist = () => {
    if (persistDebounceTimerRef.current != null) {
      window.clearTimeout(persistDebounceTimerRef.current);
      persistDebounceTimerRef.current = null;
    }
    persistDebouncePendingRef.current = false;
  };

  const [activeTab, setActiveTabState] = useState<DashboardTab>(() =>
    typeof window === 'undefined' ? 'dashboard' : tabFromPath(window.location.pathname)
  );

  /** Switch tab and keep `window.location.pathname` in sync (back/forward works). */
  const setActiveTab = (next: DashboardTab) => {
    setActiveTabState((prev) => {
      if (typeof window !== 'undefined') {
        const targetPath = pathForTab(next);
        const { pathname, search, hash } = window.location;
        if (pathname !== targetPath) {
          window.history.pushState(null, '', `${targetPath}${search}${hash}`);
        }
      }
      return next === prev ? prev : next;
    });
  };

  useEffect(() => {
    const handler = () => setActiveTabState(tabFromPath(window.location.pathname));
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  /** Read-only ref so polling can early-return on tabs that do not need live state. */
  const activeTabRef = useRef(activeTab);
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  /**
   * Keep-alive set: once a tab has been opened we keep it mounted (hidden via
   * CSS) so switching back is instant — React does not have to re-construct
   * the heavy Queues/Logs DOM on every tab change.
   */
  const [visitedTabs, setVisitedTabs] = useState<Set<DashboardTab>>(
    () => new Set([activeTab])
  );
  useEffect(() => {
    setVisitedTabs((prev) => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);
  const [isAddItemOpen, setIsAddItemOpen] = useState(false);
  const [queueNameModalItemId, setQueueNameModalItemId] = useState<string | null>(null);
  const [queueNameInput, setQueueNameInput] = useState('');
  const [queueJoinPassword, setQueueJoinPassword] = useState('');
  const [queueJoinShowPassword, setQueueJoinShowPassword] = useState(false);
  const [queueAdminSubmitting, setQueueAdminSubmitting] = useState(false);
  // List of every active member (any role) for the searchable Join-queue
  // dropdown. Lazily fetched the first time the modal opens, then refreshed
  // each subsequent open in case Bidders were added/removed in the interim.
  const [activeMembersForJoin, setActiveMembersForJoin] = useState<ActiveMember[]>([]);
  const [activeMembersLoading, setActiveMembersLoading] = useState(false);
  const [activeMembersError, setActiveMembersError] = useState<string | null>(null);

  // Pending public registrations awaiting Approve / Reject. We only poll for
  // this count when the visitor is signed in as a privileged actor (the
  // `/api/bidders/pending` endpoint requires that gate anyway). The number
  // is surfaced as a badge on the BIDDERS tab in the top nav so officers /
  // admins / developers see at a glance that there's work to do, without
  // having to open the Bidders tab first.
  const [pendingBidderCount, setPendingBidderCount] = useState(0);
  useEffect(() => {
    const stored = loadStoredActor();
    if (!stored) {
      setPendingBidderCount(0);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await fetchPendingBidders();
        if (!cancelled) setPendingBidderCount(list.length);
      } catch {
        // Silent — the badge is best-effort. If the session expired the
        // Bidders tab itself will surface the error when the user opens it.
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 15_000);
    // BidderRegistration broadcasts this custom event after an Approve /
    // Reject so the badge updates instantly instead of waiting for the next
    // poll. Keeps the parent decoupled from the child's internals.
    const onMutated = () => {
      void tick();
    };
    window.addEventListener('pendingBiddersChanged', onMutated);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener('pendingBiddersChanged', onMutated);
    };
    // We intentionally re-evaluate whenever the active tab changes so that a
    // freshly-signed-in actor (returning from the Bidders gate) starts
    // populating the badge immediately, and signing out clears it.
  }, [activeTab]);

  useEffect(() => {
    if (!queueNameModalItemId) return;
    let cancelled = false;
    setActiveMembersLoading(true);
    setActiveMembersError(null);
    fetchActiveMembers()
      .then((list) => {
        if (!cancelled) setActiveMembersForJoin(list);
      })
      .catch((e) => {
        if (!cancelled) {
          setActiveMembersError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!cancelled) setActiveMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queueNameModalItemId]);

  /** Reset every piece of state that backs the Join-queue modal. */
  const closeJoinQueueModal = () => {
    setQueueNameModalItemId(null);
    setQueueNameInput('');
    setQueueJoinPassword('');
    setQueueJoinShowPassword(false);
  };
  const [editMemberId, setEditMemberId] = useState<number | null>(null);
  const [editMemberNameInput, setEditMemberNameInput] = useState('');
  const [winnerSetLimitModalOpen, setWinnerSetLimitModalOpen] = useState(false);
  const [winnerSetLimitForm, setWinnerSetLimitForm] = useState<{
    rank: GuildRank;
    feathers: number;
    feathersItemsPerWinner: number;
    fragmentByItemId: Record<string, number>;
  }>({
    rank: 'Bronze',
    feathers: defaultWinnerPoolCapForType('Feathers'),
    feathersItemsPerWinner: defaultFeathersItemsPerWinner('Bronze'),
    fragmentByItemId: {},
  });
  const winnerSlotsFromItems = (type: ItemType, items: number): number => {
    return winnerSlotsFromTotalItems(type, items, winnerSetLimitForm.rank, {
      feathersItemsPerWinner: winnerSetLimitForm.feathersItemsPerWinner,
    });
  };

  const [newItemName, setNewItemName] = useState('');
  const [newItemType, setNewItemType] = useState<ItemType>('Fragment Card');
  const [newItemWinnerPoolCap, setNewItemWinnerPoolCap] = useState<number>(
    defaultWinnerPoolCapForType('Fragment Card')
  );

  /** Full-width shuffle tension bar (0–100%) */
  const [shuffleUi, setShuffleUi] = useState<{
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
  const [bidderLogSubTab, setBidderLogSubTab] = useState<'ranking' | 'weekly'>(
    'ranking'
  );
  const [bidderLogSearch, setBidderLogSearch] = useState('');
  const [bidderRankingSearch, setBidderRankingSearch] = useState('');
  const [weeklyLogFilter, setWeeklyLogFilter] = useState<
    'all' | BidderLogStateFilter | 'm1' | 'm2'
  >('all');
  const [eventModeDraft, setEventModeDraft] = useState<WeeklyEventType>(DEFAULT_EVENT_MODE);
  const [eventModeSaving, setEventModeSaving] = useState(false);
  const eventModeActive = state?.eventMode ?? DEFAULT_EVENT_MODE;
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
      const initial =
        remote ?? {
          items: [],
          members: [],
          dataVersion: AUCTION_DATA_VERSION,
        };
      queueBaselineRef.current = buildQueueBaselineFromState(initial);
      setState(
        normalizeWinnerPoolCapsForLimits(
          dedupeIgnAcrossActiveQueues(
            pruneOrphanQueueMembers(initial)
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
    setEventModeDraft(eventModeActive);
  }, [eventModeActive]);

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
    if (skipPersistAfterPollRef.current) {
      skipPersistAfterPollRef.current = false;
      return;
    }
    if (skipPersistOnceRef.current) {
      skipPersistOnceRef.current = false;
      return;
    }
    if (skipInitialPersist.current > 0) {
      skipInitialPersist.current -= 1;
      return;
    }
    persistDebouncePendingRef.current = true;
    cancelPendingPersist();
    const id = window.setTimeout(() => {
      persistDebounceTimerRef.current = null;
      persistDebouncePendingRef.current = false;
      const snap = latestState.current;
      if (!snap) return;
      persistInFlightRef.current = true;
      (async () => {
        const remote = await fetchAuctionState();
        const merged =
          remote != null
            ? mergeQueuesForPersist(snap, remote, queueBaselineRef.current)
            : snap;
        let toSave = normalizeQueuesForEventMode(merged);
        // Client normalization can rewrite reward limits for display; keep the
        // server snapshot on PUT so routine queue edits don't require Officer auth.
        if (remote != null) {
          toSave = {
            ...toSave,
            rewardRank: remote.rewardRank ?? toSave.rewardRank,
            rewardItemCounts: remote.rewardItemCounts ?? toSave.rewardItemCounts,
          };
        }
        return persistAuctionState(toSave);
      })()
        .then((server) => {
          if (!server) return;
          queueBaselineRef.current = buildQueueBaselineFromState(server);
          setState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              members: server.members,
              items: server.items,
              winnerMarkLog: server.winnerMarkLog ?? prev.winnerMarkLog,
              bidderStateLog: server.bidderStateLog ?? prev.bidderStateLog,
              weeklyTypeWins: server.weeklyTypeWins ?? prev.weeklyTypeWins,
              freeDrawChosenByItemId:
                server.freeDrawChosenByItemId ?? prev.freeDrawChosenByItemId,
              shuffleWinnerSlotsByItemId:
                server.shuffleWinnerSlotsByItemId ?? prev.shuffleWinnerSlotsByItemId,
              shuffleLocked: server.shuffleLocked ?? prev.shuffleLocked,
              winnerShortlistUiEnabled:
                server.winnerShortlistUiEnabled ?? prev.winnerShortlistUiEnabled,
              eventMode: server.eventMode ?? prev.eventMode,
              rewardRank: server.rewardRank ?? prev.rewardRank,
              rewardItemCounts: server.rewardItemCounts ?? prev.rewardItemCounts,
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
                normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
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
    persistDebounceTimerRef.current = id;
    return () => {
      window.clearTimeout(id);
      if (persistDebounceTimerRef.current === id) {
        persistDebounceTimerRef.current = null;
      }
      persistDebouncePendingRef.current = false;
    };
  }, [state]);

  /** Merge in public (and other tab) queue changes while admin is idle; skip during debounce / save. */
  useEffect(() => {
    const applyRemote = async () => {
      if (document.visibilityState === 'hidden') return;
      if (!mayPersist.current) return;
      // Bidder Registration tab has its own data source (`/api/bidders`); polling
      // the full auction state here just churns CPU on the parent component.
      if (activeTabRef.current === 'bidders') return;
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
      const normalized = normalizeQueuesForEventMode(remote);
      const guildDupesRemoved =
        defaultEventModeForQueues(normalized.eventMode) === 'Guild League' &&
        auctionPollSnapshot(remote) !== auctionPollSnapshot(normalized);

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
        queueBaselineRef.current = buildQueueBaselineFromState(normalized);
        skipPersistAfterPollRef.current = true;
        return normalized;
      });

      if (guildDupesRemoved) {
        persistInFlightRef.current = true;
        try {
          const server = await persistAuctionState(normalized);
          if (server) {
            queueBaselineRef.current = buildQueueBaselineFromState(server);
            setState(normalizeQueuesForEventMode(server));
          }
        } catch (e) {
          console.error('[api] guild league dedupe persist failed', e);
        } finally {
          persistInFlightRef.current = false;
        }
      }
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

  const effectiveReward = useMemo(
    () => (state ? resolveEffectiveRewardContext(state) : null),
    [state]
  );

  const activeAuctions = useMemo(
    () =>
      sortAuctionItemsForDisplay(
        state?.items.filter((item) => item.status === 'active') ?? []
      ),
    [state]
  );

  const visibleActiveAuctions = useMemo(
    () =>
      activeAuctions.filter(
        (item) => !isAuctionItemHidden(item, state?.eventMode)
      ),
    [activeAuctions, state?.eventMode]
  );

  /** Fewer visible cards than xl columns — center the row instead of hugging the left. */
  const centerFewQueueCards =
    visibleActiveAuctions.length > 0 && visibleActiveAuctions.length < 3;
  const featherPageStartByItemId = useMemo(() => {
    const counts =
      effectiveReward?.counts ??
      rankPresetLimits(parseGuildRank(state?.rewardRank));
    const featherItems = (state?.items ?? [])
      .filter(
        (it) =>
          it.status === 'active' &&
          !isAuctionItemHidden(it, state?.eventMode) &&
          (it.type === 'Fragment Card' || it.type === 'Feathers')
      )
      .sort((a, b) => Number(a.createdAt) - Number(b.createdAt));
    const rewardRank = parseGuildRank(state?.rewardRank);
    const out: Record<string, number> = {};
    let nextPage = 1;
    for (const it of featherItems) {
      out[it.id] = nextPage;
      const totalItems =
        it.type === 'Fragment Card'
          ? fragmentCountForItem(counts, it.id)
          : counts.feathers;
      nextPage +=
        it.type === 'Fragment Card'
          ? fragmentGeneralPageSpan(totalItems)
          : featherRewardSpanFourItemPages(it.type, totalItems);
    }
    return out;
  }, [state?.items, state?.eventMode, effectiveReward]);

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
        (it) => isAuctionItemHidden(it, state?.eventMode)
      ),
    [state?.items, state?.members, state?.eventMode]
  );

  const publicSignupClosedByShuffle = useMemo(
    () =>
      shuffleLockClosesPublicSignup(
        state?.shuffleLocked === true,
        state?.eventMode
      ),
    [state?.shuffleLocked, state?.eventMode]
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
      const typeFilter: 'all' | 'm1' | 'm2' =
        weeklyLogFilter === 'm1' || weeklyLogFilter === 'm2'
          ? weeklyLogFilter
          : 'all';

      return bidderStateLogEntriesSorted.filter(
        (row) =>
          getAuctionWeekMondayKey(row.at) === weekKey &&
          row.state !== BIDDER_STATE_ONGOING &&
          (typeFilter === 'all' ||
            (typeFilter === 'm1' && row.itemType === 'Fragment Card') ||
            (typeFilter === 'm2' && featherLogTypeMatches(row.itemType, 'm2'))) &&
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

  // Event-mode change is restricted to Admin/Developer. We reuse the same
  // session token / sign-in modal flow as queue-remove, but with a stricter
  // role filter (Admin + Developer only). Server-side `/api/state/event-mode`
  // also enforces this so a tampered client cannot bypass the check.
  const [eventModeAuthPromptOpen, setEventModeAuthPromptOpen] = useState(false);
  const pendingEventModeRef = useRef<'Guild League' | 'Emperium Overrun' | null>(
    null
  );

  const performEventModeSave = async (
    mode: 'Guild League' | 'Emperium Overrun',
    token: string
  ) => {
    if (!state) return;
    if (mode === eventModeActive) return;
    setEventModeSaving(true);

    // Same immediate-save + polling-lockout pattern as `handleQueueMove` /
    // `handleAddNameToQueue`. Without this lock, a polling cycle that was
    // already mid-fetch when the user clicked Save returns AFTER the
    // persist finishes, sees its (stale) snapshot, and reverts the event
    // mode back to what was on the server before our save.
    cancelPendingPersist();
    persistInFlightRef.current = true;
    skipPersistAfterPollRef.current = false;

    try {
      const server = await setEventModeOnServer(mode, token);
      // Suppress the debounced save that would otherwise be scheduled by
      // this setState — the server is already authoritative.
      skipPersistOnceRef.current = true;
      const finalState = normalizeWinnerPoolCapsForLimits(
        dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
      );
      queueBaselineRef.current = buildQueueBaselineFromState(finalState);
      setState(finalState);
      notifyBidderAuditChanged();
      void swal2EventModeSaved(server.eventMode ?? mode);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|expired|admin or developer/i.test(msg)) {
        // Stored token rejected or insufficient role — drop it and re-prompt.
        clearStoredActor();
        pendingEventModeRef.current = mode;
        setEventModeAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not save event mode');
      try {
        const recovered = await fetchAuctionState();
        if (recovered) {
          queueBaselineRef.current = buildQueueBaselineFromState(recovered);
          setState(
            normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      persistInFlightRef.current = false;
      setEventModeSaving(false);
    }
  };

  const handleSaveEventMode = async () => {
    if (!state || eventModeDraft === eventModeActive || eventModeSaving) return;
    const ok = await swal2ConfirmSaveEventMode(eventModeActive, eventModeDraft);
    if (!ok) return;

    // Admin/Developer gate: reuse the stored Bidders-tab session if its role
    // qualifies; otherwise pop the sign-in modal restricted to those roles.
    const stored = loadStoredActor();
    if (stored && (stored.role === 'Admin' || stored.role === 'Developer')) {
      await performEventModeSave(eventModeDraft, stored.token);
      return;
    }
    pendingEventModeRef.current = eventModeDraft;
    setEventModeAuthPromptOpen(true);
  };

  const handleEventModeAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setEventModeAuthPromptOpen(false);
    const pending = pendingEventModeRef.current;
    pendingEventModeRef.current = null;
    if (pending && (actor.role === 'Admin' || actor.role === 'Developer')) {
      void performEventModeSave(pending, actor.token);
    }
  };

  const handleEventModeAuthCancel = () => {
    setEventModeAuthPromptOpen(false);
    pendingEventModeRef.current = null;
  };

  // Bearer token that authorizes the privileged shuffle-lock transition on
  // the server. Captured at "Start Shuffle" time (either from a fresh
  // sessionStorage actor or from the sign-in modal) and passed through to
  // `persistAuctionState` when the 20-second animation completes.
  const shuffleBearerRef = useRef<string | null>(null);
  const [shuffleAuthPromptOpen, setShuffleAuthPromptOpen] = useState(false);

  const startShuffleNow = async (bearerToken: string) => {
    if (!latestState.current || shuffleRunningRef.current) return;
    if (latestState.current.shuffleLocked === true) return;
    const snapshot = latestState.current;
    const shuffleReward = resolveEffectiveRewardContext(snapshot);
    const activeItemsForShuffle = sortAuctionItemsForDisplay<AuctionItem>(
      snapshot.items.filter(
        (it) =>
          it.status === 'active' &&
          !isAuctionItemHidden(it, snapshot.eventMode)
      )
    );
    const totalParticipants = activeItemsForShuffle.reduce(
      (sum, it) => sum + it.interestedMemberIds.length,
      0
    );
    const ok = await swal2ConfirmShuffleAllQueues({
      totalParticipants,
      cards: activeItemsForShuffle.map((it) => ({
        name: displayAuctionItemName(it.name),
        bidders: it.interestedMemberIds.length,
        winnerLimit: displayWinnerPoolCapForItem(
          it,
          shuffleReward.rank,
          shuffleReward.counts
        ),
      })),
    });
    if (!ok) return;
    shuffleBearerRef.current = bearerToken;
    shuffleRunningRef.current = true;
    const previewQueueByItemId: Record<string, number[]> = {};
    for (const it of activeItemsForShuffle) {
      // Random shuffle first, then apply the optional "sure win" pin (env-
      // controlled, see VITE_SURE_WIN_* in .env). Pin is a no-op when the
      // toggle is off, the configured member did not bid on this item, or
      // the item name does not match the configured needle.
      const shuffled = shuffleQueueIdsForType(
        it.interestedMemberIds,
        it.type
      );
      previewQueueByItemId[it.id] = applySureWinPin(shuffled, it.name);
    }
    setShuffleUi({
      active: true,
      spinOffsetByItemId: {},
      revealCountByItemId: {},
      previewQueueByItemId,
    });

    const durationMs = 20_000;
    const t0 = performance.now();
    const activeItemIds = activeItemsForShuffle.map((it) => it.id);
    let lastPickAt = 0;
    const spinOffsetByItemIdLocal: Record<string, number> = {};
    const tick = (now: number) => {
      if (shuffleUnmountRef.current) {
        shuffleRunningRef.current = false;
        shuffleRafRef.current = null;
        setShuffleUi({
          active: false,
          spinOffsetByItemId: {},
          revealCountByItemId: {},
          previewQueueByItemId: {},
        });
        return;
      }
      const raw = Math.min(1, (now - t0) / durationMs);
      // Spin quickly first, then slow down while revealing winners one-by-one.
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
            item
              ? displayWinnerPoolCapForItem(
                  item,
                  shuffleReward.rank,
                  shuffleReward.counts
                )
              : 0
          );
          const window = item
            ? shuffleRevealWindowForItem(item, activeItemsForShuffle)
            : { start: 0.55, end: 1.0 };
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
        setShuffleUi({
          active: true,
          spinOffsetByItemId,
          revealCountByItemId,
          previewQueueByItemId,
        });
      }

      if (raw < 1) {
        shuffleRafRef.current = requestAnimationFrame(tick);
        return;
      }

      shuffleRafRef.current = null;
      shuffleRunningRef.current = false;
      const bearer = shuffleBearerRef.current ?? '';
      shuffleBearerRef.current = null;

      const prevState = latestState.current;
      if (!prevState) {
        setShuffleUi({
          active: false,
          spinOffsetByItemId: {},
          revealCountByItemId: {},
          previewQueueByItemId: {},
        });
        return;
      }
      const shuffleWinnerSlotsByItemId: Record<string, number> = {};
      for (const it of activeItemsForShuffle) {
        shuffleWinnerSlotsByItemId[it.id] = displayWinnerPoolCapForItem(
          it,
          shuffleReward.rank,
          shuffleReward.counts
        );
      }
      const nextOptimistic: AuctionState = {
        ...prevState,
        shuffleLocked: true,
        winnerShortlistUiEnabled: true,
        freeDrawChosenByItemId: {},
        shuffleWinnerSlotsByItemId,
        items: prevState.items.map((item) => {
          if (item.status !== 'active') return item;
          if (isAuctionItemHidden(item, prevState.eventMode)) return item;
          const preview = previewQueueByItemId[item.id];
          return {
            ...item,
            /** Green checks tinatanggal lang sa Reset shuffle; queue pinapanatili ang lahat ng member. */
            interestedMemberIds:
              preview ??
              applySureWinPin(
                shuffleQueueIdsForType(item.interestedMemberIds, item.type),
                item.name
              ),
          };
        }),
      };

      // Optimistic render (winners visible immediately), followed by an
      // immediate-save that lock-outs polling and sends the privileged
      // bearer. Server gates the shuffleLocked false→true transition; a
      // 401 means the stored session expired or got demoted.
      cancelPendingPersist();
      persistInFlightRef.current = true;
      skipPersistAfterPollRef.current = false;
      skipPersistOnceRef.current = true;
      setState(nextOptimistic);
      setShuffleUi({
        active: false,
        spinOffsetByItemId: {},
        revealCountByItemId: {},
        previewQueueByItemId: {},
      });

      void (async () => {
        try {
          const server = await persistAuctionState(nextOptimistic, {
            bearerToken: bearer,
          });
          const merged = server ?? nextOptimistic;
          skipPersistOnceRef.current = true;
          const finalState = normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(merged))
          );
          queueBaselineRef.current = buildQueueBaselineFromState(finalState);
          setState(finalState);
          notifyBidderAuditChanged();
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/sign in|401|expired|officer/i.test(msg)) clearStoredActor();
          void swal2SaveError(msg || 'Could not save shuffle result');
          try {
            const recovered = await fetchAuctionState();
            if (recovered) {
              queueBaselineRef.current = buildQueueBaselineFromState(recovered);
              setState(
                normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
              );
            }
          } catch {
            /* ignore */
          }
        } finally {
          persistInFlightRef.current = false;
        }
      })();
    };

    shuffleRafRef.current = requestAnimationFrame(tick);
  };

  const handleShuffleAllQueues = async () => {
    if (!latestState.current || shuffleRunningRef.current) return;
    if (latestState.current.shuffleLocked === true) return;

    // Pre-flight: validate the stored bearer against the server BEFORE we
    // play the 20-second animation. Otherwise a stale token (e.g. after a
    // server restart cleared its in-memory session map) would let the user
    // watch the whole reveal only to hit a 401 at the persist step.
    const stored = loadStoredActor();
    if (stored) {
      try {
        const fresh = await verifyStoredActor();
        if (fresh) {
          storeActor(fresh);
          await startShuffleNow(fresh.token);
          return;
        }
        // Token explicitly rejected (401/403): wipe and re-prompt.
        clearStoredActor();
      } catch {
        // Transport-level failure (network down, 5xx): wipe the stale-
        // looking token and ask the user to sign in again rather than
        // gambling on a 20-second animation that may fail.
        clearStoredActor();
      }
    }
    setShuffleAuthPromptOpen(true);
  };

  const handleShuffleAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setShuffleAuthPromptOpen(false);
    void startShuffleNow(actor.token);
  };

  const handleShuffleAuthCancel = () => {
    setShuffleAuthPromptOpen(false);
  };

  /** Re-randomize order below winner shortlist only (Feathers with partial free page). */
  const handleShuffleDrawFree = async (itemId: string) => {
    if (!state || state.shuffleLocked !== true || shuffleUi.active) return;
    const item = state.items.find((i) => i.id === itemId);
    if (!item || item.status !== 'active') return;
    if (item.type !== 'Feathers') return;
    const rank = parseGuildRank(state.rewardRank);
    const counts = state.rewardItemCounts ?? rankPresetLimits(rank);
    const totalItems = counts.feathers;
    if (freeItemsFromTotalItems(item.type, totalItems, rank, counts) <= 0) return;
    const pool = maxQueueSlotsAfterShuffle(item.type, item.winnerPoolCap);
    const ids = item.interestedMemberIds;
    if (ids.length <= pool) return;
    const ok = await swal2ConfirmShuffleDrawFree({
      itemName: displayAuctionItemName(item.name),
    });
    if (!ok) return;
    const recordedLower = new Set(
      (item.recordedWinnerNames ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean)
    );
    const isRecordedWinner = (memberId: number): boolean => {
      const name =
        state.members.find((m) => m.id === memberId)?.name?.trim().toLowerCase() ?? '';
      return name.length > 0 && recordedLower.has(name);
    };
    const { ordered: nextIds, chosenMemberId } = shuffleFreeDrawTail(
      ids,
      pool,
      item.type,
      isRecordedWinner
    );
    if (chosenMemberId == null) return;
    const nextState: AuctionState = {
      ...state,
      freeDrawChosenByItemId: {
        ...(state.freeDrawChosenByItemId ?? {}),
        [itemId]: chosenMemberId,
      },
      items: state.items.map((it) =>
        it.id === itemId ? { ...it, interestedMemberIds: nextIds } : it
      ),
    };
    setState(
      normalizeWinnerPoolCapsForLimits(
        dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(nextState))
      )
    );
  };

  // Reset shuffle is stricter than Start shuffle: Admin / Developer only.
  // Same session-token flow — if the stored Bidders-tab actor already
  // qualifies, skip the modal; otherwise pop the auth dialog with the
  // tightened role filter.
  const [resetShuffleAuthPromptOpen, setResetShuffleAuthPromptOpen] =
    useState(false);

  const performResetShuffleUnmarkAll = async (bearerToken: string) => {
    if (!state) return;
    const ignKey = (memberId: number) => {
      const n = state.members.find((m) => m.id === memberId)?.name?.trim() ?? '';
      return n.toLowerCase();
    };
    const next: AuctionState = {
      ...state,
      shuffleLocked: false,
      winnerShortlistUiEnabled: false,
      weeklyTypeWins: [],
      freeDrawChosenByItemId: {},
      shuffleWinnerSlotsByItemId: {},
      items: state.items.map((item) => {
        // Cancelled items stay cancelled — they include duplicate Feathers
        // rows that `migrateFeatherItems` merged into a single survivor.
        // Force-flipping them to "active" briefly resurrected ghost cards
        // (e.g. a 2nd Feathers card flashing in after Reset shuffle) until
        // the server response re-applied the migration.
        const reopened: AuctionItem = {
          ...item,
          status: item.status === 'cancelled' ? 'cancelled' : 'active',
          winnerName: null,
          recordedWinnerNames: [] as string[],
          revokedWinnerNames: [] as string[],
        };
        const ids = [...reopened.interestedMemberIds].sort((a, b) => {
          const ka = ignKey(a);
          const kb = ignKey(b);
          const c = ka.localeCompare(kb, undefined, { sensitivity: 'base' });
          if (c !== 0) return c;
          return a - b;
        });
        return { ...reopened, interestedMemberIds: ids };
      }),
    };

    skipPersistOnceRef.current = true;
    setState(next);
    persistInFlightRef.current = true;
    try {
      const remote = await fetchAuctionState();
      const toSave =
        remote != null
          ? mergeQueuesForPersist(next, remote, queueBaselineRef.current)
          : next;
      const server = await persistAuctionState(toSave, { bearerToken });
      if (server) {
        queueBaselineRef.current = buildQueueBaselineFromState(server);
        setState(
          normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
          )
        );
        notifyBidderAuditChanged();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|expired|admin or developer/i.test(msg)) {
        clearStoredActor();
        setResetShuffleAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not reset shuffle');
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const handleResetShuffleUnmarkAll = async () => {
    if (!state) return;
    const ok = await swal2ConfirmResetShuffleUnmark();
    if (!ok) return;
    const stored = loadStoredActor();
    if (stored && (stored.role === 'Admin' || stored.role === 'Developer')) {
      await performResetShuffleUnmarkAll(stored.token);
      return;
    }
    setResetShuffleAuthPromptOpen(true);
  };

  const handleResetShuffleAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setResetShuffleAuthPromptOpen(false);
    if (actor.role === 'Admin' || actor.role === 'Developer') {
      void performResetShuffleUnmarkAll(actor.token);
    }
  };

  const handleResetShuffleAuthCancel = () => {
    setResetShuffleAuthPromptOpen(false);
  };

  /** Admin/Developer only — adjust winner marks after shuffle is locked. */
  type WinnerMarkAction =
    | { kind: 'mark'; itemId: string; winnerName: string }
    | { kind: 'unmark'; itemId: string; winnerName: string };

  const pendingWinnerMarkRef = useRef<WinnerMarkAction | null>(null);
  const [markWinnerAuthPromptOpen, setMarkWinnerAuthPromptOpen] =
    useState(false);
  const [markWinnerActor, setMarkWinnerActor] = useState<BidderActor | null>(
    () => loadStoredActor()
  );

  useEffect(() => {
    setMarkWinnerActor(loadStoredActor());
  }, [activeTab]);

  const performWinnerMarkChange = async (
    action: WinnerMarkAction,
    bearerToken: string
  ) => {
    if (!state) return;

    const trimmed = action.winnerName.trim();
    if (!trimmed) return;

    const item = state.items.find((i) => i.id === action.itemId);
    if (!item || item.status !== 'active') return;

    const rewardCtx = resolveEffectiveRewardContext(state);
    const pool = displayWinnerPoolCapForItem(
      item,
      rewardCtx.rank,
      rewardCtx.counts
    );
    const existing = item.recordedWinnerNames ?? [];
    const ignLower = trimmed.toLowerCase();
    const shuffleDrawSlots =
      state.shuffleWinnerSlotsByItemId?.[action.itemId] ?? pool;
    const queueIndexForName = (name: string, queueIds: number[], roster: GuildMember[]) => {
      const lower = name.trim().toLowerCase();
      return queueIds.findIndex((mid) => {
        const member = roster.find((m) => m.id === mid);
        return member?.name.trim().toLowerCase() === lower;
      });
    };
    const countExtraMarked = (
      names: string[],
      queueIds: number[],
      roster: GuildMember[],
      drawSlots: number
    ) =>
      names.filter((name) => {
        const qIdx = queueIndexForName(name, queueIds, roster);
        return qIdx < 0 || qIdx >= drawSlots;
      }).length;

    const countActiveShuffleWinners = (
      queueIds: number[],
      roster: GuildMember[],
      drawSlots: number,
      revokedNames: string[]
    ) => {
      const revokedLower = new Set(
        revokedNames.map((n) => n.trim().toLowerCase()).filter(Boolean)
      );
      let n = 0;
      for (let i = 0; i < drawSlots && i < queueIds.length; i += 1) {
        const member = roster.find((mem) => mem.id === queueIds[i]);
        const nl = member?.name?.trim().toLowerCase() ?? '';
        if (nl && !revokedLower.has(nl)) n += 1;
      }
      return n;
    };

    if (action.kind === 'mark') {
      if (existing.some((n) => n.trim().toLowerCase() === ignLower)) return;
      const qIdx = queueIndexForName(trimmed, item.interestedMemberIds, state.members);
      const isRevokedShuffleSlot =
        qIdx >= 0 &&
        qIdx < shuffleDrawSlots &&
        (item.revokedWinnerNames ?? []).some(
          (n) => n.trim().toLowerCase() === ignLower
        );
      if (qIdx >= 0 && qIdx < shuffleDrawSlots && !isRevokedShuffleSlot) return;
      if (!isRevokedShuffleSlot) {
        const extraCount = countExtraMarked(
          existing,
          item.interestedMemberIds,
          state.members,
          shuffleDrawSlots
        );
        const activeShuffle = countActiveShuffleWinners(
          item.interestedMemberIds,
          state.members,
          shuffleDrawSlots,
          item.revokedWinnerNames ?? []
        );
        if (activeShuffle + extraCount >= pool) {
          void swal2WinnerPoolFull({
            itemType: item.type,
            pool,
            shuffleDrawSlots: activeShuffle,
          });
          return;
        }
      }
    } else {
      const qIdx = queueIndexForName(trimmed, item.interestedMemberIds, state.members);
      const inRecorded = existing.some((n) => n.trim().toLowerCase() === ignLower);
      const isShuffleSlotWinner = qIdx >= 0 && qIdx < shuffleDrawSlots;
      const alreadyRevoked = (item.revokedWinnerNames ?? []).some(
        (n) => n.trim().toLowerCase() === ignLower
      );
      if (!inRecorded && !(isShuffleSlotWinner && !alreadyRevoked)) return;
    }

    cancelPendingPersist();
    persistInFlightRef.current = true;
    skipPersistAfterPollRef.current = false;

    try {
      let base: AuctionState = normalizeWinnerPoolCapsForLimits(
        dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(state))
      );
      try {
        const remote = await fetchAuctionState();
        if (remote) {
          base = normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote))
          );
        }
      } catch {
        /* keep base from local */
      }

      const target = base.items.find((i) => i.id === action.itemId);
      if (!target || target.status !== 'active') return;
      const ex = target.recordedWinnerNames ?? [];
      const baseRewardCtx = resolveEffectiveRewardContext(base);
      const poolFromLimits = displayWinnerPoolCapForItem(
        target,
        baseRewardCtx.rank,
        baseRewardCtx.counts
      );
      const drawSlots =
        base.shuffleWinnerSlotsByItemId?.[action.itemId] ?? poolFromLimits;

      let nextNames: string[];
      let nextRevoked: string[];
      if (action.kind === 'mark') {
        if (ex.some((n) => n.trim().toLowerCase() === ignLower)) return;
        const qIdx = queueIndexForName(
          trimmed,
          target.interestedMemberIds,
          base.members
        );
        const exRevoked = target.revokedWinnerNames ?? [];
        const isRevokedShuffleSlot =
          qIdx >= 0 &&
          qIdx < drawSlots &&
          exRevoked.some((n) => n.trim().toLowerCase() === ignLower);
        if (qIdx >= 0 && qIdx < drawSlots && !isRevokedShuffleSlot) return;
        if (isRevokedShuffleSlot) {
          nextNames = [...ex];
          nextRevoked = exRevoked.filter(
            (n) => n.trim().toLowerCase() !== ignLower
          );
        } else {
          const extraCount = countExtraMarked(
            ex,
            target.interestedMemberIds,
            base.members,
            drawSlots
          );
          const activeShuffle = countActiveShuffleWinners(
            target.interestedMemberIds,
            base.members,
            drawSlots,
            exRevoked
          );
          if (activeShuffle + extraCount >= poolFromLimits) return;
          nextNames = [...ex, trimmed];
          nextRevoked = [...exRevoked];
        }
      } else {
        nextNames = ex.filter((n) => n.trim().toLowerCase() !== ignLower);
        nextRevoked = [...(target.revokedWinnerNames ?? [])];
        const qIdx = queueIndexForName(
          trimmed,
          target.interestedMemberIds,
          base.members
        );
        const isShuffleSlotWinner = qIdx >= 0 && qIdx < drawSlots;
        if (
          isShuffleSlotWinner &&
          !nextRevoked.some((n) => n.trim().toLowerCase() === ignLower)
        ) {
          nextRevoked.push(trimmed);
        }
      }

      const next: AuctionState = {
        ...base,
        items: base.items.map((it) => {
          if (it.id !== action.itemId) return it;
          return {
            ...it,
            recordedWinnerNames: nextNames.length > 0 ? nextNames : undefined,
            revokedWinnerNames: nextRevoked.length > 0 ? nextRevoked : undefined,
            interestedMemberIds: it.interestedMemberIds,
          };
        }),
      };

      skipPersistOnceRef.current = true;
      setState(next);

      const server = await persistAuctionState(next, { bearerToken });
      if (server) {
        queueBaselineRef.current = buildQueueBaselineFromState(server);
        skipPersistOnceRef.current = true;
        setState(
          normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
          )
        );
        notifyBidderAuditChanged();
      }
      void (action.kind === 'mark'
        ? swal2WinnerMarked({
            ign: trimmed,
            itemName: displayAuctionItemName(target.name),
          })
        : swal2WinnerUnmarked({
            ign: trimmed,
            itemName: displayAuctionItemName(target.name),
          }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|403|expired|admin or developer/i.test(msg)) {
        clearStoredActor();
        setMarkWinnerActor(null);
        pendingWinnerMarkRef.current = action;
        setMarkWinnerAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not save winner mark');
      try {
        const recovered = await fetchAuctionState();
        if (recovered) {
          queueBaselineRef.current = buildQueueBaselineFromState(recovered);
          setState(
            normalizeWinnerPoolCapsForLimits(
              dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
            )
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const requestMarkWinner = (itemId: string, winnerName: string | null) => {
    const trimmed = winnerName?.trim();
    if (!trimmed || !state) return;
    const action: WinnerMarkAction = { kind: 'mark', itemId, winnerName: trimmed };
    const stored = loadStoredActor();
    if (stored && (stored.role === 'Admin' || stored.role === 'Developer')) {
      void performWinnerMarkChange(action, stored.token);
      return;
    }
    pendingWinnerMarkRef.current = action;
    setMarkWinnerAuthPromptOpen(true);
  };

  const requestUnmarkWinner = async (itemId: string, winnerName: string) => {
    const trimmed = winnerName?.trim();
    if (!trimmed || !state) return;
    const item = state.items.find((i) => i.id === itemId);
    const ok = await swal2ConfirmUnmarkWinner({
      ign: trimmed,
      itemName: item
        ? displayAuctionItemName(item.name)
        : 'this item',
    });
    if (!ok) return;
    const action: WinnerMarkAction = { kind: 'unmark', itemId, winnerName: trimmed };
    const stored = loadStoredActor();
    if (stored && (stored.role === 'Admin' || stored.role === 'Developer')) {
      void performWinnerMarkChange(action, stored.token);
      return;
    }
    pendingWinnerMarkRef.current = action;
    setMarkWinnerAuthPromptOpen(true);
  };

  const handleMarkWinnerAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setMarkWinnerActor(actor);
    setMarkWinnerAuthPromptOpen(false);
    if (actor.role !== 'Admin' && actor.role !== 'Developer') return;
    const pending = pendingWinnerMarkRef.current;
    pendingWinnerMarkRef.current = null;
    if (pending) void performWinnerMarkChange(pending, actor.token);
  };

  const handleMarkWinnerAuthCancel = () => {
    pendingWinnerMarkRef.current = null;
    setMarkWinnerAuthPromptOpen(false);
  };

  /**
   * Drag-and-drop queue move. Saves the move IMMEDIATELY via PUT /api/state
   * instead of relying on the debounced auto-persist. This eliminates the
   * race-condition class where polling + merge could resurrect the bidder
   * on the source card mid-flight, which was the cause of every "the drag
   * reverts to the original card" report.
   *
   * Pattern mirrors `handleClearAllQueues`: cancel any pending debounce,
   * mark the persist as in-flight (so the 2s poll skips this cycle), apply
   * the move locally for instant UI feedback, then synchronously persist
   * and adopt the server's response.
   */
  const handleQueueMove = async (payload: QueueMovePayload) => {
    if (!state) return;

    // Cancel any debounced save that was pending — we're going to do an
    // immediate save instead, and we don't want a stale debounce to fire
    // afterwards with our pre-move snapshot.
    cancelPendingPersist();
    // Block the polling loop for the full round-trip.
    persistInFlightRef.current = true;
    skipPersistAfterPollRef.current = false;

    try {
      let base: AuctionState = normalizeWinnerPoolCapsForLimits(
        dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(state))
      );
      try {
        const remote = await fetchAuctionState();
        if (remote) {
          base = normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(remote))
          );
        }
      } catch {
        /* keep base from local */
      }

      const next = applyQueueMemberMove(base, payload);
      if ('error' in next) {
        setState(base);
        if (next.error === 'emperium_win_cooldown' && next.toItemName) {
          const ign =
            base.members.find((m) => m.id === payload.memberId)?.name ?? '';
          void swal2EmperiumWinCooldown({
            ign,
            itemName: displayAuctionItemName(next.toItemName),
            expiresAt: next.expiresAt ?? Date.now(),
          });
          return;
        }
        if (next.error === 'name_conflict' && next.toItemName) {
          const ign =
            base.members.find((m) => m.id === payload.memberId)?.name ?? '';
          const toItem = base.items.find((i) => i.id === payload.toItemId);
          const matchedIgn =
            toItem != null
              ? matchingIgnOnQueueItem(toItem, base.members, ign)
              : null;
          void swal2QueueAlreadyOnAnotherItem({
            ign,
            otherItemName: displayAuctionItemName(next.toItemName),
            matchedIgn: matchedIgn ?? undefined,
          });
        }
        return;
      }

      // Optimistic apply for instant feedback, AND tell the state-effect
      // not to schedule a debounced save (we're saving right now).
      skipPersistOnceRef.current = true;
      setState(next);

      const server = await persistAuctionState(next);
      if (server) {
        queueBaselineRef.current = buildQueueBaselineFromState(server);
        // Suppress the redundant debounced save that the post-server
        // setState would otherwise schedule.
        skipPersistOnceRef.current = true;
        setState(
          normalizeWinnerPoolCapsForLimits(
            dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
          )
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      try {
        const parsed = JSON.parse(msg) as {
          code?: string;
          error?: string;
          extra?: { itemName?: string; expiresAt?: number };
        };
        if (parsed.code === 'emperium_win_cooldown') {
          const ign =
            state.members.find((m) => m.id === payload.memberId)?.name ?? '';
          void swal2EmperiumWinCooldown({
            ign,
            itemName: displayAuctionItemName(
              parsed.extra?.itemName ?? 'this item'
            ),
            expiresAt: parsed.extra?.expiresAt ?? Date.now(),
          });
          return;
        }
      } catch {
        /* not JSON */
      }
      void swal2SaveError(msg || 'Could not move bid');
      // Roll back to whatever the server actually has.
      try {
        const recovered = await fetchAuctionState();
        if (recovered) {
          queueBaselineRef.current = buildQueueBaselineFromState(recovered);
          setState(
            normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const handleCompleteAuction = requestMarkWinner;

  // Clear-all-lists is destructive (wipes every active queue) — restricted
  // to Admin / Developer with the same session-token flow as event-mode and
  // reset-shuffle. Server enforces the role at `/api/state/clear-queues`.
  const [clearQueuesAuthPromptOpen, setClearQueuesAuthPromptOpen] =
    useState(false);

  const performClearAllQueues = async (bearerToken: string) => {
    if (!state || clearQueuesSaving) return;
    cancelPendingPersist();
    setClearQueuesSaving(true);
    // Same immediate-save + polling-lockout pattern used for shuffle/event-
    // mode. Without this, a poll mid-clear could overwrite the empty queues.
    persistInFlightRef.current = true;
    skipPersistAfterPollRef.current = false;

    try {
      // Optimistic local clear for instant UI feedback.
      const cleared: AuctionState = {
        ...state,
        items: state.items.map((it) =>
          it.status === 'active' ? { ...it, interestedMemberIds: [] } : it
        ),
      };
      skipPersistOnceRef.current = true;
      setState(cleared);

      const server = await clearAllActiveQueuesOnServer(bearerToken);
      skipPersistOnceRef.current = true;
      const finalState = normalizeWinnerPoolCapsForLimits(
        dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
      );
      queueBaselineRef.current = buildQueueBaselineFromState(finalState);
      setState(finalState);
      notifyBidderAuditChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|expired|admin or developer/i.test(msg)) {
        clearStoredActor();
        setClearQueuesAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not clear queues');
      try {
        const recovered = await fetchAuctionState();
        if (recovered) {
          queueBaselineRef.current = buildQueueBaselineFromState(recovered);
          setState(
            normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      persistInFlightRef.current = false;
      setClearQueuesSaving(false);
    }
  };

  const handleClearAllQueues = async () => {
    if (!state || clearQueuesSaving) return;
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
    const stored = loadStoredActor();
    if (stored && (stored.role === 'Admin' || stored.role === 'Developer')) {
      await performClearAllQueues(stored.token);
      return;
    }
    setClearQueuesAuthPromptOpen(true);
  };

  const handleClearQueuesAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setClearQueuesAuthPromptOpen(false);
    if (actor.role === 'Admin' || actor.role === 'Developer') {
      void performClearAllQueues(actor.token);
    }
  };

  const handleClearQueuesAuthCancel = () => {
    setClearQueuesAuthPromptOpen(false);
  };

  // -- Privileged queue-remove flow --------------------------------------
  //
  // Removing a bidder from a per-item queue is restricted to Officer / Admin
  // / Developer accounts. We reuse the same session token the Bidders page
  // hands out:
  //   1. If sessionStorage already has a valid token, the remove proceeds
  //      immediately (after a confirm dialog).
  //   2. If not, we pop up `BidderAuthModal` to collect IGN + password; on
  //      success the token is stored and the deferred remove runs.
  // The token is sent as `Authorization: Bearer …` and re-validated server-
  // side on every call — so even if the cached role goes stale, the API
  // rejects the request.
  const [authPromptOpen, setAuthPromptOpen] = useState(false);
  const pendingRemoveRef = useRef<
    | { itemId: string; memberId: number; memberName: string; itemDisplayName: string }
    | null
  >(null);

  const performQueueRemove = async (
    itemId: string,
    memberId: number,
    memberName: string,
    itemDisplayName: string,
    token: string
  ) => {
    const snap = latestState.current;
    if (!snap || snap.shuffleLocked === true || shuffleRunningRef.current) return;
    const ok = await swal2ConfirmRemoveFromQueue(memberName, itemDisplayName);
    if (!ok) return;
    try {
      const server = await removeMemberFromItemQueueOnServer(
        itemId,
        memberId,
        token
      );
      queueBaselineRef.current = buildQueueBaselineFromState(server);
      cancelPendingPersist();
      skipPersistOnceRef.current = true;
      setState(
        normalizeWinnerPoolCapsForLimits(
          dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
        )
      );
      notifyBidderAuditChanged();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|expired/i.test(msg)) {
        // Stored token rejected — drop it and ask the user to re-auth.
        clearStoredActor();
        pendingRemoveRef.current = {
          itemId,
          memberId,
          memberName,
          itemDisplayName,
        };
        setAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not remove from queue');
    }
  };

  const handleRemoveFromQueue = async (itemId: string, memberId: number) => {
    if (!state) return;
    if (state.shuffleLocked === true || shuffleUi.active) return;
    const item = state.items.find((i) => i.id === itemId);
    const m = state.members.find((x) => x.id === memberId);
    if (!item || !m) return;
    const memberName = m.name;
    const itemDisplayName = displayAuctionItemName(item.name);

    const stored = loadStoredActor();
    if (stored) {
      await performQueueRemove(
        itemId,
        memberId,
        memberName,
        itemDisplayName,
        stored.token
      );
      return;
    }
    // Defer until the user authenticates via the modal.
    pendingRemoveRef.current = {
      itemId,
      memberId,
      memberName,
      itemDisplayName,
    };
    setAuthPromptOpen(true);
  };

  const handleAuthPromptSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setAuthPromptOpen(false);
    const pending = pendingRemoveRef.current;
    pendingRemoveRef.current = null;
    if (pending) {
      void performQueueRemove(
        pending.itemId,
        pending.memberId,
        pending.memberName,
        pending.itemDisplayName,
        actor.token
      );
    }
  };

  const handleAuthPromptCancel = () => {
    setAuthPromptOpen(false);
    pendingRemoveRef.current = null;
  };

  const handleDeactivateMember = async (memberId: number) => {
    if (!state) return;
    const m = state.members.find((x) => x.id === memberId);
    if (!m) return;
    const ok = await swal2ConfirmRemoveMember(m.name);
    if (!ok) return;
    try {
      const next = await deactivateMemberOnServer(memberId);
      setState(
        normalizeWinnerPoolCapsForLimits(
          dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(next))
        )
      );
      setEditMemberId(null);
      setEditMemberNameInput('');
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
    const persistedRank = parseGuildRank(state.rewardRank);
    // Each event mode pins its rank preset (Guild League → Bronze,
    // Emperium Overrun → Emperium overrun). If the persisted rank doesn't
    // match the current event mode (e.g. event was flipped without re-
    // saving limits), coerce to the matching rank and recompute presets so
    // the modal opens in a valid state.
    const requiredRank: GuildRank =
      eventModeActive === 'Guild League' ? 'Bronze' : 'Emperium overrun';
    const rank: GuildRank =
      persistedRank === requiredRank ? persistedRank : requiredRank;
    const preset =
      rank === persistedRank
        ? state.rewardItemCounts ?? rankPresetLimits(rank)
        : rankPresetLimits(rank);
    setWinnerSetLimitForm({
      rank,
      feathers: preset.feathers,
      feathersItemsPerWinner:
        rank === persistedRank
          ? (state.rewardItemCounts?.feathersItemsPerWinner ??
            defaultFeathersItemsPerWinner(rank))
          : defaultFeathersItemsPerWinner(rank),
      fragmentByItemId: buildFragmentLimitsByItemId(state.items, preset),
    });
    setWinnerSetLimitModalOpen(true);
  };

  // Winner set limit change requires Officer/Admin/Developer. The save flow
  // splits into a thin gate (cache-check + maybe-open-modal) and the actual
  // performSaveWinnerSetLimit that runs the immediate-save with bearer.
  const [winnerSetLimitAuthPromptOpen, setWinnerSetLimitAuthPromptOpen] =
    useState(false);
  const pendingWinnerSetLimitRef = useRef<typeof winnerSetLimitForm | null>(
    null
  );

  const performSaveWinnerSetLimit = async (
    formSnap: typeof winnerSetLimitForm,
    bearerToken: string
  ) => {
    if (!state) return;
    const nextState: AuctionState = {
      ...state,
      rewardRank: formSnap.rank,
      rewardItemCounts: {
        fragment:
          formSnap.fragmentByItemId.m1 ??
          Object.values(formSnap.fragmentByItemId)[0] ??
          totalItemsForTypeByRank('Fragment Card', formSnap.rank),
        feathers: formSnap.feathers,
        feathersItemsPerWinner: Math.max(1, formSnap.feathersItemsPerWinner),
        fragmentByItemId: { ...formSnap.fragmentByItemId },
      },
      items: state.items.map((it) => {
        if (it.type === 'Fragment Card') {
          const fragItems =
            formSnap.fragmentByItemId[it.id] ??
            totalItemsForTypeByRank('Fragment Card', formSnap.rank);
          return {
            ...it,
            winnerPoolCap: winnerSlotsFromItems('Fragment Card', fragItems),
          };
        }
        if (it.type === 'Feathers') {
          return {
            ...it,
            winnerPoolCap: winnerSlotsFromItems('Feathers', formSnap.feathers),
          };
        }
        return it;
      }),
    };
    // Lock out polling for the round-trip — see `handleQueueMove` for the
    // race this prevents (otherwise the saved limits can be reverted by a
    // poll that started before the save).
    cancelPendingPersist();
    persistInFlightRef.current = true;
    skipPersistAfterPollRef.current = false;

    skipPersistOnceRef.current = true;
    setState(nextState);
    setWinnerSetLimitModalOpen(false);
    try {
      const server = await persistAuctionState(nextState, { bearerToken });
      const merged = server ?? nextState;
      queueBaselineRef.current = buildQueueBaselineFromState(merged);
      skipPersistOnceRef.current = true;
      setState(merged);
      notifyBidderAuditChanged();
      void swal2WinnerLimitsUpdated({
        fragmentCards: activeFragmentAuctionItems(merged.items).map((it) => ({
          name: it.name,
          winners: winnerSlotsFromItems(
            'Fragment Card',
            formSnap.fragmentByItemId[it.id] ?? 0
          ),
        })),
        feathersWinners: winnerSlotsFromItems('Feathers', formSnap.feathers),
        feathersItemsPerWinner: formSnap.feathersItemsPerWinner,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sign in|401|expired|officer/i.test(msg)) {
        clearStoredActor();
        pendingWinnerSetLimitRef.current = formSnap;
        setWinnerSetLimitAuthPromptOpen(true);
        return;
      }
      void swal2SaveError(msg || 'Could not save Winner Settings');
    } finally {
      persistInFlightRef.current = false;
    }
  };

  const handleSaveWinnerSetLimit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state) return;
    const formSnap = winnerSetLimitForm;
    const stored = loadStoredActor();
    if (stored) {
      await performSaveWinnerSetLimit(formSnap, stored.token);
      return;
    }
    pendingWinnerSetLimitRef.current = formSnap;
    setWinnerSetLimitAuthPromptOpen(true);
  };

  const handleWinnerSetLimitAuthSuccess = (actor: BidderActor) => {
    storeActor(actor);
    setWinnerSetLimitAuthPromptOpen(false);
    const pending = pendingWinnerSetLimitRef.current;
    pendingWinnerSetLimitRef.current = null;
    if (pending) {
      void performSaveWinnerSetLimit(pending, actor.token);
    }
  };

  const handleWinnerSetLimitAuthCancel = () => {
    setWinnerSetLimitAuthPromptOpen(false);
    pendingWinnerSetLimitRef.current = null;
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

    const conflict = state.members.find(
      (m) => m.id !== editMemberId && ignMatchesForQueueIdentity(m.name, raw)
    );
    if (conflict) {
      void swal2NameAlreadyTaken({
        ign: raw,
        matchedIgn: conflict.name,
      });
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

    // The IGN must come from the dropdown (i.e. exist in the members table).
    // The dropdown only lets you pick existing names so this is a belt-and-
    // braces check against URL/state tampering.
    const picked = activeMembersForJoin.find(
      (m) => m.name.trim().toLowerCase() === raw.toLowerCase()
    );
    if (!picked) {
      void swal2SaveError(
        'That IGN is not registered. Please register first on the Bidders page.'
      );
      return;
    }

    const password = queueJoinPassword.trim();
    if (!password) {
      void swal2SaveError(
        'Password is required to join the queue.'
      );
      return;
    }

    setQueueAdminSubmitting(true);
    try {
      // Verify identity FIRST. If creds are wrong, abort before mutating state.
      try {
        await verifyMemberRequest(picked.name, password);
      } catch (authErr) {
        const msg =
          authErr instanceof Error ? authErr.message : String(authErr);
        void swal2SaveError(msg || 'Invalid IGN or password');
        return;
      }

      // Queue-only endpoint — avoids full `/api/state` PUT, which requires
      // Officer/Admin/Developer when reward limits differ from the snapshot
      // (e.g. after client-side `normalizeWinnerPoolCapsForLimits`).
      cancelPendingPersist();
      persistInFlightRef.current = true;
      skipPersistAfterPollRef.current = false;

      const server = await publicAddBidToQueue(itemId, raw);
      queueBaselineRef.current = buildQueueBaselineFromState(server);
      skipPersistOnceRef.current = true;
      setState(
        normalizeWinnerPoolCapsForLimits(
          dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(server))
        )
      );
      const cardName =
        server.items.find((it) => it.id === itemId)?.name ??
        queueModalItem?.name ??
        'this item';
      void swal2QueueMemberAdded({
        ign: raw,
        itemName: displayAuctionItemName(cardName),
      });
      closeJoinQueueModal();
    } catch (e) {
      if (e instanceof PublicAddBidError) {
        if (e.code === 'already_listed') {
          void swal2QueueAlreadyListed({
            ign: raw,
            itemName: displayAuctionItemName(
              e.extra?.itemName ?? queueModalItem?.name ?? 'this item'
            ),
            matchedIgn: e.extra?.matchedIgn,
          });
          closeJoinQueueModal();
          return;
        }
        if (e.code === 'on_other_item') {
          void swal2QueueAlreadyOnAnotherItem({
            ign: raw,
            otherItemName: displayAuctionItemName(
              e.extra?.otherItemName ?? 'another item'
            ),
            matchedIgn: e.extra?.matchedIgn,
          });
          closeJoinQueueModal();
          return;
        }
        if (e.code === 'emperium_win_cooldown') {
          void swal2EmperiumWinCooldown({
            ign: raw,
            itemName: displayAuctionItemName(
              e.extra?.itemName ?? queueModalItem?.name ?? 'this item'
            ),
            expiresAt:
              e.extra?.expiresAt ?? emperiumWinCooldownExpiresAt(Date.now()),
          });
          closeJoinQueueModal();
          return;
        }
        if (e.code === 'shuffle_locked') {
          void swal2SaveError(
            e.message || 'Queue signup is closed until the next reset.'
          );
          return;
        }
      }
      const msg = e instanceof Error ? e.message : String(e);
      void swal2SaveError(msg || 'Could not join the queue');
      try {
        const recovered = await fetchAuctionState();
        if (recovered) {
          queueBaselineRef.current = buildQueueBaselineFromState(recovered);
          setState(
            normalizeWinnerPoolCapsForLimits(
                  dedupeIgnAcrossActiveQueues(pruneOrphanQueueMembers(recovered))
                )
          );
        }
      } catch {
        /* ignore */
      }
    } finally {
      persistInFlightRef.current = false;
      setQueueAdminSubmitting(false);
    }
  };

  if (!state) {
    return (
      <div className="min-h-screen text-slate-100 font-sans flex items-center justify-center">
        <p className="text-slate-500 text-sm font-medium">Loading auction…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100 font-sans">
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
              <button
                type="button"
                onClick={() => setActiveTab('bidders')}
                className={`relative flex flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition-all ${
                  activeTab === 'bidders'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-900/30'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
                }`}
                aria-label={
                  pendingBidderCount > 0
                    ? `Bidders (${pendingBidderCount} pending approval)`
                    : 'Bidders'
                }
              >
                <UserPlus className="w-4 h-4 shrink-0" aria-hidden />
                Bidders
                {pendingBidderCount > 0 && (
                  <span
                    title={`${pendingBidderCount} pending approval`}
                    className={`ml-1 inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1.5 text-[10px] font-black leading-none ring-2 ring-slate-900 ${
                      activeTab === 'bidders'
                        ? 'bg-amber-300 text-amber-950'
                        : 'animate-pulse bg-amber-400 text-amber-950'
                    }`}
                  >
                    {pendingBidderCount > 99 ? '99+' : pendingBidderCount}
                  </span>
                )}
              </button>
            </nav>
          </div>
        </div>
      </header>

      <main className="min-h-screen">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-8 py-6 sm:py-12">
          {visitedTabs.has('dashboard') && (
            <div
              key="dashboard"
              hidden={activeTab !== 'dashboard'}
              className="space-y-8"
            >
                {visibleActiveAuctions.length > 0 && (
                  <div className="flex w-full min-w-0 flex-col items-stretch gap-3 sm:items-end">
                    <div className="w-full">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <div className="grid w-full grid-cols-2 rounded-xl border border-slate-700 bg-slate-900 p-1 sm:inline-flex sm:w-fit">
                          {(['Guild League', 'Emperium Overrun'] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => setEventModeDraft(mode)}
                              disabled={eventModeSaving}
                              className={`cursor-pointer rounded-lg px-3 py-1.5 text-center text-[11px] font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed sm:text-xs ${
                                eventModeDraft === mode
                                  ? 'bg-blue-600 text-white'
                                  : 'text-slate-300 hover:bg-slate-800'
                              }`}
                            >
                              {mode}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleSaveEventMode()}
                          disabled={
                            eventModeSaving ||
                            eventModeDraft === eventModeActive
                          }
                          className="inline-flex w-full cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          {eventModeSaving ? 'Saving...' : 'Save Event Mode'}
                        </button>
                      </div>
                    </div>
                    <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
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
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-wide leading-tight text-white transition-all hover:bg-blue-600 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4"
                        >
                          <Shuffle className="h-4 w-4 shrink-0" aria-hidden />
                          {state?.shuffleLocked === true ? 'Shuffle Used' : 'Start Shuffle'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleResetShuffleUnmarkAll()}
                          disabled={shuffleUi.active}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-wide leading-tight text-white transition-all hover:bg-amber-700 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4"
                        >
                          <RotateCcw className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="sm:hidden">Reset / Unmark</span>
                          <span className="hidden sm:inline">Reset shuffle / Unmark all</span>
                        </button>
                        <button
                          type="button"
                          onClick={openWinnerSetLimitModal}
                          disabled={shuffleUi.active}
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-wide leading-tight text-white transition-all hover:bg-blue-700 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4"
                        >
                          Winner Settings
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleClearAllQueues()}
                          disabled={
                            shuffleUi.active ||
                            clearQueuesSaving ||
                            totalActiveQueueEntries === 0
                          }
                          title={
                            totalActiveQueueEntries === 0
                              ? 'No bidders in any active queue'
                              : 'Empty every active auction card’s queue (roster unchanged)'
                          }
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-slate-800 px-3 py-2.5 text-center text-[10px] font-black uppercase tracking-wide leading-tight text-white transition-all hover:bg-amber-900/80 active:scale-95 enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto sm:px-4"
                        >
                          <ListX className="h-4 w-4 shrink-0" aria-hidden />
                          Clear all lists
                        </button>
                    </div>
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
                          rewardRank={
                            effectiveReward?.rank ??
                            parseGuildRank(state.rewardRank)
                          }
                          rewardItemCounts={
                            effectiveReward?.counts ??
                            state.rewardItemCounts ??
                            rankPresetLimits(parseGuildRank(state.rewardRank))
                          }
                          featherPageStart={featherPageStartByItemId[item.id]}
                          isShuffling={shuffleUi.active}
                          showWinnerShortlist={
                            state.winnerShortlistUiEnabled === true
                          }
                          onOpenAddName={openQueueNameModal}
                          onRemoveFromQueue={(memberId) =>
                            void handleRemoveFromQueue(item.id, memberId)
                          }
                          onMoveQueueMember={handleQueueMove}
                          onComplete={handleCompleteAuction}
                          showAddedWinnerUi={
                            state.shuffleLocked === true &&
                            state.winnerShortlistUiEnabled === true
                          }
                          onUnmarkWinner={requestUnmarkWinner}
                          shuffleSpinOffset={shuffleUi.spinOffsetByItemId[item.id]}
                          shuffleRevealCount={shuffleUi.revealCountByItemId[item.id]}
                          shufflePreviewIds={shuffleUi.previewQueueByItemId[item.id]}
                          shuffleDone={
                            (shuffleUi.revealCountByItemId[item.id] ?? 0) >=
                            displayWinnerPoolCapForItem(
                              item,
                              effectiveReward?.rank ??
                                parseGuildRank(state.rewardRank),
                              effectiveReward?.counts ??
                                state.rewardItemCounts ??
                                rankPresetLimits(parseGuildRank(state.rewardRank))
                            )
                          }
                          shuffleLocked={state.shuffleLocked === true}
                          shuffleWinnerSlots={
                            state.shuffleWinnerSlotsByItemId?.[item.id]
                          }
                          onShuffleDrawFree={handleShuffleDrawFree}
                          freeDrawChosenMemberId={
                            (state.freeDrawChosenByItemId ?? {})[item.id] ?? null
                          }
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
            </div>
          )}

          {visitedTabs.has('history') && (
            <div
              key="history"
              hidden={activeTab !== 'history'}
              className="space-y-10"
            >
                <BidderAuditLogSection active={activeTab === 'history'} />

                  {false && bidderLogSubTab === 'ranking' &&
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
                          <p className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 py-10 text-center font-medium text-slate-500">
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
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
                        <p className="font-medium text-slate-500">
                          No ranking yet. Run <strong>Shuffle all queues</strong> or mark a winner so Win /
                          Loss counts show up here.
                        </p>
                      </div>
                    ))}

                  {false && bidderLogSubTab === 'weekly' &&
                    (bidderStateLogEntries.length === 0 ? (
                      <div className="rounded-3xl border border-dashed border-slate-800 bg-slate-900/40 p-10 text-center">
                        <p className="font-medium text-slate-500">
                          No weekly log yet. Run <strong>Shuffle all queues</strong> for Win / Loss in{' '}
                          <code className="text-xs text-slate-400">bidder_state_log</code>; green check marks
                          appear in the separate winner mark log.
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
                                ['m2', 'LND & TNS'] as const,
                              ] satisfies readonly [
                                'all' | BidderLogStateFilter | 'm1' | 'm2',
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
            </div>
          )}

          {visitedTabs.has('bidders') && (
            <div
              key="bidders"
              hidden={activeTab !== 'bidders'}
              className="space-y-8"
            >
              <BidderRegistration />
            </div>
          )}
        </div>
      </main>

      {/* Modals */}
      <AnimatePresence>
        {queueNameModalItemId && queueModalItem && (
          <Modal
            title="Join queue"
            onClose={closeJoinQueueModal}
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
                {(() => {
                  // Hide IGNs that are already disqualified from joining this
                  // queue — either they are on this card's queue already, or
                  // they have a bid on another card that the current event
                  // mode considers blocking (Guild League = any other card;
                  // Emperium Overrun = same center type / cross-alt rules).
                  const filteredMembers = (() => {
                    if (!state || !queueModalItem) return activeMembersForJoin;
                    return activeMembersForJoin.filter((opt) => {
                      const ignRaw = opt.name;
                      if (
                        matchingIgnOnQueueItem(
                          queueModalItem,
                          state.members,
                          ignRaw
                        )
                      ) {
                        return false;
                      }
                      if (
                        weeklyTypeWinBlocksQueueJoin(
                          state.eventMode,
                          queueModalItem,
                          state.weeklyTypeWins,
                          ignRaw
                        )
                      ) {
                        return false;
                      }
                      const blocker = findOtherActiveQueueBlockingWithMatch(
                        state.eventMode,
                        state.items,
                        state.members,
                        ignRaw,
                        queueModalItem.id,
                        queueModalItem.type
                      );
                      return blocker == null;
                    });
                  })();
                  const hiddenCount =
                    activeMembersForJoin.length - filteredMembers.length;
                  return (
                    <>
                      <NameDropdown
                        options={filteredMembers}
                        value={queueNameInput}
                        onChange={setQueueNameInput}
                        disabled={activeMembersLoading || queueAdminSubmitting}
                        placeholder={
                          activeMembersLoading ? 'Loading IGNs…' : '— Select your IGN —'
                        }
                        emptyMessage={
                          hiddenCount > 0 && activeMembersForJoin.length > 0
                            ? 'Every registered IGN is already in this or another active queue.'
                            : 'No registered IGNs. Please register on the Bidders page first.'
                        }
                      />
                      {activeMembersError && (
                        <p className="text-[11px] font-bold text-rose-300">
                          {activeMembersError}
                        </p>
                      )}
                    </>
                  );
                })()}
              </div>
              <div className="space-y-2">
                <label className="text-[10px] uppercase font-black text-slate-500 tracking-[0.2em] font-mono ml-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    type={queueJoinShowPassword ? 'text' : 'password'}
                    required
                    autoComplete="current-password"
                    placeholder="Enter your password"
                    className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 pr-14 font-mono text-white placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                    value={queueJoinPassword}
                    onChange={(e) => setQueueJoinPassword(e.target.value)}
                    disabled={queueAdminSubmitting}
                  />
                  <button
                    type="button"
                    onClick={() => setQueueJoinShowPassword((v) => !v)}
                    disabled={queueAdminSubmitting}
                    aria-label={
                      queueJoinShowPassword ? 'Hide password' : 'Show password'
                    }
                    title={
                      queueJoinShowPassword ? 'Hide password' : 'Show password'
                    }
                    tabIndex={-1}
                    className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-700 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {queueJoinShowPassword ? (
                      <EyeOff className="h-4 w-4" aria-hidden />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden />
                    )}
                  </button>
                </div>
              </div>
              <button
                type="submit"
                disabled={queueAdminSubmitting}
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:pointer-events-none text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                {queueAdminSubmitting ? 'Verifying…' : 'Join queue'}
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
              <button
                type="button"
                onClick={() => {
                  if (editMemberId == null) return;
                  void handleDeactivateMember(editMemberId);
                }}
                className="w-full rounded-[1.25rem] border border-red-500/40 bg-red-950/30 py-4 text-sm font-black uppercase tracking-widest text-red-300 transition-colors hover:bg-red-950/50"
              >
                Remove from all queues
              </button>
            </form>
          </Modal>
        )}

        <BidderAuthModal
          open={authPromptOpen}
          title="Sign in to remove from queue"
          description="Officer, Admin, or Developer access required to remove a bidder from a queue."
          submitLabel="Sign in & continue"
          onAuth={handleAuthPromptSuccess}
          onCancel={handleAuthPromptCancel}
        />

        <BidderAuthModal
          open={eventModeAuthPromptOpen}
          title="Sign in to change event mode"
          description="Admin or Developer access required to switch between Guild League and Emperium Overrun."
          submitLabel="Sign in & save"
          allowedRoles={['Admin', 'Developer']}
          onAuth={handleEventModeAuthSuccess}
          onCancel={handleEventModeAuthCancel}
        />

        <BidderAuthModal
          open={shuffleAuthPromptOpen}
          title="Sign in to start shuffle"
          description="Officer, Admin, or Developer access required to start the auction shuffle."
          submitLabel="Sign in & start shuffle"
          onAuth={handleShuffleAuthSuccess}
          onCancel={handleShuffleAuthCancel}
        />

        <BidderAuthModal
          open={resetShuffleAuthPromptOpen}
          title="Sign in to reset shuffle"
          description="Admin or Developer access required to reset the shuffle and unmark all winners."
          submitLabel="Sign in & reset"
          allowedRoles={['Admin', 'Developer']}
          onAuth={handleResetShuffleAuthSuccess}
          onCancel={handleResetShuffleAuthCancel}
        />

        <BidderAuthModal
          open={winnerSetLimitAuthPromptOpen}
          title="Sign in to save Winner Settings"
          description="Officer, Admin, or Developer access required to change Winner Settings."
          submitLabel="Sign in & save"
          onAuth={handleWinnerSetLimitAuthSuccess}
          onCancel={handleWinnerSetLimitAuthCancel}
        />

        <BidderAuthModal
          open={markWinnerAuthPromptOpen}
          title="Sign in to adjust winner marks"
          description="Admin or Developer access required to mark or unmark winners after shuffle results are locked."
          submitLabel="Sign in & continue"
          allowedRoles={['Admin', 'Developer']}
          onAuth={handleMarkWinnerAuthSuccess}
          onCancel={handleMarkWinnerAuthCancel}
        />

        <BidderAuthModal
          open={clearQueuesAuthPromptOpen}
          title="Sign in to clear all lists"
          description="Admin or Developer access required to clear every active auction queue."
          submitLabel="Sign in & clear"
          allowedRoles={['Admin', 'Developer']}
          onAuth={handleClearQueuesAuthSuccess}
          onCancel={handleClearQueuesAuthCancel}
        />

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
                  <option value="Feathers">Feathers</option>
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
            title="Winner Settings"
            onClose={() => setWinnerSetLimitModalOpen(false)}
          >
            <form onSubmit={handleSaveWinnerSetLimit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                  Rank
                </label>
                <div className="inline-flex w-full rounded-xl border border-slate-700 bg-slate-900 p-1">
                  {GUILD_RANK_OPTIONS
                    // Each event mode pins its rank preset:
                    //   • Guild League     → Bronze only
                    //   • Emperium Overrun → Emperium overrun only
                    // The off-mode rank button is hidden so users can't pick
                    // a mismatching preset.
                    .filter((rank) =>
                      eventModeActive === 'Guild League'
                        ? rank === 'Bronze'
                        : rank === 'Emperium overrun'
                    )
                    .map((rank) => (
                      <button
                        key={rank}
                        type="button"
                        onClick={() =>
                          setWinnerSetLimitForm((prev) => {
                            const preset = rankPresetLimits(rank);
                            return {
                              ...prev,
                              rank,
                              feathers: preset.feathers,
                              feathersItemsPerWinner:
                                defaultFeathersItemsPerWinner(rank),
                              fragmentByItemId: Object.fromEntries(
                                activeFragmentAuctionItems(state?.items ?? []).map(
                                  (it) => [it.id, preset.fragment]
                                )
                              ),
                            };
                          })
                        }
                        className={`cursor-pointer rounded-lg px-3 py-2 text-xs font-black uppercase tracking-wide transition-colors ${
                          winnerSetLimitForm.rank === rank
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-300 hover:bg-slate-800'
                        }`}
                      >
                        {guildRankButtonLabel(rank)}
                      </button>
                    ))}
                </div>
              </div>
              {activeFragmentAuctionItems(state?.items ?? []).map((card, idx) => {
                const value = winnerSetLimitForm.fragmentByItemId[card.id] ?? 0;
                return (
                  <div key={card.id} className="space-y-2">
                    <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                      {displayAuctionItemName(card.name)}
                    </label>
                    <input
                      autoFocus={idx === 0}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      required
                      className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                      value={value}
                      onChange={(e) =>
                        setWinnerSetLimitForm((prev) => ({
                          ...prev,
                          fragmentByItemId: {
                            ...prev.fragmentByItemId,
                            [card.id]: Math.max(
                              0,
                              Math.floor(
                                Number((e.target.value || '0').replace(/[^\d]/g, '')) ||
                                  0
                              )
                            ),
                          },
                        }))
                      }
                    />
                  </div>
                );
              })}
              <div className="space-y-2">
                <label className="text-xs uppercase font-black text-slate-400 tracking-[0.18em] font-mono ml-1">
                  Feathers
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={winnerSetLimitForm.feathers}
                  onChange={(e) =>
                    setWinnerSetLimitForm((prev) => ({
                      ...prev,
                      feathers: Math.max(
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
                  Feathers per winner
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  className="w-full bg-slate-800 border border-slate-700 rounded-2xl px-5 py-4 text-white font-bold placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600/50"
                  value={winnerSetLimitForm.feathersItemsPerWinner}
                  onChange={(e) =>
                    setWinnerSetLimitForm((prev) => ({
                      ...prev,
                      feathersItemsPerWinner: Math.max(
                        1,
                        Math.floor(
                          Number((e.target.value || '1').replace(/[^\d]/g, '')) || 1
                        )
                      ),
                    }))
                  }
                />
                <p className="text-xs text-slate-500 ml-1">
                  {winnerSetLimitForm.feathers} total items ÷{' '}
                  {winnerSetLimitForm.feathersItemsPerWinner} per winner ={' '}
                  <span className="font-semibold text-slate-300">
                    {winnerSlotsFromItems('Feathers', winnerSetLimitForm.feathers)}
                  </span>{' '}
                  winner slot
                  {winnerSlotsFromItems('Feathers', winnerSetLimitForm.feathers) === 1
                    ? ''
                    : 's'}
                  {freeItemsFromTotalItems(
                    'Feathers',
                    winnerSetLimitForm.feathers,
                    winnerSetLimitForm.rank,
                    {
                      feathersItemsPerWinner: winnerSetLimitForm.feathersItemsPerWinner,
                    }
                  ) > 0
                    ? ` (+${freeItemsFromTotalItems(
                        'Feathers',
                        winnerSetLimitForm.feathers,
                        winnerSetLimitForm.rank,
                        {
                          feathersItemsPerWinner:
                            winnerSetLimitForm.feathersItemsPerWinner,
                        }
                      )} free items)`
                    : ''}
                </p>
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-[1.25rem] shadow-xl shadow-blue-600/20 active:scale-[0.98] uppercase tracking-widest"
              >
                Save Winner Settings
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
  rewardRank,
  rewardItemCounts,
  featherPageStart,
  isShuffling,
  showWinnerShortlist,
  onOpenAddName,
  onRemoveFromQueue,
  onMoveQueueMember,
  onComplete,
  showAddedWinnerUi,
  onUnmarkWinner,
  shuffleSpinOffset,
  shuffleRevealCount,
  shufflePreviewIds,
  shuffleDone,
  shuffleLocked,
  shuffleWinnerSlots,
  onShuffleDrawFree,
  freeDrawChosenMemberId,
}: {
  key?: React.Key;
  item: AuctionItem;
  members: GuildMember[];
  rewardRank: GuildRank;
  rewardItemCounts: {
    fragment: number;
    feathers: number;
    fragmentByItemId?: Record<string, number>;
  };
  /** Shared general page index for Fragment + Feathers (creation order). Fragment badges also show I# (one item per winner). */
  featherPageStart?: number;
  /** While shuffle animation runs, hide names and show loading skeletons. */
  isShuffling: boolean;
  /** When false, no shortlist row styling or green “mark winner” buttons (after Reset / Unmark). */
  showWinnerShortlist: boolean;
  /** After main shuffle; enables free-draw shuffle for losers below shortlist. */
  shuffleLocked?: boolean;
  /** Winner slots frozen at shuffle lock (shuffle draw count for this item). */
  shuffleWinnerSlots?: number;
  /** Re-randomize only non-recorded queue rows below the shortlist (Feathers with free partial). */
  onShuffleDrawFree?: (itemId: string) => void | Promise<void>;
  /** Member highlighted as the free-draw pick (set only after “Shuffle draw free”). */
  freeDrawChosenMemberId?: number | null;
  onOpenAddName: (itemId: string) => void;
  onRemoveFromQueue: (memberId: number) => void | Promise<void>;
  onMoveQueueMember: (p: QueueMovePayload) => void;
  onComplete: (id: string, winner: string | null) => void;
  /** Show mark/unmark controls on loser rows after shuffle (login on click). */
  showAddedWinnerUi?: boolean;
  onUnmarkWinner?: (itemId: string, winnerName: string) => void;
  /** While shuffling, rotation offset for unrevealed queue names. */
  shuffleSpinOffset?: number;
  /** While shuffling, how many winners are already revealed from top. */
  shuffleRevealCount?: number;
  /** Preview shuffled queue shown while spin is running. */
  shufflePreviewIds?: number[];
  /** True when this card has already completed its reveal stage. */
  shuffleDone?: boolean;
}) {
  const [dropHighlight, setDropHighlight] = useState(false);
  /** Right-click revealed mark/unmark control on one queue row. */
  const [contextReveal, setContextReveal] = useState<{
    mid: number;
    action: 'mark' | 'unmark';
  } | null>(null);

  useEffect(() => {
    if (contextReveal == null) return;
    const dismiss = () => setContextReveal(null);
    window.addEventListener('click', dismiss);
    window.addEventListener('contextmenu', dismiss);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      window.removeEventListener('click', dismiss);
      window.removeEventListener('contextmenu', dismiss);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [contextReveal]);

  const displayIds =
    isShuffling && Array.isArray(shufflePreviewIds)
      ? shufflePreviewIds
      : item.interestedMemberIds;

  /** Rows in the post-shuffle winner draw pool (from rank limits: Emperium Feathers = 13 items/winner). */
  const poolCap = displayWinnerPoolCapForItem(item, rewardRank, rewardItemCounts);
  const shortlistSlots = showWinnerShortlist ? poolCap : 0;
  /** Shuffle draw winners (frozen at lock); extras may be added below this index. */
  const shuffleDrawSlots =
    shuffleLocked === true && typeof shuffleWinnerSlots === 'number'
      ? Math.max(0, shuffleWinnerSlots)
      : shortlistSlots;
  const recorded = item.recordedWinnerNames ?? [];
  const revoked = item.revokedWinnerNames ?? [];
  const isRevokedWinner = (name: string) =>
    revoked.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
  const isRecordedWinner = (name: string) =>
    recorded.some((n) => n.trim().toLowerCase() === name.trim().toLowerCase());
  const queueIndexForName = (name: string) => {
    const lower = name.trim().toLowerCase();
    return displayIds.findIndex((mid) => {
      const member = members.find((m) => m.id === mid);
      return member?.name.trim().toLowerCase() === lower;
    });
  };
  const isExtraRecordedWinner = (name: string) => {
    if (!isRecordedWinner(name) || isRevokedWinner(name)) return false;
    const qIdx = queueIndexForName(name);
    return qIdx < 0 || qIdx >= shuffleDrawSlots;
  };
  const countActiveShuffleWinners = () => {
    let n = 0;
    for (let i = 0; i < shuffleDrawSlots && i < displayIds.length; i += 1) {
      const member = members.find((mem) => mem.id === displayIds[i]);
      if (member && !isRevokedWinner(member.name)) n += 1;
    }
    return n;
  };
  const extraMarkedCount = recorded.filter((name) => isExtraRecordedWinner(name)).length;
  const totalWinnersNow = countActiveShuffleWinners() + extraMarkedCount;
  const canMarkMoreExtras = totalWinnersNow < poolCap;

  const freeItems =
    item.type === 'Feathers'
      ? freeItemsFromTotalItems(
          item.type,
          rewardItemCounts.feathers,
          rewardRank,
          rewardItemCounts
        )
      : 0;
  const freePageInfo = (() => {
    if (item.type !== 'Feathers') return null;
    const pageStart = featherPageStart ?? 1;
    const totalItems = rewardItemCounts.feathers;
    const offset = featherPageCountBeforePartialFree(
      item.type,
      totalItems,
      rewardRank,
      rewardItemCounts
    );
    return freeItems > 0
      ? { pageLabel: `P${pageStart + offset}`, freeItems }
      : null;
  })();
  const featherSlotUnit = featherItemsPerWinnerUnit(rewardRank, rewardItemCounts);
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
    const offset =
      resolvedSpinOffset >= 0 ? resolvedSpinOffset % tail.length : 0;
    const rotatedTail = tail.slice(offset).concat(tail.slice(0, offset));
    return head.concat(rotatedTail);
  })();

  return (
    <motion.div
      layout
      className="group h-auto w-full min-w-0 max-w-full self-start bg-slate-900 border border-slate-800 rounded-[2.5rem] p-6 shadow-2xl sm:p-8 flex flex-col gap-5 sm:gap-6 transition-[border-color,box-shadow,background-color] duration-200 ease-out hover:border-blue-500/30 hover:shadow-blue-900/20 hover:shadow-2xl"
    >
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className={`text-[10px] font-black uppercase tracking-[0.2em] px-3 py-1 rounded-lg border font-mono ${auctionItemTypeColorClass(item.type)}`}>
            {displayAuctionItemTypeBadge(item.type)}
          </span>
          {(() => {
            // Once the shuffle has been drawn, the queue is frozen until an
            // officer presses Reset shuffle — block any new joiners so the
            // displayed winner pool stays consistent with what was rolled.
            const joinDisabled = isShuffling || shuffleLocked === true;
            const joinTitle =
              shuffleLocked === true
                ? 'Shuffle results are showing — reset shuffle to reopen the queue'
                : `Join the queue for ${displayAuctionItemName(item.name)}`;
            return (
              <button
                type="button"
                disabled={joinDisabled}
                onClick={(e) => {
                  e.stopPropagation();
                  if (joinDisabled) return;
                  onOpenAddName(item.id);
                }}
                title={joinTitle}
                aria-label={joinTitle}
                className="inline-flex items-center gap-1.5 rounded-xl border border-blue-500/50 bg-blue-600/20 px-3 py-1.5 text-[11px] font-black uppercase tracking-wide text-blue-100 transition-colors hover:border-blue-400/70 hover:bg-blue-600/35 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" aria-hidden />
                {shuffleLocked === true ? 'Queue locked' : 'Join queue'}
              </button>
            );
          })()}
        </div>
        <h3 className="text-3xl font-black text-white mt-4 tracking-tight leading-none break-words">
          {displayAuctionItemName(item.name)}
        </h3>
        {(() => {
          const winnerCount = poolCap;
          const totalItems =
            item.type === 'Feathers'
              ? rewardItemCounts.feathers
              : item.type === 'Fragment Card'
                ? (rewardItemCounts.fragmentByItemId?.[item.id] ??
                    rewardItemCounts.fragment)
                : null;
          const winnerLabel = winnerCount === 1 ? 'winner' : 'winners';
          const itemNoun = totalItems === 1 ? 'item' : 'items';
          const winnerTitle =
            item.type === 'Feathers'
              ? `${winnerCount} ${winnerLabel} get ${featherSlotUnit} feathers each (${totalItems} total items)`
              : item.type === 'Fragment Card'
                ? `${winnerCount} ${winnerLabel} — ${totalItems} ${itemNoun} total`
                : `${winnerCount} ${winnerLabel}`;
          return (
            <p
              title={winnerTitle}
              className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-bold leading-snug text-amber-300/90"
            >
              <Trophy className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="font-mono text-amber-200">{winnerCount}</span>
              <span className="uppercase tracking-wide">{winnerLabel}</span>
              {item.type === 'Feathers' ? (
                <span className="text-amber-400/60">
                  ·{' '}
                  <span className="font-mono">{featherSlotUnit}</span> items/winner
                  · <span className="font-mono">{totalItems}</span> total
                </span>
              ) : totalItems != null && item.type === 'Fragment Card' ? (
                <span className="text-amber-400/60">
                  · <span className="font-mono">{totalItems}</span> {itemNoun}
                </span>
              ) : null}
            </p>
          );
        })()}
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
          {displayIds.length === 0 ? (
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
                No one in queue yet. Use the{' '}
                <span className="text-blue-300">Join queue</span> button above
                to add a name.
              </p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-600">
                Or drop a bid here to move it to this card
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {displayIds.map((slotMid, idx) => {
                const mid = isShuffling
                  ? (rotatedDisplayIds[idx] ?? slotMid)
                  : slotMid;
                const m = members.find((member) => member.id === mid);
                if (!m) return null;
                const isShuffleDrawWinner =
                  !isShuffling &&
                  showWinnerShortlist &&
                  idx < shuffleDrawSlots &&
                  !isRevokedWinner(m.name);
                const isExtraMarkedWinner =
                  !isShuffling && isExtraRecordedWinner(m.name);
                const canUnmarkWinner =
                  showAddedWinnerUi &&
                  !isShuffling &&
                  (isExtraMarkedWinner || isShuffleDrawWinner);
                const canRemarkShuffleWinner =
                  idx < shuffleDrawSlots && isRevokedWinner(m.name);
                const canMarkLoser =
                  showAddedWinnerUi &&
                  !isShuffling &&
                  shuffleLocked === true &&
                  !isRecordedWinner(m.name) &&
                  !isExtraMarkedWinner &&
                  (idx >= shuffleDrawSlots || canRemarkShuffleWinner);
                const isWinnerHighlight = isShuffling
                  ? idx < resolvedRevealCount
                  : isShuffleDrawWinner || isExtraMarkedWinner;
                const isFreeDrawPickRow =
                  !isShuffling &&
                  shuffleLocked === true &&
                  showWinnerShortlist &&
                  freeItems > 0 &&
                  item.type === 'Feathers' &&
                  typeof freeDrawChosenMemberId === 'number' &&
                  freeDrawChosenMemberId === mid;
                return (
                  <motion.div
                    layout
                    key={isShuffling ? `slot-${item.id}-${idx}` : mid}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{
                      layout: { duration: 0.22, ease: 'easeOut' },
                      opacity: { duration: 0.16 },
                      x: { duration: 0.16 },
                    }}
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
                    onContextMenu={(e) => {
                      if (!showAddedWinnerUi || isShuffling) return;
                      if (canUnmarkWinner && onUnmarkWinner) {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextReveal((prev) =>
                          prev?.mid === mid && prev.action === 'unmark'
                            ? null
                            : { mid, action: 'unmark' }
                        );
                        return;
                      }
                      if (canMarkLoser) {
                        e.preventDefault();
                        e.stopPropagation();
                        setContextReveal((prev) =>
                          prev?.mid === mid && prev.action === 'mark'
                            ? null
                            : { mid, action: 'mark' }
                        );
                      }
                    }}
                    title={
                      canUnmarkWinner
                        ? 'Right-click to unmark'
                        : canMarkLoser
                          ? 'Right-click to mark as winner'
                          : undefined
                    }
                    className={`flex min-h-10 flex-wrap items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 sm:gap-3 sm:px-3 sm:py-3 ${
                      isWinnerHighlight
                        ? 'bg-blue-600/20 border-blue-500/50'
                        : isShuffling
                          ? 'bg-blue-500/15 border-blue-400/60'
                          : isFreeDrawPickRow
                            ? 'border-sky-500/40 bg-slate-800/90 ring-1 ring-inset ring-sky-500/15 shadow-[inset_0_1px_0_0_rgba(56,189,248,0.06)]'
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
                      </div>
                      <span
                        title={m.name}
                        className={`min-w-0 flex-1 break-words font-bold leading-normal [overflow-wrap:anywhere] ${
                          isFreeDrawPickRow
                            ? 'text-slate-100'
                            : 'text-slate-200'
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
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {!isShuffling && shuffleLocked !== true ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onRemoveFromQueue(mid);
                          }}
                          title="Remove from this queue only (Officer/Admin/Developer)"
                          aria-label={`Remove ${m.name} from ${displayAuctionItemName(item.name)}`}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-950/50 hover:text-red-400"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      ) : null}
                      {isShuffling && isWinnerHighlight ? (
                        <div
                          className="pointer-events-none flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-green-500 text-white shadow-sm shadow-green-950/30"
                          title="Winner revealed during shuffle draw"
                          aria-hidden
                        >
                          <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                        </div>
                      ) : null}
                      {!isShuffling && isWinnerHighlight ? (
                        <div
                          className="pointer-events-none flex h-8 w-8 shrink-0 select-none items-center justify-center rounded-lg bg-green-500 text-white shadow-sm shadow-green-950/30"
                          title={
                            isShuffleDrawWinner
                              ? 'Shuffle draw winner'
                              : 'Added winner'
                          }
                          aria-hidden
                        >
                          <Check className="h-4 w-4 stroke-[2.5]" aria-hidden />
                        </div>
                      ) : null}
                      {showAddedWinnerUi &&
                      canMarkLoser &&
                      contextReveal?.mid === mid &&
                      contextReveal.action === 'mark' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextReveal(null);
                            onComplete(item.id, m.name);
                          }}
                          title={
                            canMarkMoreExtras
                              ? 'Add as winner from losers (Admin/Developer — sign in on click)'
                              : `Winner limit reached (${poolCap}). Raise Winner Settings first.`
                          }
                          aria-label={`Mark ${m.name} as added winner`}
                          className="inline-flex h-8 shrink-0 cursor-pointer items-center rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-[9px] font-black uppercase tracking-wide text-slate-300 shadow-sm shadow-black/25 transition-colors hover:border-slate-600 hover:bg-slate-700 hover:text-white active:scale-95 sm:text-[10px]"
                        >
                          Mark winner
                        </button>
                      ) : null}
                      {showAddedWinnerUi &&
                      canUnmarkWinner &&
                      onUnmarkWinner &&
                      contextReveal?.mid === mid &&
                      contextReveal.action === 'unmark' ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setContextReveal(null);
                            void onUnmarkWinner(item.id, m.name);
                          }}
                          title={`Unmark ${m.name} as winner`}
                          aria-label={`Unmark ${m.name} as winner`}
                          className="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-red-500/40 bg-red-500/15 text-red-300 shadow-sm shadow-red-950/20 transition-colors hover:border-red-400/50 hover:bg-red-500/25 hover:text-red-200 active:scale-95"
                        >
                          <X className="h-4 w-4 stroke-[2.5]" aria-hidden />
                        </button>
                      ) : null}
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
              {!isShuffling && showWinnerShortlist && freeItems > 0 && (
                <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-slate-600/70 bg-slate-800/50 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-300">
                  {freePageInfo ? (
                    <span className="text-sky-200/95">{`FREE (partial ${featherSlotUnit}-item page): ${formatFreePoolPageDisplay(freePageInfo.pageLabel)} (${freePageInfo.freeItems} items)`}</span>
                  ) : (
                    <span className="text-sky-200/95">FREE items: {freeItems}</span>
                  )}
                  {shuffleLocked &&
                    onShuffleDrawFree &&
                    displayIds.length > shuffleDrawSlots && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void onShuffleDrawFree(item.id);
                        }}
                        className="mt-1 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-sky-500/45 bg-sky-600/20 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-sky-100 transition-colors hover:border-sky-400/55 hover:bg-sky-600/30 active:scale-[0.98]"
                      >
                        <Shuffle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Shuffle draw free
                      </button>
                    )}
                </div>
              )}
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
