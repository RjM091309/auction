/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 3v3 double-elimination tournament tab. Public can view brackets and
 * register with their own IGN + password; once the player cap is reached
 * (or an admin starts it — the only way for an open, uncapped tournament)
 * the server shuffles everyone into teams. Officers/Admins/Developers
 * (Bidders-tab session) create tournaments and record match winners.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Crown,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Medal,
  Trophy,
  Play,
  Square,
  Minus,
  Pencil,
  Unlock,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import BidderAuthModal from './BidderAuthModal';
import ClassSelect from './components/ClassSelect';
import { memberClassImage, type MemberClass } from './lib/memberClasses';
import { NameDropdown } from './BidderAuthGate';
import {
  type ActiveMember,
  type BidderActor,
  clearStoredActor,
  fetchActiveMembers,
  loadStoredActor,
  storeActor,
} from './lib/apiBidders';
import {
  type BracketMatch,
  type TournamentDetail,
  type TournamentStatus,
  type TournamentPlayer,
  type TournamentSummary,
  type TournamentTeam,
  TournamentApiError,
  createTournamentRequest,
  fetchTournamentPool,
  removeFromTournamentPool,
  deleteTournamentRequest,
  fetchTournament,
  fetchTournaments,
  registerForTournament,
  removeTournamentPlayer,
  renameTournamentTeam,
  reopenTournament,
  adjustTournamentMatchScore,
  setTournamentMatchLive,
  shuffleTournament,
  withdrawFromTournament,
  editTournamentPlayerClass,
  lockTournamentPlayerClass,
  setTournamentPlayerClassLock,
} from './lib/apiTournaments';

const REFRESH_MS = 10_000;
const TEAM_SIZE = 3;

const SWAL_DARK = {
  background: '#020617',
  color: '#f1f5f9',
  confirmButtonColor: '#2563eb',
  width: 'min(28rem, calc(100vw - 2rem))',
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function swalError(message: string): Promise<void> {
  return Swal.fire({
    ...SWAL_DARK,
    icon: 'error',
    title: 'Error',
    text: message,
    confirmButtonColor: '#dc2626',
  }).then(() => undefined);
}

function swalSuccess(title: string, html: string): Promise<void> {
  return Swal.fire({ ...SWAL_DARK, icon: 'success', title, html }).then(() => undefined);
}

async function swalConfirm(title: string, html: string, confirmText = 'Confirm'): Promise<boolean> {
  const r = await Swal.fire({
    ...SWAL_DARK,
    icon: 'question',
    title,
    html,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonColor: '#334155',
  });
  return r.isConfirmed;
}

const STATUS_COPY: Record<TournamentStatus, { label: string; cls: string }> = {
  registration: { label: 'Registration', cls: 'bg-blue-900/50 text-blue-300 ring-blue-700/50' },
  ongoing: { label: 'Ongoing', cls: 'bg-amber-900/40 text-amber-300 ring-amber-700/50' },
  completed: { label: 'Completed', cls: 'bg-emerald-900/40 text-emerald-300 ring-emerald-700/50' },
};

function StatusBadge({ status }: { status: TournamentStatus }) {
  const c = STATUS_COPY[status];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ${c.cls}`}
    >
      {c.label}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Bracket                                                                     */
/* -------------------------------------------------------------------------- */

const SLOT_HEIGHT = 132;
/** Space between the Upper/Lower brackets and the Grand Final column. */
const GRAND_FINAL_GAP = 96;
/** Smallest zoom used to fit a wide bracket on screen before scrolling. */
const MIN_FIT_SCALE = 0.6;

/**
 * Team name area that opens the team modal on click. Placeholder teams (bracket
 * preview, no members yet) and TBD slots render as plain, non-clickable text.
 */
function TeamNameBox({
  team,
  onOpen,
  className = 'min-w-0 flex-1',
  children,
}: {
  team: TournamentTeam | undefined;
  onOpen: (teamId: string) => void;
  className?: string;
  children: React.ReactNode;
}) {
  if (!team || team.members.length === 0) return <div className={className}>{children}</div>;
  return (
    <button
      type="button"
      onClick={() => onOpen(team.id)}
      title={`View ${team.name}`}
      className={`${className} [text-align:inherit] transition-opacity hover:opacity-80 [&_*]:hover:underline [&_*]:hover:decoration-white/40`}
    >
      {children}
    </button>
  );
}

/** Modal listing one team (clicked) or every team ("Teams" button). */
function TeamsModal({
  title,
  teams,
  championId,
  canRename,
  busy,
  onRename,
  onClose,
  onEditClass,
  onLockClass,
  onToggleLock,
}: {
  title: string;
  teams: TournamentTeam[];
  championId: string | null;
  canRename: boolean;
  busy: boolean;
  onRename: (team: TournamentTeam) => void;
  onClose: () => void;
  /** Self-service class edit for one roster member; resolves `true` on success. */
  onEditClass: (memberId: number, name: string, password: string, jobClass: MemberClass) => Promise<boolean>;
  /** Self-service: the player locks their own class (password, no new class needed). */
  onLockClass: (memberId: number, name: string, password: string) => Promise<boolean>;
  /** Admin override: unlock a class a player locked by mistake. Same gate as `canRename`. */
  onToggleLock: (memberId: number, locked: boolean) => void;
}) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editClass, setEditClass] = useState<MemberClass | ''>('');
  const [editPassword, setEditPassword] = useState('');
  const [editShowPassword, setEditShowPassword] = useState(false);
  const [savingId, setSavingId] = useState<number | null>(null);

  const startEdit = (m: { id: number; name: string; jobClass?: MemberClass | null }) => {
    setEditingId(m.id);
    setEditClass(m.jobClass ?? '');
    setEditPassword('');
    setEditShowPassword(false);
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditPassword('');
  };
  const saveEdit = async (m: { id: number; name: string }) => {
    if (!editClass || !editPassword.trim()) return;
    setSavingId(m.id);
    const ok = await onEditClass(m.id, m.name, editPassword.trim(), editClass);
    setSavingId(null);
    if (ok) cancelEdit();
  };
  const saveLock = async (m: { id: number; name: string }) => {
    if (!editPassword.trim()) return;
    setSavingId(m.id);
    const ok = await onLockClass(m.id, m.name, editPassword.trim());
    setSavingId(null);
    if (ok) cancelEdit();
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
      <header className="flex items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
        <h3 className="flex items-center gap-2 text-base font-black text-white">
          <Users className="h-5 w-5 text-blue-300" aria-hidden />
          {title}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </header>
      <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-3">
        {teams.map((t) => (
            <div
              key={t.id}
              className={`rounded-xl border bg-slate-950/50 p-4 ${
                t.id === championId ? 'border-amber-500/60' : 'border-slate-800'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="flex min-w-0 items-center gap-1.5 truncate text-lg font-black text-white">
                  {t.id === championId && <Trophy className="h-4 w-4 shrink-0 text-amber-300" aria-hidden />}
                  <span className="truncate">{t.name}</span>
                </p>
                {canRename && (
                  <button
                    type="button"
                    onClick={() => onRename(t)}
                    disabled={busy}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-500 hover:text-blue-300"
                  >
                    Rename
                  </button>
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {t.members.map((m) =>
                  editingId === m.id ? (
                    <li key={m.id} className="space-y-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-semibold text-slate-100">{m.name}</span>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={savingId === m.id}
                          aria-label="Cancel"
                          className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-white"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      </div>
                      <ClassSelect
                        id={`edit-class-${m.id}`}
                        value={editClass || null}
                        onChange={(c) => setEditClass(c ?? '')}
                        disabled={savingId === m.id}
                      />
                      <div className="relative">
                        <input
                          type={editShowPassword ? 'text' : 'password'}
                          value={editPassword}
                          onChange={(e) => setEditPassword(e.target.value)}
                          disabled={savingId === m.id}
                          autoComplete="current-password"
                          placeholder="Your password"
                          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 pr-8 font-mono text-xs text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={() => setEditShowPassword((v) => !v)}
                          aria-label={editShowPassword ? 'Hide password' : 'Show password'}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-100"
                        >
                          {editShowPassword ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                        </button>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => void saveEdit(m)}
                          disabled={savingId === m.id || !editClass || !editPassword.trim()}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white hover:bg-blue-500 disabled:opacity-50"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden /> Save
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveLock(m)}
                          disabled={savingId === m.id || !editPassword.trim()}
                          title="Lock your class so it can no longer be edited"
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 py-1.5 text-xs font-bold text-white hover:bg-amber-500 disabled:opacity-50"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden /> Lock
                        </button>
                      </div>
                    </li>
                  ) : (
                    <li
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-800/70 px-3 py-2 text-sm"
                    >
                      <span className="truncate font-semibold text-slate-100">{m.name}</span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span className="text-xs text-slate-400">{m.jobClass ?? '—'}</span>
                        {canRename && (
                          <button
                            type="button"
                            onClick={() => onToggleLock(m.id, !m.classLocked)}
                            disabled={busy}
                            title={m.classLocked ? 'Unlock class editing' : 'Lock class editing'}
                            aria-label={m.classLocked ? `Unlock ${m.name}'s class` : `Lock ${m.name}'s class`}
                            className={`rounded p-1 ${
                              m.classLocked
                                ? 'text-amber-400 hover:bg-slate-700 hover:text-amber-300'
                                : 'text-slate-500 hover:bg-slate-700 hover:text-emerald-300'
                            }`}
                          >
                            {m.classLocked ? (
                              <Lock className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                              <Unlock className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        )}
                        {m.classLocked ? (
                          !canRename && (
                            <span
                              title="Class locked"
                              aria-label="Class locked"
                              className="rounded p-1 text-amber-400"
                            >
                              <Lock className="h-3.5 w-3.5" aria-hidden />
                            </span>
                          )
                        ) : (
                          <button
                            type="button"
                            onClick={() => startEdit(m)}
                            disabled={busy}
                            aria-label={`Edit ${m.name}'s class`}
                            className="rounded p-1 text-slate-500 hover:bg-slate-700 hover:text-blue-300"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </div>
                    </li>
                  )
                )}
              </ul>
            </div>
          ))}
        </div>
      </div>
  );
}

interface MatchCardProps {

  match: BracketMatch;
  teamsById: Map<string, TournamentTeam>;
  highlight: string;
  canEdit: boolean;
  busy: boolean;
  /** Pre-shuffle preview: nothing is live yet. */
  preview: boolean;
  /** Matches an admin started; shown in the live VS banners. */
  liveMatchIds: string[];
  onScore: (match: BracketMatch, teamId: string, delta: 1 | -1) => void;
  onToggleLive: (match: BracketMatch, live: boolean) => void;
  /** Open the team details modal. */
  onOpenTeam: (teamId: string) => void;
}

function MatchCard({
  match: raw,
  teamsById,
  highlight,
  canEdit,
  busy,
  preview,
  liveMatchIds,
  onScore,
  onToggleLive,
  onOpenTeam,
}: MatchCardProps) {
  const match: BracketMatch = preview && raw.state === 'ready' ? { ...raw, state: 'pending' } : raw;
  const isBye = match.state === 'bye';
  const editable = canEdit && (match.state === 'ready' || match.state === 'done');
  const showScore = match.state === 'ready' || match.state === 'done';
  const isLive = !preview && match.state === 'ready' && liveMatchIds.includes(match.id);

  const row = (teamId: string | null, idx: number) => {
    const team = teamId ? teamsById.get(teamId) : undefined;
    const score = match.scores?.[idx] ?? 0;
    const isWinner = !!teamId && match.winnerTeamId === teamId && match.state !== 'bye';
    const isLoser =
      match.state === 'done' && !!teamId && match.winnerTeamId !== null && match.winnerTeamId !== teamId;
    const hit =
      !!highlight &&
      !!team &&
      (team.name.toLowerCase().includes(highlight) ||
        team.members.some((m) => m.name.toLowerCase().includes(highlight)));
    const stepBtn =
      'inline-flex h-5 w-5 cursor-pointer items-center justify-center rounded-md bg-slate-800 text-slate-300 transition-colors hover:bg-blue-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-30';
    return (
      <div
        key={idx}
        className={`flex h-12 items-center gap-2 px-3 ${
          idx === 0 ? '' : 'rounded-b-xl border-t border-slate-800'
        } ${isWinner ? 'bg-emerald-900/40 text-emerald-100' : isLoser ? 'text-slate-500' : 'text-slate-100'} ${
          hit ? 'ring-2 ring-inset ring-amber-400' : ''
        }`}
      >
        <TeamNameBox team={team} onOpen={onOpenTeam}>
          {team ? (
            <>
              <span
                className={`flex items-center gap-1.5 truncate text-[13px] font-bold ${
                  isLoser ? 'line-through decoration-slate-600' : ''
                }`}
              >
                {isWinner && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-300" aria-hidden />}
                <span className="truncate">{team.name}</span>
              </span>
              <span className="block truncate text-[10px] font-medium text-slate-400">
                {team.members.length > 0
                  ? team.members.map((m) => m.name).join(' · ')
                  : 'Waiting for players'}
              </span>
            </>
          ) : (
            <span className="text-xs font-semibold italic text-slate-600">
              {isBye && !team ? 'BYE' : 'TBD'}
            </span>
          )}
        </TeamNameBox>
        {team && showScore && (
          <div className="flex shrink-0 items-center gap-1">
            {editable && (
              <button
                type="button"
                onClick={() => onScore(match, team.id, -1)}
                disabled={busy || score <= 0}
                aria-label={`Remove a game win from ${team.name}`}
                className={stepBtn}
              >
                <Minus className="h-3 w-3" aria-hidden />
              </button>
            )}
            <span
              className={`inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-md px-1 text-sm font-black tabular-nums ${
                isWinner ? 'bg-emerald-600 text-white' : 'bg-slate-950 text-slate-200'
              }`}
            >
              {score}
            </span>
            {editable && (
              <button
                type="button"
                onClick={() => onScore(match, team.id, 1)}
                disabled={busy || match.state === 'done'}
                aria-label={`Add a game win for ${team.name}`}
                className={stepBtn}
              >
                <Plus className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-match-id={match.id}
      className={`relative shrink-0 rounded-xl border bg-slate-900 shadow-lg shadow-black/20 ${
        canEdit ? 'w-56' : 'w-48'
      } ${
        isLive
          ? 'border-rose-500/70'
          : match.state === 'ready'
            ? 'border-blue-600/70'
            : isBye
              ? 'border-slate-800 opacity-50'
              : 'border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-1">
        <span className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
          {match.id} · Bo{match.bestOf}
          {canEdit && match.state === 'ready' && (
            <button
              type="button"
              onClick={() => onToggleLive(match, !isLive)}
              disabled={busy}
              title={isLive ? 'Stop — remove from the live banner' : 'Start game — show in the live banner'}
              className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-black tracking-wider transition-colors disabled:opacity-40 ${
                isLive
                  ? 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  : 'bg-emerald-700 text-white hover:bg-emerald-600'
              }`}
            >
              {isLive ? (
                <Square className="h-2.5 w-2.5" aria-hidden />
              ) : (
                <Play className="h-2.5 w-2.5" aria-hidden />
              )}
              {isLive ? 'Stop' : 'Start'}
            </button>
          )}
        </span>
        <span
          className={`text-[9px] font-black uppercase tracking-wider ${
            isLive
              ? 'animate-pulse text-rose-400'
              : match.state === 'ready'
              ? 'text-blue-300'
              : match.state === 'done'
                ? 'text-emerald-400'
                : 'text-slate-600'
          }`}
        >
          {isLive
            ? '● Live'
            : match.state === 'ready'
              ? 'Ready'
              : match.state === 'done'
              ? 'Final'
              : isBye
                ? 'Bye'
                : 'Waiting'}
        </span>
      </div>
      {row(match.teams[0], 0)}
      {row(match.teams[1], 1)}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Live game banners                                                           */
/* -------------------------------------------------------------------------- */

/** Blue and red light chasing around the VS banner's edge. */
const VERSUS_BORDER =
  'conic-gradient(from 0deg, transparent 0deg, rgba(56,189,248,0.6) 30deg, rgb(125,211,252) 70deg, rgba(56,189,248,0.6) 110deg, transparent 150deg, transparent 180deg, rgba(244,63,94,0.6) 210deg, rgb(253,164,175) 250deg, rgba(244,63,94,0.6) 290deg, transparent 330deg)';

/** Two gold sparks circling the champion banner's edge. */
const CHAMPION_BORDER =
  'conic-gradient(from 0deg, transparent 0deg, rgba(251,191,36,0.6) 30deg, rgb(253,230,138) 70deg, rgba(251,191,36,0.6) 110deg, transparent 150deg, transparent 180deg, rgba(251,191,36,0.6) 210deg, rgb(253,230,138) 250deg, rgba(251,191,36,0.6) 290deg, transparent 330deg)';

/**
 * Animated light running around a rounded-3xl banner's edge. The mask keeps
 * only a 3px ring so a translucent banner body stays clear.
 */
function AnimatedBorder({ gradient }: { gradient: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 rounded-3xl p-[3px]"
      style={{
        WebkitMask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
        maskComposite: 'exclude',
      }}
      aria-hidden
    >
      <div
        className="absolute left-1/2 top-1/2 aspect-square w-[150%] -translate-x-1/2 -translate-y-1/2 animate-spin [animation-duration:5s] motion-reduce:animate-none"
        style={{ background: gradient }}
      />
    </div>
  );
}

function shuffled<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SHUFFLE_MS = 2600;
const SHUFFLE_TICK_MS = 220;

/**
 * Full-screen draw animation shown when teams are formed (auto-start, start
 * early or reshuffle): every name jumbles around, then the teams the server
 * drew are revealed one by one. Purely visual — the teams are already set.
 */
function ShuffleReveal({
  tournamentName,
  teams,
  reserves,
  onClose,
}: {
  tournamentName: string;
  teams: TournamentTeam[];
  reserves: TournamentPlayer[];
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<'shuffle' | 'reveal'>(reduceMotion ? 'reveal' : 'shuffle');
  const [order, setOrder] = useState(() =>
    shuffled([
      ...teams.flatMap((t) => t.members),
      ...reserves.map((p) => ({ id: p.memberId, name: p.name })),
    ])
  );

  useEffect(() => {
    if (phase !== 'shuffle') return;
    const tick = window.setInterval(() => setOrder((o) => shuffled(o)), SHUFFLE_TICK_MS);
    const done = window.setTimeout(() => setPhase('reveal'), SHUFFLE_MS);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(done);
    };
  }, [phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Keep the whole reveal within ~3s however many teams there are.
  const stagger = Math.min(0.3, 3 / Math.max(1, teams.length));

  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 px-4 py-8 backdrop-blur-sm"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      role="dialog"
      aria-modal="true"
      aria-label="Team draw"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">{tournamentName}</p>
            <h3 className="mt-1 flex items-center gap-2 text-xl font-black text-white">
              <motion.span
                animate={phase === 'shuffle' ? { rotate: 360 } : { rotate: 0 }}
                transition={phase === 'shuffle' ? { repeat: Infinity, duration: 0.8, ease: 'linear' } : { duration: 0.3 }}
                className="inline-flex"
              >
                <Shuffle className="h-5 w-5 text-amber-400" aria-hidden />
              </motion.span>
              {phase === 'shuffle' ? 'Shuffling players…' : `${teams.length} teams drawn!`}
            </h3>
          </div>
          <button
            type="button"
            onClick={phase === 'shuffle' ? () => setPhase('reveal') : onClose}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-800 px-3 py-2 text-[11px] font-black uppercase tracking-wide text-slate-200 hover:bg-slate-700"
          >
            {phase === 'shuffle' ? 'Skip' : <><X className="h-4 w-4" aria-hidden /> Close</>}
          </button>
        </div>

        <AnimatePresence mode="wait">
          {phase === 'shuffle' ? (
            <motion.ul
              key="shuffle"
              className="mt-8 flex flex-wrap justify-center gap-2"
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.25 }}
            >
              {order.map((m) => (
                <motion.li
                  key={m.id}
                  layout
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                  className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-bold text-slate-100 shadow"
                >
                  {m.name}
                </motion.li>
              ))}
            </motion.ul>
          ) : (
            <motion.div key="reveal" className="mt-8 space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
                {teams.map((t, i) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0, y: 24, scale: 0.85, rotateX: -60 }}
                    animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
                    transition={{ delay: i * stagger, type: 'spring', stiffness: 260, damping: 20 }}
                    className="rounded-xl border border-amber-600/50 bg-slate-900 p-3 shadow-lg shadow-amber-900/20"
                  >
                    <p className="truncate text-sm font-black text-amber-300">{t.name}</p>
                    <ul className="mt-1.5 space-y-0.5 text-xs text-slate-200">
                      {t.members.map((m, j) => (
                        <motion.li
                          key={m.id}
                          className="truncate"
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * stagger + 0.15 + j * 0.08 }}
                        >
                          {m.name}
                          {m.jobClass && <span className="ml-1.5 text-[10px] text-slate-500">{m.jobClass}</span>}
                        </motion.li>
                      ))}
                    </ul>
                  </motion.div>
                ))}
              </div>
              {reserves.length > 0 && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: teams.length * stagger + 0.3 }}
                  className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300"
                >
                  <strong className="text-white">Reserves:</strong> {reserves.map((p) => p.name).join(', ')}
                </motion.p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

/** Gold winner banner shown once the Grand Final is decided. */
const PORTRAIT_TONES = {
  blue: { panel: 'border-sky-300/30 from-sky-400/35 to-blue-950/70', plate: 'bg-sky-600/90' },
  red: { panel: 'border-rose-300/30 from-rose-400/35 to-red-950/70', plate: 'bg-rose-600/90' },
  gold: { panel: 'border-amber-300/40 from-amber-400/40 to-amber-950/70', plate: 'bg-amber-600/90' },
  silver: { panel: 'border-slate-200/40 from-slate-300/35 to-slate-900/70', plate: 'bg-slate-500/90' },
  bronze: { panel: 'border-orange-300/40 from-orange-400/35 to-orange-950/70', plate: 'bg-orange-700/90' },
  plain: { panel: 'border-white/15 from-white/15 to-slate-950/70', plate: 'bg-slate-700/90' },
} as const;

/**
 * Fighting-game select-screen card for one member: slanted panel with a faded
 * close-up of their class art, the full figure in front, and a name plate.
 * The art faces left, so `flip` turns it to face right.
 */
function ClassPortrait({
  member,
  tone,
  flip = false,
  widthClass,
  heightClass,
  textClass,
}: {
  member: { name: string; jobClass?: MemberClass | null };
  tone: keyof typeof PORTRAIT_TONES;
  flip?: boolean;
  widthClass: string;
  heightClass: string;
  textClass: string;
}) {
  const src = memberClassImage(member.jobClass);
  const t = PORTRAIT_TONES[tone];
  return (
    <li className={`relative min-w-0 flex-1 ${widthClass}`} title={member.jobClass ?? undefined}>
      <div className={`relative ${heightClass}`}>
        <div
          className={`absolute inset-0 -skew-x-6 overflow-hidden rounded-md border bg-gradient-to-b ${t.panel}`}
          aria-hidden
        >
          {src ? (
            <img
              src={src}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-30"
              style={{
                objectPosition: '50% 10%',
                transformOrigin: '50% 12%',
                transform: `skewX(6deg) scale(${flip ? -2.6 : 2.6}, 2.6)`,
              }}
            />
          ) : (
            <span className="absolute inset-0 flex skew-x-6 items-center justify-center text-5xl font-black text-white/15">
              {member.name.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        </div>
        {src && (
          <img
            src={src}
            alt={member.jobClass ?? ''}
            loading="lazy"
            className={`absolute bottom-0 left-1/2 h-[108%] max-w-none -translate-x-1/2 object-contain object-bottom ${
              flip ? '-scale-x-100' : ''
            }`}
          />
        )}
      </div>
      <div className={`relative -mt-2 mx-auto w-[94%] -skew-x-6 rounded-sm px-1 py-0.5 ${t.plate}`}>
        <span className={`block skew-x-6 truncate text-center font-bold text-white ${textClass}`}>{member.name}</span>
      </div>
    </li>
  );
}

/** The team that lost a decided series, or null for byes / unplayed matches. */
function matchLoser(m: BracketMatch | undefined): string | null {
  if (!m || m.state !== 'done' || !m.winnerTeamId) return null;
  return m.teams.find((t) => t && t !== m.winnerTeamId) ?? null;
}

/**
 * 2nd–4th place from the double-elimination graph: the Grand Final loser,
 * the Lower Final loser, then the loser of the lower match feeding the
 * Lower Final (the Upper Final loser is the Lower Final's other entrant).
 */
function runnerUpPlacings(matches: BracketMatch[]): { place: 2 | 3 | 4; teamId: string }[] {
  const byId = new Map(matches.map((m) => [m.id, m]));
  const final = matches.find((m) => m.bracket === 'final');
  const lowerRounds = Math.max(0, ...matches.filter((m) => m.bracket === 'lower').map((m) => m.round));
  const lowerFinal = matches.find((m) => m.bracket === 'lower' && m.round === lowerRounds);
  const lowerSemi = lowerFinal?.feeds.map((id) => byId.get(id)).find((m) => m?.bracket === 'lower');
  const out: { place: 2 | 3 | 4; teamId: string }[] = [];
  for (const [place, m] of [[2, final], [3, lowerFinal], [4, lowerSemi]] as const) {
    const teamId = matchLoser(m);
    if (teamId) out.push({ place, teamId });
  }
  return out;
}

const REWARDS = {
  bounty: { name: 'Bounty Pass', src: '/images/rewards/bountypass.png' },
  radiant: { name: 'Radiant Pass', src: '/images/rewards/radiantpass.png' },
} as const;

/** Prize per finishing place. */
const PRIZES: Record<1 | 2 | 3 | 4, { reward: keyof typeof REWARDS; qty: number }> = {
  1: { reward: 'bounty', qty: 6 },
  2: { reward: 'bounty', qty: 3 },
  3: { reward: 'bounty', qty: 3 },
  4: { reward: 'radiant', qty: 3 },
};

const PRIZE_SPONSOR = 'Miroku';

const PLACE_STYLES = {
  2: { label: '2nd Place', tone: 'silver', text: 'text-slate-200' },
  3: { label: '3rd Place', tone: 'bronze', text: 'text-orange-300' },
  4: { label: '4th Place', tone: 'plain', text: 'text-slate-400' },
} as const;

/** Prize list beside the standings (below them on narrow screens). */
function PrizePanel() {
  const rows = [
    { place: 1, label: 'Champion', text: 'text-amber-300', Icon: Trophy },
    ...([2, 3, 4] as const).map((place) => ({ place, label: PLACE_STYLES[place].label, text: PLACE_STYLES[place].text, Icon: Medal })),
  ] as const;
  return (
    <aside className="w-full rounded-2xl border border-amber-300/20 bg-black/35 p-4 backdrop-blur-sm sm:p-5">
      <p className="text-center text-[11px] font-black uppercase tracking-[0.4em] text-amber-200/90">Prize Pool</p>
      <ul className="mt-4 space-y-2">
        {rows.map(({ place, label, text, Icon }) => {
          const { reward, qty } = PRIZES[place];
          const rw = REWARDS[reward];
          return (
            <li
              key={place}
              className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
                place === 1 ? 'bg-amber-400/10 ring-1 ring-amber-300/30' : 'bg-white/5'
              }`}
            >
              <span className={`flex w-24 shrink-0 items-center gap-1.5 text-[11px] font-black uppercase tracking-wider ${text}`}>
                <Icon className="h-4 w-4 shrink-0" aria-hidden />
                {label}
              </span>
              <img
                src={rw.src}
                alt=""
                loading="lazy"
                className={`shrink-0 drop-shadow-[0_0_8px_rgba(251,191,36,0.4)] ${place === 1 ? 'h-12 w-12' : 'h-10 w-10'}`}
              />
              <span className="min-w-0 text-left text-sm font-bold leading-tight text-slate-100">
                <span className="font-black text-white">{qty}×</span> {rw.name}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-white/50">
        Sponsored by <span className="font-black text-amber-200">{PRIZE_SPONSOR}</span>
      </p>
    </aside>
  );
}

function ChampionBanner({
  champion,
  matches,
  teamsById,
}: {
  champion: TournamentTeam;
  matches: BracketMatch[];
  teamsById: Map<string, TournamentTeam>;
}) {
  const final = matches.find((m) => m.bracket === 'final');
  const placings = runnerUpPlacings(matches);
  const idx = final ? final.teams.indexOf(champion.id) : -1;
  const runnerUpId = final && idx >= 0 ? final.teams[1 - idx] : null;
  const runnerUp = runnerUpId ? teamsById.get(runnerUpId) : undefined;
  const won = final && idx >= 0 ? final.scores?.[idx] ?? null : null;
  const lost = final && idx >= 0 ? final.scores?.[1 - idx] ?? null : null;
  return (
    <section
      aria-label={`Champion: ${champion.name}`}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/20 backdrop-blur-[2px]"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.28),rgba(120,53,15,0.18)_45%,transparent_75%)]"
        aria-hidden
      />
      {/* Slow light rays behind the trophy. */}
      <div
        className="absolute left-1/2 top-1/2 aspect-square w-[160%] -translate-x-1/2 -translate-y-1/2 animate-spin opacity-30 [animation-duration:40s] motion-reduce:animate-none sm:w-[70%]"
        style={{
          background:
            'repeating-conic-gradient(from 0deg, rgba(253,230,138,0.35) 0deg 6deg, transparent 6deg 24deg)',
          maskImage: 'radial-gradient(circle, #000 0%, transparent 60%)',
          WebkitMaskImage: 'radial-gradient(circle, #000 0%, transparent 60%)',
        }}
        aria-hidden
      />
      <AnimatedBorder gradient={CHAMPION_BORDER} />
      <div className="relative grid items-center gap-8 px-4 py-8 sm:py-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:px-8">
        <div className="flex min-w-0 flex-col items-center text-center">
          {/* Title block on the left, the champions' portraits on the right (stacked on phones). */}
          <div className="flex w-full flex-col items-center gap-6 sm:flex-row sm:justify-center sm:gap-10">
            <div className="flex min-w-0 flex-col items-center">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-amber-400/40 blur-2xl" aria-hidden />
                <Trophy
                  className="relative h-14 w-14 text-amber-300 drop-shadow-[0_0_18px_rgba(251,191,36,0.8)] sm:h-20 sm:w-20"
                  aria-hidden
                />
              </div>
              <p className="mt-4 text-[11px] font-black uppercase tracking-[0.5em] text-amber-200/90 sm:text-xs">
                Champion
              </p>
              <p className="mt-2 max-w-full break-words bg-gradient-to-b from-amber-100 via-amber-300 to-amber-600 bg-clip-text text-4xl font-black uppercase italic tracking-wide text-transparent drop-shadow-[0_4px_14px_rgba(0,0,0,0.7)] sm:text-6xl">
                {champion.name}
              </p>
              {won != null && lost != null && (
                <p className="mt-4 text-[11px] font-black uppercase tracking-[0.3em] text-white/70 sm:text-xs">
                  Grand Final{' '}
                  <span className="text-amber-200">
                    {won}–{lost}
                  </span>
                  {runnerUp ? <> vs {runnerUp.name}</> : null}
                </p>
              )}
            </div>
            <ul className="flex w-full max-w-md justify-center gap-1.5 sm:gap-2">
              {champion.members.map((m) => (
                <ClassPortrait
                  key={m.id}
                  member={m}
                  tone="gold"
                  widthClass="max-w-24 sm:max-w-32"
                  heightClass="h-32 sm:h-48"
                  textClass="text-[10px] sm:text-sm"
                />
              ))}
            </ul>
          </div>
        {placings.length > 0 && (
          <div className="mt-8 grid w-full max-w-4xl gap-6 border-t border-amber-200/15 pt-6 sm:grid-cols-3 sm:gap-4">
            {placings.map(({ place, teamId }) => {
              const team = teamsById.get(teamId);
              const st = PLACE_STYLES[place];
              return (
                <div key={place} className="flex min-w-0 flex-col items-center">
                  <p className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.3em] sm:text-[11px] ${st.text}`}>
                    <Medal className="h-4 w-4" aria-hidden />
                    {st.label}
                  </p>
                  <p className="mt-1 max-w-full truncate text-lg font-black uppercase tracking-wide text-white sm:text-xl">
                    {team?.name ?? 'TBD'}
                  </p>
                  <ul className="mt-3 flex w-full max-w-64 justify-center gap-1.5">
                    {team?.members.map((m) => (
                      <ClassPortrait
                        key={m.id}
                        member={m}
                        tone={st.tone}
                        widthClass="max-w-20"
                        heightClass="h-24 sm:h-28"
                        textClass="text-[10px]"
                      />
                    ))}
                  </ul>

                </div>
              );
            })}
          </div>
        )}
        </div>
        <div className="w-full max-w-sm justify-self-center lg:max-w-none">
          <PrizePanel />
        </div>
      </div>
    </section>
  );
}

/**
 * Banner sizing. `full` is the single wide banner (side-by-side name and
 * score from `sm` up); `compact` is used when several games are live and the
 * banners sit next to each other, so it keeps the stacked score-over-name
 * layout at every width.
 */
const VERSUS_SIZES = {
  full: {
    side: 'gap-3 px-3 py-3 sm:gap-5 sm:px-6 sm:py-6',
    blueDir: 'flex-row',
    redDir: 'flex-row-reverse',
    nameBox: 'flex-1',
    blueAlign: 'text-left',
    redAlign: 'text-right',
    name: 'text-sm sm:truncate sm:text-3xl',
    members: 'text-[10px] sm:truncate sm:text-sm',
    lineup: 'gap-1.5 sm:gap-2',
    blueLineup: 'justify-start',
    redLineup: 'justify-end',
    portraitW: 'max-w-24 sm:max-w-32',
    portraitH: 'h-32 sm:h-52',
    score: 'text-5xl sm:text-6xl',
    body: 'px-3 py-5 sm:px-8 sm:py-8',
    grid: 'mt-4 grid-cols-1 gap-2 sm:mt-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-6',
    vs: 'text-3xl sm:text-8xl',
    label: 'text-[10px] sm:text-xs',
    labelBreak: 'block sm:inline',
    labelDot: 'hidden sm:inline',
  },
  compact: {
    side: 'gap-1 px-3 py-4 lg:gap-2 lg:py-5',
    blueDir: 'flex-col-reverse',
    redDir: 'flex-col-reverse',
    nameBox: '',
    blueAlign: '',
    redAlign: '',
    name: 'text-base lg:text-xl',
    members: 'text-[11px] lg:text-xs',
    lineup: 'justify-center gap-1 lg:gap-2',
    blueLineup: '',
    redLineup: '',
    portraitW: 'max-w-24 lg:max-w-20',
    portraitH: 'h-32',
    score: 'text-4xl lg:text-5xl',
    body: 'px-3 py-5 lg:px-5 lg:py-6',
    grid: 'mt-4 grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_1fr] lg:gap-3',
    vs: 'text-4xl lg:text-6xl',
    label: 'text-[10px]',
    labelBreak: 'block',
    labelDot: 'hidden',
  },
} as const;

type VersusSize = keyof typeof VERSUS_SIZES;

function VersusSide({
  team,
  score,
  side,
  size,
  onOpenTeam,
}: {
  team: TournamentTeam | undefined;
  score: number;
  side: 'blue' | 'red';
  size: VersusSize;
  onOpenTeam: (teamId: string) => void;
}) {
  const blue = side === 'blue';
  const z = VERSUS_SIZES[size];
  return (
    <div
      className={`relative flex min-w-0 items-center justify-end text-center ${z.side} ${blue ? z.blueDir : z.redDir}`}
    >
      <TeamNameBox
        team={team}
        onOpen={onOpenTeam}
        className={`w-full min-w-0 ${z.nameBox} ${blue ? z.blueAlign : z.redAlign}`}
      >
        <p className={`break-words font-black uppercase tracking-wider text-white ${z.name}`}>
          {team?.name ?? 'TBD'}
        </p>
        <ul className={`mt-2 flex ${z.lineup} ${blue ? z.blueLineup : z.redLineup}`}>
          {team?.members.map((m) => (
            <ClassPortrait
              key={m.id}
              member={m}
              tone={side}
              flip={blue}
              widthClass={z.portraitW}
              heightClass={z.portraitH}
              textClass={z.members}
            />
          ))}
        </ul>
      </TeamNameBox>
      <span
        className={`shrink-0 font-black tabular-nums drop-shadow-[0_0_14px_currentColor] ${z.score} ${
          blue ? 'text-sky-300' : 'text-rose-300'
        }`}
      >
        {score}
      </span>
    </div>
  );
}

/** Big blue-vs-red header for the match being played right now. */
function VersusBanner({
  match,
  teamsById,
  size = 'full',
  onOpenTeam,
}: {
  match: BracketMatch;
  teamsById: Map<string, TournamentTeam>;
  size?: VersusSize;
  onOpenTeam: (teamId: string) => void;
}) {
  const z = VERSUS_SIZES[size];
  const [a, b] = match.teams;
  const sa = match.scores?.[0] ?? 0;
  const sb = match.scores?.[1] ?? 0;
  return (
    <section
      aria-label={`Live: ${match.label}`}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/20 backdrop-blur-[2px]"
    >
      {/* Translucent diagonal blue / red split (site art shows through).
          Phones stack the teams, so the split runs top / bottom there. */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-sky-500/40 via-blue-800/25 to-blue-950/10 [clip-path:polygon(0_0,100%_0,100%_46%,0_54%)] sm:[clip-path:polygon(0_0,58%_0,42%_100%,0_100%)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-bl from-rose-500/40 via-red-800/25 to-red-950/10 [clip-path:polygon(0_54%,100%_46%,100%_100%,0_100%)] sm:[clip-path:polygon(58%_0,100%_0,100%_100%,42%_100%)]"
        aria-hidden
      />
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            'repeating-linear-gradient(-60deg, transparent 0 46px, rgba(255,255,255,0.08) 46px 48px, transparent 48px 120px)',
        }}
        aria-hidden
      />
      <AnimatedBorder gradient={VERSUS_BORDER} />
      <div className={`relative ${z.body}`}>
        <p className={`text-center font-black uppercase tracking-[0.35em] text-white/80 ${z.label}`}>
          <span className="text-rose-300">●</span> Live
          <span className={z.labelBreak}>
            <span className={z.labelDot}> · </span>
            {match.label} · Game {Math.min(sa + sb + 1, match.bestOf)} · Bo{match.bestOf}
          </span>
        </p>
        <div className={`grid items-stretch ${z.grid}`}>
          <VersusSide team={a ? teamsById.get(a) : undefined} score={sa} side="blue" size={size} onOpenTeam={onOpenTeam} />
          <span
            className={`select-none bg-gradient-to-b from-white via-slate-300 to-slate-500 bg-clip-text self-center justify-self-center px-1 font-black italic leading-none tracking-tighter text-transparent drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] ${z.vs}`}
            aria-label="versus"
          >
            VS
          </span>
          <VersusSide team={b ? teamsById.get(b) : undefined} score={sb} side="red" size={size} onOpenTeam={onOpenTeam} />
        </div>
      </div>
    </section>
  );
}

interface BracketSectionProps {
  title: string;
  accent: string;
  rounds: BracketMatch[][];
  cardProps: Omit<MatchCardProps, 'match'>;
  centerTitle?: boolean;
}

function BracketSection({ title, accent, rounds, cardProps, centerTitle }: BracketSectionProps) {
  const tallest = Math.max(1, ...rounds.map((r) => r.length));
  return (
    <div className="space-y-3">
      <h4
        className={`text-xs font-black uppercase tracking-[0.2em] ${accent} ${centerTitle ? 'text-center' : ''}`}
      >
        {title}
      </h4>
      <div className="flex w-max gap-4">
          {rounds.map((matches) => (
            <div key={matches[0].id} className="flex flex-col">
              <p className="mb-2 text-center text-[10px] font-black uppercase tracking-wider text-slate-400">
                {matches[0].label.toLowerCase() === title.toLowerCase()
                  ? `Best of ${matches[0].bestOf}`
                  : matches[0].label}
              </p>
              <div
                className="flex flex-col justify-around gap-3"
                style={{ minHeight: tallest * SLOT_HEIGHT }}
              >
                {matches.map((m) => (
                  <MatchCard key={m.id} match={m} {...cardProps} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}

interface Connector {
  key: string;
  d: string;
  advanced: boolean;
}

/**
 * Bracket container with SVG elbow lines from each match to the match its winner advances into.
 * Drawn from the cards' measured positions so it stays correct for any
 * bracket size, column height, or viewport width.
 */
function BracketCanvas({
  matches,
  children,
}: {
  matches: BracketMatch[];
  children: React.ReactNode;
}) {
  // Owns the container ref so it is attached before this layout effect runs.
  const containerRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Connector[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [avail, setAvail] = useState(0);

  useLayoutEffect(() => {
    const root = containerRef.current;
    const fit = fitRef.current;
    if (!root || !fit) return;
    const measure = () => {
      // Lines are drawn in the bracket's own (unscaled) coordinates; screen
      // rects are divided by the current fit scale to get back there.
      const base = root.getBoundingClientRect();
      const k = root.offsetWidth > 0 ? base.width / root.offsetWidth : 1;
      const rects = new Map<string, DOMRect>();
      root.querySelectorAll<HTMLElement>('[data-match-id]').forEach((el) => {
        rects.set(el.dataset.matchId ?? '', el.getBoundingClientRect());
      });
      const byId = new Map(matches.map((m) => [m.id, m]));
      const next: Connector[] = [];
      for (const m of matches) {
        const to = rects.get(m.id);
        if (!to) continue;
        for (const feed of m.feeds ?? []) {
          const from = rects.get(feed);
          const src = byId.get(feed);
          if (!from || !src) continue;
          const x1 = (from.right - base.left) / k;
          const y1 = (from.top + from.height / 2 - base.top) / k;
          const x2 = (to.left - base.left) / k;
          const y2 = (to.top + to.height / 2 - base.top) / k;
          // Turn just before the target so long jumps (e.g. Upper Final →
          // Grand Final) run through the empty space beside the columns.
          // The Grand Final sits behind a wider gap, so give it a longer
          // lead-in stub.
          const lead = m.bracket === 'final' ? GRAND_FINAL_GAP / 2 : 8;
          const xm = Math.max(x1 + 4, x2 - lead);
          // Same row (1:1 link, e.g. Lower drop-in rounds): draw it straight.
          const straight = Math.abs(y1 - y2) < 4;
          next.push({
            key: `${feed}>${m.id}`,
            d: straight ? `M ${x1} ${y2} H ${x2}` : `M ${x1} ${y1} H ${xm} V ${y2} H ${x2}`,
            advanced: !!src.winnerTeamId && (src.state === 'done' || src.state === 'bye'),
          });
        }
      }
      setLines(next);
      setSize({ w: root.offsetWidth, h: root.offsetHeight });
      const host = fit.parentElement;
      if (host) {
        const cs = getComputedStyle(host);
        setAvail(host.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    if (fit.parentElement) ro.observe(fit.parentElement);
    return () => ro.disconnect();
  }, [matches]);

  // Shrink to fit the available width (no horizontal scrollbar); below
  // MIN_FIT_SCALE the text gets too small, so fall back to scrolling.
  const scale =
    size.w > 0 && avail > 0 ? Math.max(MIN_FIT_SCALE, Math.min(1, avail / size.w)) : 1;
  const scaledW = size.w * scale;

  return (
    <div
      ref={fitRef}
      className="relative mx-auto overflow-hidden"
      style={{ width: scaledW || undefined, height: size.h * scale || undefined }}
    >
      <div
        ref={containerRef}
        className="relative flex w-max items-center"
        style={{
          gap: GRAND_FINAL_GAP,
          transform: scale < 1 ? `scale(${scale})` : undefined,
          transformOrigin: 'top left',
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0"
          width={size.w}
          height={size.h}
          aria-hidden
        >
          {lines.map((l) => (
            <path
              key={l.key}
              d={l.d}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className={l.advanced ? 'stroke-emerald-500/70' : 'stroke-slate-600/70'}
            />
          ))}
        </svg>
        {children}
      </div>
    </div>
  );
}

function groupRounds(matches: BracketMatch[], bracket: BracketMatch['bracket']): BracketMatch[][] {
  const byRound = new Map<number, BracketMatch[]>();
  for (const m of matches) {
    if (m.bracket !== bracket) continue;
    const list = byRound.get(m.round) ?? [];
    list.push(m);
    byRound.set(m.round, list);
  }
  return [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
}

/* -------------------------------------------------------------------------- */
/* Main section                                                                */
/* -------------------------------------------------------------------------- */

export default function TournamentSection({ active }: { active: boolean }) {
  const [list, setList] = useState<TournamentSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [actor, setActor] = useState<BidderActor | null>(() => loadStoredActor());
  const [authOpen, setAuthOpen] = useState(false);
  const isAdmin = !!actor;
  const isSuperAdmin = actor?.role === 'Admin' || actor?.role === 'Developer';
  const isDeveloper = actor?.role === 'Developer';

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  // Empty = open registration (no cap; team count decided at start).
  const [createMax, setCreateMax] = useState('');
  const [waitingPool, setWaitingPool] = useState<TournamentPlayer[]>([]);
  // Team draw animation: plays when a tournament's teams change while we
  // watch (not on first load), so every viewer sees the shuffle.
  const [reveal, setReveal] = useState<TournamentDetail | null>(null);
  const teamsSigRef = useRef(new Map<number, string>());
  const closeReveal = useCallback(() => setReveal(null), []);

  const [members, setMembers] = useState<ActiveMember[]>([]);
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regClass, setRegClass] = useState<MemberClass | ''>('');
  const [regShowPassword, setRegShowPassword] = useState(false);

  const [highlightInput, setHighlightInput] = useState('');
  /** Team modal: one team id, every team, or closed. */
  const [teamModal, setTeamModal] = useState<string | 'all' | null>('all');
  const openTeam = useCallback((teamId: string) => setTeamModal(teamId), []);
  const closeTeamModal = useCallback(() => setTeamModal(null), []);
  const highlight = highlightInput.trim().toLowerCase();

  const loadList = useCallback(async () => {
    try {
      const [rows, pooled] = await Promise.all([fetchTournaments(), fetchTournamentPool()]);
      setList(rows);
      setWaitingPool(pooled);
      setSelectedId((cur) => (cur != null && rows.some((r) => r.id === cur) ? cur : rows[0]?.id ?? null));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setListLoading(false);
    }
  }, []);

  /** A tournament was deleted (by another admin): drop it from the view. */
  const forgetTournament = useCallback(
    (id: number) => {
      setList((rows) => rows.filter((r) => r.id !== id));
      setDetail((cur) => (cur?.id === id ? null : cur));
      setSelectedId((cur) => (cur === id ? null : cur));
      void loadList();
    },
    [loadList]
  );

  const loadDetail = useCallback(
    async (id: number) => {
      try {
        const d = await fetchTournament(id);
        setDetail((cur) => (cur == null || cur.id === id ? d : cur));
        setError(null);
      } catch (e) {
        if (e instanceof TournamentApiError && e.status === 404) {
          forgetTournament(id);
          return;
        }
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [forgetTournament]
  );

  useEffect(() => {
    if (!active) return;
    void loadList();
    const id = window.setInterval(() => void loadList(), REFRESH_MS * 3);
    return () => window.clearInterval(id);
  }, [active, loadList]);

  // Shuffle announcement — fires every time a player lands on this tab.
  useEffect(() => {
    if (!active) return;
    void Swal.fire({
      ...SWAL_DARK,
      title: '📢 Teams Have Been Shuffled!',
      html: `
        <div style="text-align:left; line-height:1.6;">
          <p>The teams have been shuffled! Please check the updated team composition, coordinate with your party members, and make sure to <strong>lock in your assigned job/class</strong> on the website.</p>
          <p style="margin-top:12px;">⏰ <strong>Job/Class Locking Deadline:</strong> October 15</p>
          <p style="margin-top:12px; color:#fbbf24;">⚠️ <strong>Important:</strong> Jobs/classes will be automatically locked after Guild League, so make sure to finalize your job/class before the deadline!</p>
          <p style="margin-top:12px;">Please coordinate with your teammates and make sure everyone is ready. Thank you, and good luck, everyone! 🔥</p>
        </div>
      `,
      confirmButtonText: 'Got it',
    });
  }, [active]);

  useEffect(() => {
    if (!active || selectedId == null) return;
    setDetail((cur) => (cur?.id === selectedId ? cur : null));
    void loadDetail(selectedId);
    const id = window.setInterval(() => void loadDetail(selectedId), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [active, selectedId, loadDetail]);

  // Member dropdown only matters while signups are open.
  const registrationOpen = detail?.status === 'registration';
  useEffect(() => {
    if (!active || !registrationOpen || members.length > 0) return;
    fetchActiveMembers()
      .then(setMembers)
      .catch(() => {});
  }, [active, registrationOpen, members.length]);

  /** Apply a fresh detail payload and keep the list's summary in sync. */
  useEffect(() => {
    if (!detail) return;
    const sig = detail.teams.map((t) => `${t.id}:${t.members.map((m) => m.id).join(',')}`).join('|');
    const prev = teamsSigRef.current.get(detail.id);
    teamsSigRef.current.set(detail.id, sig);
    if (prev !== undefined && sig !== prev && detail.teams.length >= 2) setReveal(detail);
  }, [detail]);

  const applyDetail = (d: TournamentDetail) => {
    setDetail(d);
    setList((rows) => rows.map((r) => (r.id === d.id ? { ...r, ...d } : r)));
  };

  /** Run an admin call; drop a dead session and re-prompt on 401. */
  const runAdmin = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      if (e instanceof TournamentApiError && e.status === 401) {
        clearStoredActor();
        setActor(null);
        setAuthOpen(true);
      } else if (
        e instanceof TournamentApiError &&
        e.status === 404 &&
        e.message === 'Tournament not found' &&
        detail
      ) {
        forgetTournament(detail.id);
        void swalError('This tournament was deleted. The list has been refreshed.');
      } else {
        void swalError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  };

  const createCap = createMax.trim() === '' ? null : Number(createMax);
  const createCapValid =
    createCap == null ||
    (Number.isInteger(createCap) && createCap >= TEAM_SIZE * 2 && createCap % TEAM_SIZE === 0);

  const handleCreate = () =>
    runAdmin(async () => {
      const t = await createTournamentRequest(createName.trim(), createCap);
      setCreateOpen(false);
      setCreateName('');
      await loadList();
      setSelectedId(t.id);
      setDetail(t);
    });

  const handleDelete = async (t: TournamentSummary) => {
    const ok = await swalConfirm(
      'Delete tournament?',
      t.status === 'completed'
        ? `<p><strong>${escapeHtml(t.name)}</strong> and all its registrations, teams and results will be permanently deleted.</p>`
        : `<p><strong>${escapeHtml(t.name)}</strong> and its teams and results will be deleted.</p><p>Its <strong>${t.playerCount}</strong> registered player(s) move to the waiting pool and join the next tournament created — no need to register again.</p>`,
      'Delete'
    );
    if (!ok) return;
    await runAdmin(async () => {
      const carried = await deleteTournamentRequest(t.id);
      forgetTournament(t.id);
      if (carried > 0) {
        void swalSuccess('Tournament deleted', `<p><strong>${carried}</strong> player(s) moved to the waiting pool.</p>`);
      }
    });
  };

  const handleShuffle = async () => {
    if (!detail) return;
    const reshuffle = detail.status === 'ongoing';
    const ok = await swalConfirm(
      reshuffle ? 'Reshuffle teams?' : 'Start tournament now?',
      reshuffle
        ? '<p>All teams will be shuffled again and the bracket regenerated.</p>'
        : `<p>Registration will close and the <strong>${detail.playerCount}</strong> registered players will be shuffled into <strong>${Math.floor(detail.playerCount / TEAM_SIZE)}</strong> ${TEAM_SIZE}v${TEAM_SIZE} teams.</p>` +
          (detail.playerCount % TEAM_SIZE
            ? `<p>The last <strong>${detail.playerCount % TEAM_SIZE}</strong> to register will sit out as reserves.</p>`
            : ''),
      reshuffle ? 'Reshuffle' : 'Shuffle & start'
    );
    if (!ok) return;
    await runAdmin(async () => applyDetail(await shuffleTournament(detail.id)));
  };

  const handleReopen = async () => {
    if (!detail) return;
    const ok = await swalConfirm(
      'Reopen registration?',
      '<p>Teams and <strong>all match results</strong> will be cleared. Registered players stay.</p>',
      'Reopen'
    );
    if (!ok) return;
    await runAdmin(async () => applyDetail(await reopenTournament(detail.id)));
  };

  const handleRemovePlayer = async (memberId: number, name: string) => {
    if (!detail) return;
    const ok = await swalConfirm('Remove player?', `<p>Remove <strong>${escapeHtml(name)}</strong> from this tournament?</p>`, 'Remove');
    if (!ok) return;
    await runAdmin(async () => applyDetail(await removeTournamentPlayer(detail.id, memberId)));
  };

  const handleRemoveFromPool = async (memberId: number, name: string) => {
    const ok = await swalConfirm(
      'Remove from waiting pool?',
      `<p><strong>${escapeHtml(name)}</strong> will no longer be added to the next tournament and will have to register again.</p>`,
      'Remove'
    );
    if (!ok) return;
    await runAdmin(async () => setWaitingPool(await removeFromTournamentPool(memberId)));
  };

  const handleRenameTeam = async (team: TournamentTeam) => {
    if (!detail) return;
    const r = await Swal.fire({
      ...SWAL_DARK,
      title: 'Rename team',
      input: 'text',
      inputValue: team.name,
      inputAttributes: { maxlength: '64' },
      showCancelButton: true,
      confirmButtonText: 'Save',
      cancelButtonColor: '#334155',
    });
    const name = typeof r.value === 'string' ? r.value.trim() : '';
    if (!r.isConfirmed || !name || name === team.name) return;
    await runAdmin(async () => applyDetail(await renameTournamentTeam(detail.id, team.id, name)));
  };

  const handleToggleClassLock = async (memberId: number, locked: boolean) => {
    if (!detail) return;
    await runAdmin(async () =>
      applyDetail(await setTournamentPlayerClassLock(detail.id, memberId, locked))
    );
  };

  const teamsById = useMemo(() => {
    const map = new Map((detail?.teams ?? []).map((t) => [t.id, t]));
    // Preview bracket (registration still open): show the planned seeds.
    if (detail?.bracket?.preview) {
      for (const m of detail.bracket.matches) {
        for (const id of m.teams) {
          if (id && !map.has(id)) map.set(id, { id, name: `Team ${id.slice(1)}`, members: [] });
        }
      }
    }
    return map;
  }, [detail?.teams, detail?.bracket]);

  const handleScore = async (match: BracketMatch, teamId: string, delta: 1 | -1) => {
    if (!detail) return;
    // Lowering a decided series reopens it and resets what depended on it.
    if (delta === -1 && match.state === 'done') {
      const ok = await swalConfirm(
        'Reopen series?',
        `<p>This reopens <strong>${escapeHtml(match.label)}</strong> (${match.id}). Later matches that depend on it will be reset.</p>`,
        'Reopen'
      );
      if (!ok) return;
    }
    await runAdmin(async () =>
      applyDetail(await adjustTournamentMatchScore(detail.id, match.id, teamId, delta))
    );
  };

  const submitRegistration = async (mode: 'register' | 'withdraw' | 'editClass') => {
    if (!detail || !regName || !regPassword.trim()) return;
    const jobClass = regClass;
    if ((mode === 'register' || mode === 'editClass') && !jobClass) return;
    setBusy(true);
    try {
      if (mode === 'register') {
        const out = await registerForTournament(detail.id, regName, regPassword.trim(), jobClass as MemberClass);
        applyDetail(out.tournament);
        // Filling the last slot starts the draw animation instead of a popup.
        if (!out.started) {
          void swalSuccess(
            'Registered!',
            `<p><strong>${escapeHtml(regName)}</strong> is now registered for <strong>${escapeHtml(detail.name)}</strong>.</p>`
          );
        }
      } else if (mode === 'editClass') {
        applyDetail(
          await editTournamentPlayerClass(detail.id, regName, regPassword.trim(), jobClass as MemberClass)
        );
        void swalSuccess('Class updated', `<p><strong>${escapeHtml(regName)}</strong> is now <strong>${escapeHtml(jobClass)}</strong>.</p>`);
      } else {
        applyDetail(await withdrawFromTournament(detail.id, regName, regPassword.trim()));
        void swalSuccess('Withdrawn', `<p><strong>${escapeHtml(regName)}</strong> left the tournament.</p>`);
      }
      setRegPassword('');
    } catch (e) {
      void swalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Class edit from a roster row in the Teams modal. Returns `true` on success. */
  const handleRosterEditClass = async (
    _memberId: number,
    name: string,
    password: string,
    jobClass: MemberClass
  ): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    try {
      applyDetail(await editTournamentPlayerClass(detail.id, name, password, jobClass));
      void swalSuccess('Class updated', `<p><strong>${escapeHtml(name)}</strong> is now <strong>${escapeHtml(jobClass)}</strong>.</p>`);
      return true;
    } catch (e) {
      void swalError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Self-service: the player locks their own class via the roster row. */
  const handleRosterLockClass = async (
    _memberId: number,
    name: string,
    password: string
  ): Promise<boolean> => {
    if (!detail) return false;
    setBusy(true);
    try {
      applyDetail(await lockTournamentPlayerClass(detail.id, name, password));
      void swalSuccess('Class locked', `<p><strong>${escapeHtml(name)}</strong>'s class is now locked for this tournament.</p>`);
      return true;
    } catch (e) {
      void swalError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  // Prefill the class from the member profile whenever the IGN changes.
  useEffect(() => {
    setRegClass(members.find((m) => m.name === regName)?.jobClass ?? '');
  }, [regName, members]);

  const registeredIds = useMemo(
    () => new Set((detail?.players ?? []).map((p) => p.memberId)),
    [detail?.players]
  );
  const regIsRegistered = useMemo(() => {
    const m = members.find((x) => x.name === regName);
    return !!m && registeredIds.has(m.id);
  }, [members, regName, registeredIds]);

  const bracket = detail?.bracket ?? null;
  const champion = bracket?.championTeamId ? teamsById.get(bracket.championTeamId) : undefined;
  const hasResults = !!bracket?.matches.some((m) => m.state === 'done');
  // Matches an admin started (several can run at once), in start order.
  const liveMatches = useMemo(() => {
    if (!bracket || bracket.preview) return [];
    const byId = new Map(bracket.matches.map((m) => [m.id, m]));
    return (detail?.liveMatchIds ?? [])
      .map((id) => byId.get(id))
      .filter((m): m is BracketMatch => !!m && m.state === 'ready');
  }, [bracket, detail?.liveMatchIds]);
  const canStartEarly =
    !!detail && detail.status === 'registration' && detail.playerCount >= TEAM_SIZE * 2;

  const cardProps = {
    teamsById,
    highlight,
    canEdit: isAdmin && detail?.status !== 'registration' && !detail?.bracket?.preview,
    busy,
    preview: !!bracket?.preview,
    liveMatchIds: liveMatches.map((m) => m.id),
    onScore: (m: BracketMatch, t: string, d: 1 | -1) => void handleScore(m, t, d),
    onToggleLive: (m: BracketMatch, live: boolean) =>
      void runAdmin(async () => {
        if (detail) applyDetail(await setTournamentMatchLive(detail.id, m.id, live));
      }),
    onOpenTeam: openTeam,
  };

  const btn =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="space-y-6 [&_button:not(:disabled)]:cursor-pointer">
      <AnimatePresence>
        {reveal && (
          <ShuffleReveal
            key={`${reveal.id}-${reveal.startedAt}`}
            tournamentName={reveal.name}
            teams={reveal.teams}
            reserves={reveal.reserves}
            onClose={closeReveal}
          />
        )}
      </AnimatePresence>
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
            <Trophy className="h-5 w-5 text-amber-400" aria-hidden />
            Tournament
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {TEAM_SIZE}v{TEAM_SIZE} double elimination · best of 3, Grand Final best of 5. Register with your IGN and password; once all
            slots are filled (or an admin starts it), the system shuffles players into teams.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {actor ? (
            <>
              <span className="text-xs text-slate-400">
                Admin: <strong className="text-slate-200">{actor.name}</strong>
              </span>
              <button
                type="button"
                onClick={() => setCreateOpen((v) => !v)}
                className={`${btn} bg-blue-600 text-white hover:bg-blue-500`}
              >
                <Plus className="h-4 w-4" aria-hidden />
                New tournament
              </button>
              <button
                type="button"
                onClick={() => {
                  clearStoredActor();
                  setActor(null);
                }}
                className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}
                title="Sign out of admin controls"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setAuthOpen(true)}
              className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}
            >
              <LogIn className="h-4 w-4" aria-hidden />
              Admin sign in
            </button>
          )}
        </div>
      </div>

      {/* Create form */}
      {createOpen && isAdmin && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
          className="grid gap-3 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:grid-cols-[1fr_10rem_auto] sm:items-end"
        >
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Tournament name
            </span>
            <input
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              maxLength={128}
              placeholder="e.g. Outlast 3v3 Cup"
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <label className="block">
            <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">
              Players (×{TEAM_SIZE})
            </span>
            <input
              type="number"
              min={TEAM_SIZE * 2}
              step={TEAM_SIZE}
              value={createMax}
              onChange={(e) => setCreateMax(e.target.value)}
              placeholder="No limit"
              title="Leave empty for open registration — start it manually once signups close."
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !createName.trim() || !createCapValid}
              className={`${btn} flex-1 bg-blue-600 text-white hover:bg-blue-500`}
            >
              {createCap == null ? 'Create (open)' : `Create (${Math.floor(createCap / TEAM_SIZE)} teams)`}
            </button>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className={`${btn} bg-slate-800 text-slate-300 hover:bg-slate-700`}
              aria-label="Cancel"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        </form>
      )}

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {waitingPool.length > 0 && (
        <div className="rounded-2xl border border-amber-900/60 bg-amber-950/20 px-4 py-3">
          <p className="text-xs text-amber-200">
            <strong className="text-white">Waiting pool ({waitingPool.length}).</strong> Registered in a deleted
            tournament — they join the next tournament created automatically, no need to register again.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {waitingPool.map((p) => (
              <li
                key={p.memberId}
                className="flex items-center gap-1 rounded-lg bg-slate-950/60 py-1 pl-2.5 pr-1 text-xs font-semibold text-slate-200"
              >
                {p.name}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => void handleRemoveFromPool(p.memberId, p.name)}
                    disabled={busy}
                    aria-label={`Remove ${p.name} from the waiting pool`}
                    className="rounded p-0.5 text-slate-500 hover:bg-rose-900/50 hover:text-rose-300"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tournament picker */}
      {listLoading ? (
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading tournaments…
        </p>
      ) : list.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
          No tournaments yet.{isAdmin ? ' Click “New tournament” to create one.' : ''}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {list.map((t) => (
            <div key={t.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setSelectedId(t.id)}
                className={`rounded-xl border px-4 py-2.5 text-left transition-colors ${
                  isSuperAdmin ? 'pr-10' : ''
                } ${
                  t.id === selectedId
                    ? 'border-blue-500 bg-blue-950/50'
                    : 'border-slate-800 bg-slate-900 hover:border-slate-600'
                }`}
              >
                <span className="block max-w-[14rem] truncate text-sm font-bold text-white">{t.name}</span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                  <StatusBadge status={t.status} />
                  {t.status === 'completed' && t.championName ? (
                    <span className="truncate text-amber-300">🏆 {t.championName}</span>
                  ) : (
                    <span>
                      {t.maxPlayers == null ? `${t.playerCount} players` : `${t.playerCount}/${t.maxPlayers} players`}
                    </span>
                  )}
                </span>
              </button>
              {isSuperAdmin && (
                <button
                  type="button"
                  onClick={() => void handleDelete(t)}
                  disabled={busy}
                  aria-label={`Delete ${t.name}`}
                  title="Delete tournament"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-rose-900/60 hover:text-rose-200 disabled:opacity-40"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Selected tournament */}
      {detail && (
        <div className="space-y-6">
          {/* Registration */}
          {detail.status === 'registration' && (
            <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
              <div className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <div>
                  {detail.maxPlayers == null ? (
                    <>
                      <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                        <span>Open registration</span>
                        <span>{detail.playerCount} players</span>
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {Math.floor(detail.playerCount / TEAM_SIZE)} team(s) so far
                        {detail.playerCount % TEAM_SIZE
                          ? ` · ${TEAM_SIZE - (detail.playerCount % TEAM_SIZE)} more for the next team`
                          : ''}
                        . Teams are drawn when an admin starts the tournament.
                      </p>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center justify-between text-xs font-bold text-slate-300">
                        <span>Slots</span>
                        <span>
                          {detail.playerCount}/{detail.maxPlayers}
                        </span>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                        <div
                          className="h-full rounded-full bg-blue-500 transition-all"
                          style={{ width: `${Math.min(100, (detail.playerCount / detail.maxPlayers) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] text-slate-500">
                        {detail.maxPlayers - detail.playerCount} slot(s) left — auto-shuffle into teams once full.
                      </p>
                    </>
                  )}
                  {isAdmin && canStartEarly && (
                    <button
                      type="button"
                      onClick={() => void handleShuffle()}
                      disabled={busy}
                      className={`${btn} mt-3 w-full bg-amber-600 text-white hover:bg-amber-500`}
                    >
                      <Shuffle className="h-4 w-4" aria-hidden />
                      Shuffle &amp; start now
                    </button>
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submitRegistration(regIsRegistered ? 'editClass' : 'register');
                  }}
                  className="space-y-3"
                >
                  <div>
                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">IGN</span>
                    <div className="mt-1.5">
                      <NameDropdown options={members} value={regName} onChange={setRegName} disabled={busy} />
                    </div>
                  </div>
                  <div>
                    <label
                      htmlFor="tournament-class"
                      className="block text-[10px] font-black uppercase tracking-widest text-slate-400"
                    >
                      Class
                    </label>
                    <div className="mt-1.5">
                      <ClassSelect
                        id="tournament-class"
                        value={regClass || null}
                        onChange={(c) => setRegClass(c ?? '')}
                        disabled={busy}
                      />
                    </div>
                  </div>
                  <div>
                    <span className="block text-[10px] font-black uppercase tracking-widest text-slate-400">Password</span>
                    <div className="relative mt-1.5">
                      <input
                        type={regShowPassword ? 'text' : 'password'}
                        value={regPassword}
                        onChange={(e) => setRegPassword(e.target.value)}
                        disabled={busy}
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pr-10 font-mono text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
                      />
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => setRegShowPassword((v) => !v)}
                        aria-label={regShowPassword ? 'Hide password' : 'Show password'}
                        className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-100"
                      >
                        {regShowPassword ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                      </button>
                    </div>
                  </div>
                  {regIsRegistered ? (
                    <div className="flex gap-2">
                      <button
                        type="submit"
                        disabled={busy || !regName || !regPassword.trim() || !regClass}
                        className={`${btn} flex-1 py-2.5 text-xs bg-blue-600 text-white hover:bg-blue-500`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden /> Save class
                      </button>
                      <button
                        type="button"
                        onClick={() => void submitRegistration('withdraw')}
                        disabled={busy || !regName || !regPassword.trim()}
                        className={`${btn} flex-1 py-2.5 text-xs bg-rose-700 text-white hover:bg-rose-600`}
                      >
                        <UserMinus className="h-4 w-4" aria-hidden /> Withdraw
                      </button>
                    </div>
                  ) : (
                    <button
                      type="submit"
                      disabled={busy || !regName || !regPassword.trim() || !regClass}
                      className={`${btn} w-full py-2.5 text-xs bg-blue-600 text-white hover:bg-blue-500`}
                    >
                      <UserPlus className="h-4 w-4" aria-hidden /> Register
                    </button>
                  )}
                </form>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
                  <Users className="h-4 w-4" aria-hidden /> Registered players
                </h4>
                {detail.players.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">No players registered yet.</p>
                ) : (
                  <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-4">
                    {detail.players.map((p, i) => (
                      <li
                        key={p.memberId}
                        className="flex items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-1.5 text-sm text-slate-200"
                      >
                        <span className="w-6 shrink-0 text-right text-[11px] font-bold text-slate-500">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">
                          {p.name}
                          {p.jobClass && <span className="ml-1.5 text-[11px] font-normal text-slate-500">{p.jobClass}</span>}
                        </span>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => void handleRemovePlayer(p.memberId, p.name)}
                            disabled={busy}
                            aria-label={`Remove ${p.name}`}
                            className="rounded p-1 text-slate-500 hover:bg-rose-900/50 hover:text-rose-300"
                          >
                            <X className="h-3.5 w-3.5" aria-hidden />
                          </button>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}

          {/* Teams + bracket */}
          {detail.status !== 'registration' && bracket && (
            <>
              {champion && (
                <ChampionBanner
                  champion={champion}
                  matches={bracket.matches}
                  teamsById={teamsById}
                />
              )}

              {liveMatches.length > 0 && (
                // One game: a single wide banner. Two or more: side by side.
                <div className={liveMatches.length > 1 ? 'grid gap-4 lg:grid-cols-2' : ''}>
                  {liveMatches.map((m) => (
                    <VersusBanner
                      key={m.id}
                      match={m}
                      teamsById={teamsById}
                      onOpenTeam={openTeam}
                      size={liveMatches.length > 1 ? 'compact' : 'full'}
                    />
                  ))}
                </div>
              )}

              {/* Teams show inline below the banner (click a team, or the "Teams" button). */}
              {detail.status !== 'completed' && (
                <div className="space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <button
                      type="button"
                      onClick={() => setTeamModal((v) => (v ? null : 'all'))}
                      className={`${btn} bg-slate-800 text-white hover:bg-slate-700`}
                    >
                      <Users className="h-4 w-4" aria-hidden />
                      Teams ({detail.teams.length})
                    </button>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      {isDeveloper && detail.status === 'ongoing' && !hasResults && (
                        <button type="button" onClick={() => void handleShuffle()} disabled={busy} className={`${btn} bg-slate-800 text-white hover:bg-amber-700`}>
                          <Shuffle className="h-4 w-4" aria-hidden />
                          Reshuffle teams
                        </button>
                      )}
                      {isSuperAdmin && (
                        <button type="button" onClick={() => void handleReopen()} disabled={busy} className={`${btn} bg-slate-800 text-white hover:bg-amber-800`}>
                          <RotateCcw className="h-4 w-4" aria-hidden />
                          Reopen registration
                        </button>
                      )}
                      <label className="relative block sm:w-64">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" aria-hidden />
                        <input
                          value={highlightInput}
                          onChange={(e) => setHighlightInput(e.target.value)}
                          placeholder="Find an IGN or team…"
                          className="w-full rounded-xl border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
                        />
                      </label>
                    </div>
                  </div>
                  {detail.reserves.length > 0 && (
                    <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
                      <strong className="text-white">Reserves:</strong>{' '}
                      {detail.reserves.map((p) => p.name).join(', ')}
                      <span className="text-slate-500"> — registered after the last full team.</span>
                    </p>
                  )}
                </div>
              )}

              {/* Inline roster (not a popup) — opened via "Teams" above, or by
                  clicking a team name in the live banner / bracket cards. */}
              {teamModal && (
                <TeamsModal
                  title={teamModal === 'all' ? `Teams · ${detail.name}` : teamsById.get(teamModal)?.name ?? 'Team'}
                  teams={
                    teamModal === 'all'
                      ? detail.teams
                      : detail.teams.filter((t) => t.id === teamModal)
                  }
                  championId={bracket?.championTeamId ?? null}
                  canRename={isAdmin}
                  busy={busy}
                  onRename={(t) => void handleRenameTeam(t)}
                  onClose={closeTeamModal}
                  onEditClass={handleRosterEditClass}
                  onLockClass={handleRosterLockClass}
                  onToggleLock={(memberId, locked) => void handleToggleClassLock(memberId, locked)}
                />
              )}
            </>
          )}

          {bracket && (
            <>
              {bracket.preview && (
                <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
                  <strong className="text-white">Bracket preview.</strong>{' '}
                  {detail.maxPlayers == null
                    ? 'Based on the players registered so far — teams are drawn at random when the tournament starts.'
                    : `Teams are drawn at random once all ${detail.maxPlayers} slots are filled.`}
                </p>
              )}
              {isAdmin && detail.status === 'ongoing' && (
                <p className="rounded-xl border border-blue-900/60 bg-blue-950/30 px-4 py-2 text-xs text-blue-200">
                  Press <strong>▶ Start</strong> on a match to show it in the live banner (several can run at once),
                  then use <strong>+</strong> / <strong>−</strong> to record each game. Matches are best of 3 (first to
                  2); the Grand Final is best of 5 (first to 3).
                </p>
              )}

              {/* Upper + Lower stacked on the left, Grand Final on the right,
                  all in one horizontal scroller so the whole bracket reads
                  left → right. */}
              <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <BracketCanvas matches={bracket.matches}>
                  <div className="space-y-8">
                    <BracketSection
                      title="Upper bracket"
                      accent="text-blue-300"
                      rounds={groupRounds(bracket.matches, 'upper')}
                      cardProps={cardProps}
                    />
                    {bracket.lowerRounds > 0 && (
                      <BracketSection
                        title="Lower bracket"
                        accent="text-rose-300"
                        rounds={groupRounds(bracket.matches, 'lower')}
                        cardProps={cardProps}
                      />
                    )}
                  </div>
                  <BracketSection
                    title="Grand final"
                    accent="text-amber-300"
                    centerTitle
                    rounds={groupRounds(bracket.matches, 'final')}
                    cardProps={cardProps}
                  />
                </BracketCanvas>
              </div>
            </>
          )}
        </div>
      )}


      <BidderAuthModal
        open={authOpen}
        title="Sign in to manage tournaments"
        description="Officer, Admin, or Developer access required."
        submitLabel="Sign in"
        allowedRoles={['Officer', 'Admin', 'Developer']}
        onAuth={(a) => {
          storeActor(a);
          setActor(a);
          setAuthOpen(false);
        }}
        onCancel={() => setAuthOpen(false)}
      />
    </section>
  );
}
