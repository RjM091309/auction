/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Clock,
  LogOut,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import Swal from 'sweetalert2';
import {
  approveBidderRequest,
  Bidder,
  BidderActor,
  BidderInput,
  BidderRole,
  BidderUpdate,
  clearStoredActor,
  createBidderRequest,
  deleteBidderRequest,
  fetchBidders,
  fetchPendingBidders,
  loadStoredActor,
  rejectBidderRequest,
  signOutBidderRequest,
  storeActor,
  updateBidderRequest,
} from './lib/apiBidders';
import { notifyBidderAuditChanged } from './lib/apiBidderAudit';
import { fetchAuctionState } from './lib/apiState';
import {
  puppetCardCdBadgeClass,
  puppetCardCdDisplayForIgn,
  type PuppetCardCdDisplay,
} from './lib/puppetCardCdDisplay';
import type { WeeklyEventType, WeeklyTypeWin } from './types';
import BidderAuthGate from './BidderAuthGate';

/**
 * Role hierarchy. An actor can only edit a row whose rank is strictly lower.
 *   Developer > Admin > Officer > Member
 */
const ROLE_RANK: Record<BidderRole, number> = {
  Member: 1,
  Officer: 2,
  Admin: 3,
  Developer: 4,
};

const ALL_ROLES: BidderRole[] = ['Member', 'Officer', 'Admin', 'Developer'];

/**
 * Can `actor` edit a row with `targetRole`?
 *   - Developer rows: never (protected even from other Developers).
 *   - Admin rows: only Developer.
 *   - Otherwise: actor rank must be >= target rank (peers may edit peers).
 */
function canEditRow(actorRole: BidderRole, targetRole: BidderRole): boolean {
  if (targetRole === 'Developer') return false;
  if (targetRole === 'Admin') return actorRole === 'Developer';
  return ROLE_RANK[actorRole] >= ROLE_RANK[targetRole];
}

/**
 * Roles a given actor can assign in the Add/Edit modal. An actor can assign
 * any role at or below their own rank:
 *   Officer   → Member, Officer
 *   Admin     → Member, Officer, Admin
 *   Developer → Member, Officer, Admin, Developer
 */
function roleOptionsFor(actorRole: BidderRole): BidderRole[] {
  const cap = ROLE_RANK[actorRole];
  return ALL_ROLES.filter((r) => ROLE_RANK[r] <= cap);
}

function roleBadgeClass(role: BidderRole): string {
  switch (role) {
    case 'Officer':
      return 'bg-amber-900/40 text-amber-300';
    case 'Admin':
      return 'bg-sky-900/40 text-sky-300';
    case 'Developer':
      return 'bg-violet-900/40 text-violet-300';
    default:
      return 'bg-slate-800 text-slate-300';
  }
}

interface BidderRowProps {
  bidder: Bidder;
  cardCd: PuppetCardCdDisplay;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: (b: Bidder) => void;
  onDelete: (b: Bidder) => void;
  onToggleActive: (b: Bidder) => void;
}

const BidderRow = React.memo(function BidderRow({
  bidder,
  cardCd,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onToggleActive,
}: BidderRowProps) {
  // Developer rows are protected — they cannot be edited, deleted, or
  // toggled inactive from the UI. (Backend also enforces this.)
  const isProtected = bidder.role === 'Developer';
  const protectedTitle = 'Developer accounts are protected';
  return (
    <tr className="border-b border-slate-800/70 last:border-0 transition-colors hover:bg-slate-800/40">
      <td className="px-4 py-3 font-mono text-slate-300">{bidder.id}</td>
      <td className="px-4 py-3 font-medium text-white">{bidder.name}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${roleBadgeClass(
            bidder.role
          )}`}
        >
          {bidder.role}
        </span>
      </td>
      <td className="px-4 py-3 font-mono text-slate-300">
        <span className="select-none tracking-widest text-slate-500">
          ••••••••
        </span>
      </td>
      <td className="px-4 py-3">
        {canEdit ? (
          <button
            type="button"
            onClick={() => onToggleActive(bidder)}
            className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest transition-colors ${
              bidder.active
                ? 'bg-emerald-900/40 text-emerald-300 hover:bg-emerald-900/60'
                : 'bg-rose-900/40 text-rose-300 hover:bg-rose-900/60'
            }`}
            title="Toggle active"
          >
            {bidder.active ? 'Active' : 'Inactive'}
          </button>
        ) : (
          <span
            className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest ${
              bidder.active
                ? 'bg-emerald-900/40 text-emerald-300'
                : 'bg-rose-900/40 text-rose-300'
            }`}
          >
            {bidder.active ? 'Active' : 'Inactive'}
          </span>
        )}
      </td>
      <td className="px-4 py-3">
        <span
          title={cardCd.title}
          className={`inline-flex max-w-[9.5rem] items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${puppetCardCdBadgeClass(
            cardCd.tone
          )}`}
        >
          {cardCd.tone === 'cd' ? (
            <Clock className="h-3 w-3 shrink-0 opacity-80" aria-hidden />
          ) : null}
          <span className="truncate normal-case">{cardCd.label}</span>
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(bidder)}
              disabled={isProtected}
              title={isProtected ? protectedTitle : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-700 disabled:hover:bg-slate-900 disabled:hover:text-slate-300"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(bidder)}
              disabled={isProtected || !bidder.active}
              title={isProtected ? protectedTitle : undefined}
              className="inline-flex items-center gap-1.5 rounded-lg border border-rose-900/60 bg-rose-950/50 px-2.5 py-1.5 text-xs font-bold uppercase tracking-wide text-rose-300 transition-colors hover:border-rose-700 hover:bg-rose-900/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-rose-900/60 disabled:hover:bg-rose-950/50 disabled:hover:text-rose-300"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

const SWAL_DARK = {
  background: '#020617',
  color: '#f1f5f9',
  confirmButtonColor: '#2563eb',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function swalConfirmDelete(name: string, id: number): Promise<boolean> {
  const safeName = escapeHtml(name);
  const result = await Swal.fire({
    ...SWAL_DARK,
    icon: 'warning',
    title: 'Delete this bidder?',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center"><strong>${safeName}</strong> (id ${id}) will be permanently removed and dropped from every auction queue. This cannot be undone.</p>`,
    showCancelButton: true,
    confirmButtonText: 'Delete bidder',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
  });
  return Boolean(result.isConfirmed);
}

async function swalConfirmReject(name: string): Promise<boolean> {
  const safeName = escapeHtml(name);
  const result = await Swal.fire({
    ...SWAL_DARK,
    icon: 'warning',
    title: 'Reject this registration?',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center"><strong>${safeName}</strong> will be marked rejected and will not be able to bid. The IGN stays reserved — delete from the main list if you want to free it.</p>`,
    showCancelButton: true,
    confirmButtonText: 'Reject',
    cancelButtonText: 'Cancel',
    confirmButtonColor: '#dc2626',
  });
  return Boolean(result.isConfirmed);
}

function swalError(message: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'error',
    title: 'Something went wrong',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:14px;color:#fecaca;text-align:center">${escapeHtml(message)}</p>`,
    confirmButtonText: 'OK',
  }).then(() => undefined);
}

function swalSuccess(message: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'success',
    title: 'Done',
    width: 'min(28rem, calc(100vw - 2rem))',
    customClass: { htmlContainer: 'swal-queue-html' },
    html: `<p style="margin:0;line-height:1.55;font-size:15px;color:#e2e8f0;text-align:center">${escapeHtml(message)}</p>`,
    timer: 1600,
    timerProgressBar: true,
    showConfirmButton: false,
  }).then(() => undefined);
}

type StatusFilter = 'all' | 'active' | 'inactive';
type CdFilter = 'all' | 'on_cd' | 'ready';

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];
const DEFAULT_PAGE_SIZE: PageSize = 25;

interface PageSizeMenuProps {
  value: PageSize;
  onChange: (next: PageSize) => void;
}

const PageSizeMenu = React.memo(function PageSizeMenu({
  value,
  onChange,
}: PageSizeMenuProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex min-w-[64px] cursor-pointer items-center justify-between gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs font-black text-slate-100 transition-colors hover:border-slate-500 hover:bg-slate-800"
      >
        <span>{value}</span>
        <ChevronDown
          className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
          aria-hidden
        />
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute bottom-full left-0 z-20 mb-1 min-w-[88px] overflow-hidden rounded-lg border border-slate-700 bg-slate-900 py-1 shadow-xl shadow-black/40"
        >
          {PAGE_SIZE_OPTIONS.map((opt) => {
            const selected = opt === value;
            return (
              <li key={opt}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    if (opt !== value) onChange(opt);
                    setOpen(false);
                  }}
                  className={`flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-xs font-black transition-colors ${
                    selected
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>{opt}</span>
                  {selected && <Check className="h-3.5 w-3.5" aria-hidden />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
});

interface EditDraft {
  id: number | null;
  name: string;
  role: BidderRole;
  password: string;
  active: boolean;
}

const EMPTY_DRAFT: EditDraft = {
  id: null,
  name: '',
  role: 'Member',
  password: '',
  active: true,
};

/**
 * Outer component: manages the auth gate.
 *
 * IMPORTANT: hooks must run in the same order every render, so we cannot put
 * the data/CRUD hooks (`useMemo`, `useEffect`, etc.) below an early `return
 * <Gate />`. We therefore split the unauthenticated and authenticated paths
 * into separate components: only one of them is mounted at any time, and
 * each has a stable hook layout.
 */
function BidderRegistrationInner() {
  const [actor, setActor] = useState<BidderActor | null>(() => loadStoredActor());

  const handleAuth = useCallback((next: BidderActor) => {
    storeActor(next);
    setActor(next);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await signOutBidderRequest();
    } catch {
      clearStoredActor();
    }
    setActor(null);
  }, []);

  const handleExpired = useCallback(() => {
    clearStoredActor();
    setActor(null);
  }, []);

  if (!actor) {
    return <BidderAuthGate onAuth={handleAuth} />;
  }

  return (
    <BidderRegistrationAuthed
      actor={actor}
      onSignOut={handleSignOut}
      onExpired={handleExpired}
    />
  );
}

interface BidderRegistrationAuthedProps {
  actor: BidderActor;
  onSignOut: () => void;
  onExpired: () => void;
}

function BidderRegistrationAuthed({
  actor,
  onSignOut,
  onExpired,
}: BidderRegistrationAuthedProps) {
  const [bidders, setBidders] = useState<Bidder[]>([]);
  const [weeklyTypeWins, setWeeklyTypeWins] = useState<WeeklyTypeWin[]>([]);
  const [auctionEventMode, setAuctionEventMode] =
    useState<WeeklyEventType>('Emperium Overrun');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active');
  const [cdFilter, setCdFilter] = useState<CdFilter>('all');
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [page, setPage] = useState(1);

  const [pendingBidders, setPendingBidders] = useState<Bidder[]>([]);
  const [pendingLoading, setPendingLoading] = useState(true);
  const [pendingError, setPendingError] = useState<string | null>(null);
  const [pendingBusyId, setPendingBusyId] = useState<number | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isEditing = draft.id != null;
  const canActorDelete =
    actor.role === 'Admin' || actor.role === 'Developer';
  const roleOptions = useMemo(() => roleOptionsFor(actor.role), [actor.role]);

  const handleAuthFailure = useCallback(
    (msg: string) => {
      if (/sign in|401|expired/i.test(msg)) {
        void swalError('Your session expired. Please sign in again.');
        onExpired();
        return true;
      }
      return false;
    },
    [onExpired]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const [list, auction] = await Promise.all([
          fetchBidders(),
          fetchAuctionState(),
        ]);
        if (!cancelled) {
          setBidders(list);
          setWeeklyTypeWins(auction?.weeklyTypeWins ?? []);
          setAuctionEventMode(auction?.eventMode ?? 'Emperium Overrun');
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/sign in|401|expired/i.test(msg)) {
          if (!cancelled) onExpired();
          return;
        }
        if (!cancelled) setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onExpired]);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchAuctionState().then((auction) => {
        if (!auction) return;
        setWeeklyTypeWins(auction.weeklyTypeWins ?? []);
        setAuctionEventMode(auction.eventMode ?? 'Emperium Overrun');
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  // Pending approvals: load on mount and refresh periodically so new public
  // registrations show up without the admin having to refresh the page.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await fetchPendingBidders();
        if (!cancelled) {
          setPendingBidders(list);
          setPendingError(null);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/sign in|401|expired/i.test(msg)) {
          if (!cancelled) onExpired();
          return;
        }
        if (!cancelled) setPendingError(msg);
      } finally {
        if (!cancelled) setPendingLoading(false);
      }
    };
    void load();
    const id = window.setInterval(() => {
      void load();
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [onExpired]);

  const handleApprovePending = useCallback(
    async (b: Bidder) => {
      setPendingBusyId(b.id);
      try {
        const approved = await approveBidderRequest(b.id);
        setPendingBidders((prev) => prev.filter((row) => row.id !== b.id));
        setBidders((prev) => {
          const without = prev.filter((row) => row.id !== approved.id);
          return [approved, ...without];
        });
        // Tell the parent nav (AuctionDashboard) to refresh its pending badge.
        window.dispatchEvent(new Event('pendingBiddersChanged'));
        notifyBidderAuditChanged();
        void swalSuccess(`"${approved.name}" has been approved.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/sign in|401|expired/i.test(msg)) {
          onExpired();
          return;
        }
        void swalError(msg);
      } finally {
        setPendingBusyId(null);
      }
    },
    [onExpired]
  );

  const handleRejectPending = useCallback(
    async (b: Bidder) => {
      const ok = await swalConfirmReject(b.name);
      if (!ok) return;
      setPendingBusyId(b.id);
      try {
        const rejected = await rejectBidderRequest(b.id);
        setPendingBidders((prev) => prev.filter((row) => row.id !== b.id));
        // Surface the rejected row in the main table as Inactive so the admin
        // can still see it / hard-delete it later if desired.
        setBidders((prev) => {
          const without = prev.filter((row) => row.id !== rejected.id);
          return [rejected, ...without];
        });
        window.dispatchEvent(new Event('pendingBiddersChanged'));
        notifyBidderAuditChanged();
        void swalSuccess(`"${rejected.name}" has been rejected.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/sign in|401|expired/i.test(msg)) {
          onExpired();
          return;
        }
        void swalError(msg);
      } finally {
        setPendingBusyId(null);
      }
    },
    [onExpired]
  );

  const cardCdByIgn = useMemo(() => {
    const now = Date.now();
    const map = new Map<string, PuppetCardCdDisplay>();
    for (const b of bidders) {
      const key = b.name.trim().toLowerCase();
      if (!key || map.has(key)) continue;
      map.set(
        key,
        puppetCardCdDisplayForIgn(
          b.name,
          weeklyTypeWins,
          auctionEventMode,
          now
        )
      );
    }
    return map;
  }, [bidders, weeklyTypeWins, auctionEventMode]);

  const filtered = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return bidders.filter((b) => {
      if (statusFilter === 'active' && !b.active) return false;
      if (statusFilter === 'inactive' && b.active) return false;
      if (cdFilter !== 'all') {
        const cd = cardCdByIgn.get(b.name.trim().toLowerCase());
        if (cdFilter === 'on_cd' && cd?.tone !== 'cd') return false;
        if (cdFilter === 'ready' && cd?.tone !== 'clear') return false;
      }
      if (!q) return true;
      const hay = `${b.id} ${b.name} ${b.role} ${b.password}`.toLowerCase();
      return hay.includes(q);
    });
  }, [bidders, searchTerm, statusFilter, cdFilter, cardCdByIgn]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, filtered.length);
  const pageRows = useMemo(
    () => filtered.slice(startIndex, endIndex),
    [filtered, startIndex, endIndex]
  );

  // Whenever the filter changes (search, status, or page size), snap back to
  // page 1 so we never end up on an empty page.
  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, cdFilter, pageSize]);

  // Keep `page` clamped if rows were deleted and the current page no longer
  // exists.
  useEffect(() => {
    setPage((p) => Math.min(Math.max(1, p), totalPages));
  }, [totalPages]);

  const counts = useMemo(
    () => ({
      total: bidders.length,
      active: bidders.filter((b) => b.active).length,
      inactive: bidders.filter((b) => !b.active).length,
    }),
    [bidders]
  );

  const openCreate = useCallback(() => {
    setDraft(EMPTY_DRAFT);
    setFormError(null);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((b: Bidder) => {
    setDraft({
      id: b.id,
      name: b.name,
      role: b.role,
      password: b.password,
      active: b.active,
    });
    setFormError(null);
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    if (saving) return;
    setModalOpen(false);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  };

  const submitDraft = async () => {
    const name = draft.name.trim();
    if (!name) {
      setFormError('Name is required');
      return;
    }
    const password = draft.password.trim();
    if (draft.id == null && !password) {
      setFormError('Password is required');
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (draft.id == null) {
        const payload: BidderInput = {
          name,
          role: draft.role,
          password,
        };
        const created = await createBidderRequest(payload);
        setBidders((prev) => [created, ...prev]);
        setModalOpen(false);
        setDraft(EMPTY_DRAFT);
        notifyBidderAuditChanged();
        void swalSuccess(`"${created.name}" has been added.`);
      } else {
        // Password and active are managed elsewhere (row toggle / create flow),
        // so the edit modal only patches name + role.
        const patch: BidderUpdate = {
          name,
          role: draft.role,
        };
        const updated = await updateBidderRequest(draft.id, patch);
        setBidders((prev) =>
          prev.map((b) => (b.id === updated.id ? updated : b))
        );
        setModalOpen(false);
        setDraft(EMPTY_DRAFT);
        notifyBidderAuditChanged();
        void swalSuccess(`"${updated.name}" has been updated.`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (handleAuthFailure(msg)) {
        setModalOpen(false);
        setDraft(EMPTY_DRAFT);
      } else {
        void swalError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = useCallback(
    async (b: Bidder) => {
      const ok = await swalConfirmDelete(b.name, b.id);
      if (!ok) return;
      try {
        await deleteBidderRequest(b.id);
        setBidders((prev) => prev.filter((row) => row.id !== b.id));
        notifyBidderAuditChanged();
        void swalSuccess(`"${b.name}" has been deleted.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (handleAuthFailure(msg)) return;
        void swalError(msg);
      }
    },
    [handleAuthFailure]
  );

  const toggleActive = useCallback(
    async (b: Bidder) => {
      try {
        const updated = await updateBidderRequest(b.id, { active: !b.active });
        setBidders((prev) =>
          prev.map((row) => (row.id === updated.id ? updated : row))
        );
        notifyBidderAuditChanged();
        void swalSuccess(
          `"${updated.name}" is now ${updated.active ? 'Active' : 'Inactive'}.`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (handleAuthFailure(msg)) return;
        void swalError(msg);
      }
    },
    [handleAuthFailure]
  );

  return (
    <section className="space-y-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
            Bidder Registration
          </h2>
          <p className="text-slate-400 text-xs sm:text-sm">
            Manage bidders.
          </p>
          <p className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-slate-400">
            Signed in as{' '}
            <span className="font-bold text-slate-100">{actor.name}</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${
                actor.role === 'Developer'
                  ? 'bg-violet-900/40 text-violet-300'
                  : actor.role === 'Admin'
                    ? 'bg-sky-900/40 text-sky-300'
                    : 'bg-amber-900/40 text-amber-300'
              }`}
            >
              {actor.role}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white shadow-md shadow-blue-900/30 transition-colors hover:bg-blue-500"
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Add Bidder
          </button>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" aria-hidden />
            Sign out
          </button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:max-w-xl sm:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
            Total
          </p>
          <p className="text-2xl font-bold text-white">{counts.total}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
            Active
          </p>
          <p className="text-2xl font-bold text-white">{counts.active}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">
            Inactive
          </p>
          <p className="text-2xl font-bold text-white">{counts.inactive}</p>
        </div>
        <div className="rounded-2xl border border-amber-900/50 bg-amber-950/30 px-4 py-3">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-300">
            Pending
          </p>
          <p className="text-2xl font-bold text-white">{pendingBidders.length}</p>
        </div>
      </div>

      <section
        className="overflow-hidden rounded-2xl border border-amber-900/50 bg-gradient-to-br from-amber-950/40 via-slate-900 to-slate-900"
        aria-labelledby="pending-bidders-heading"
      >
        <header className="flex items-center justify-between gap-3 border-b border-amber-900/40 bg-amber-950/30 px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/20 text-amber-300">
              <Clock className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3
                id="pending-bidders-heading"
                className="text-sm font-bold text-white"
              >
                Pending registrations
              </h3>
              <p className="text-[11px] text-amber-200/70">
                Public sign-ups from <span className="font-mono">/registration</span>. Until approved, they cannot bid.
              </p>
            </div>
          </div>
          {pendingBidders.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-black uppercase tracking-widest text-amber-200">
              {pendingBidders.length} waiting
            </span>
          )}
        </header>
        {pendingError && (
          <div className="border-b border-rose-900/40 bg-rose-950/40 px-4 py-2 text-xs text-rose-200">
            {pendingError}
          </div>
        )}
        {pendingLoading ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            Loading pending registrations…
          </p>
        ) : pendingBidders.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-slate-500">
            No pending registrations. New public sign-ups will show up here.
          </p>
        ) : (
          <ul className="divide-y divide-amber-900/30">
            {pendingBidders.map((b) => {
              const busy = pendingBusyId === b.id;
              return (
                <li
                  key={b.id}
                  className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-slate-800 text-sm font-black text-slate-300">
                      {b.name.charAt(0).toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-white">{b.name}</p>
                      <p className="text-[11px] text-slate-400">
                        <span className="font-mono">id {b.id}</span>
                        <span className="mx-1.5 text-slate-600">•</span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-amber-300">
                          Pending approval
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 sm:justify-end">
                    <button
                      type="button"
                      onClick={() => void handleApprovePending(b)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-white shadow-md shadow-emerald-900/30 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRejectPending(b)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-700 bg-rose-950/60 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-rose-200 transition-colors hover:border-rose-500 hover:bg-rose-900/50 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                      Reject
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search
            className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
            aria-hidden
          />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by id, name, role, or password…"
            className="w-full rounded-xl border border-slate-700 bg-slate-900 px-9 py-2.5 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl border border-slate-700 bg-slate-900 p-1">
            {(['all', 'active', 'inactive'] as const).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => setStatusFilter(opt)}
                className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-colors ${
                  statusFilter === opt
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-xl border border-amber-900/50 bg-slate-900 p-1">
            {(
              [
                { id: 'all', label: 'All CD' },
                { id: 'on_cd', label: 'On CD' },
                { id: 'ready', label: 'Ready' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setCdFilter(opt.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-colors ${
                  cdFilter === opt.id
                    ? 'bg-amber-600 text-white'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-800 bg-rose-950/50 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/50 text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                <th className="px-4 py-3">ID</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Card CD</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    Loading bidders…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-slate-500"
                  >
                    {bidders.length === 0
                      ? 'No bidders yet. Click "Add Bidder" to create one.'
                      : 'No bidders match your filters.'}
                  </td>
                </tr>
              ) : (
                pageRows.map((b) => {
                  const canEditThis = canEditRow(actor.role, b.role);
                  // Delete needs delete-permission (Admin or Developer)
                  // AND the actor must be allowed to touch the target row.
                  const canDeleteThis = canActorDelete && canEditThis;
                  return (
                    <BidderRow
                      key={b.id}
                      bidder={b}
                      cardCd={
                        cardCdByIgn.get(b.name.trim().toLowerCase()) ??
                        puppetCardCdDisplayForIgn(
                          b.name,
                          weeklyTypeWins,
                          auctionEventMode
                        )
                      }
                      canEdit={canEditThis}
                      canDelete={canDeleteThis}
                      onEdit={openEdit}
                      onDelete={handleDelete}
                      onToggleActive={toggleActive}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-800 bg-slate-950/40 px-4 py-3 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-black uppercase tracking-widest text-slate-500">
                Rows per page
              </span>
              <PageSizeMenu value={pageSize} onChange={setPageSize} />
            </div>
            <span className="hidden sm:inline text-slate-500">
              {filtered.length === 0
                ? '0 of 0'
                : `${startIndex + 1}–${endIndex} of ${filtered.length}`}
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="First page"
            >
              <ChevronsLeft className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-700 bg-slate-900 text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Last page"
            >
              <ChevronsRight className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={closeModal}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
              <h3 className="text-base font-bold text-white">
                {isEditing ? `Edit Bidder #${draft.id}` : 'Add New Bidder'}
              </h3>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </header>
            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Name <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, name: e.target.value }))
                  }
                  autoFocus
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500"
                  placeholder="Bidder IGN"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Role
                </label>
                <div className="mt-1.5 inline-flex flex-wrap gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1">
                  {[
                    ...roleOptions,
                    // Defensive: if we're editing a row whose role is somehow
                    // outside the actor's allowed list, still show it so the
                    // existing value isn't silently downgraded on save.
                    ...(isEditing && !roleOptions.includes(draft.role)
                      ? [draft.role]
                      : []),
                  ].map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDraft((d) => ({ ...d, role: opt }))}
                      className={`rounded-lg px-3 py-1.5 text-xs font-black uppercase tracking-wide transition-colors ${
                        draft.role === opt
                          ? 'bg-blue-600 text-white'
                          : 'text-slate-300 hover:bg-slate-800'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
              {!isEditing && (
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
                    Password <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={draft.password}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, password: e.target.value }))
                    }
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500"
                    placeholder="Enter a password for this bidder"
                  />
                </div>
              )}
              {formError && (
                <div className="rounded-xl border border-rose-800 bg-rose-950/50 px-3 py-2 text-xs text-rose-200">
                  {formError}
                </div>
              )}
            </div>
            <footer className="flex items-center justify-end gap-2 border-t border-slate-800 px-5 py-4">
              <button
                type="button"
                onClick={closeModal}
                disabled={saving}
                className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-300 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submitDraft()}
                disabled={
                  saving ||
                  !draft.name.trim() ||
                  (!isEditing && !draft.password.trim())
                }
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black uppercase tracking-wide text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {!isEditing && <Plus className="h-4 w-4" aria-hidden />}
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Add bidder'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Wrapped in React.memo so re-renders of the much-larger `AuctionDashboard`
 * parent (e.g. unrelated state updates) don't cascade into this page.
 */
const BidderRegistration = React.memo(BidderRegistrationInner);
export default BidderRegistration;
