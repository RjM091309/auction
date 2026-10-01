/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 3v3 double-elimination tournament tab. Public can view brackets and
 * register with their own IGN + password; once the player cap is reached
 * the server shuffles everyone into teams. Officers/Admins/Developers
 * (Bidders-tab session) create tournaments and record match winners.
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Swal from 'sweetalert2';
import {
  Crown,
  Eye,
  EyeOff,
  Loader2,
  LogIn,
  LogOut,
  Plus,
  RotateCcw,
  Search,
  Shuffle,
  Trophy,
  Play,
  Square,
  Minus,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import BidderAuthModal from './BidderAuthModal';
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
  type TournamentSummary,
  type TournamentTeam,
  TournamentApiError,
  createTournamentRequest,
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
        <div className="min-w-0 flex-1">
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
        </div>
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

/** Gold winner banner shown once the Grand Final is decided. */
function ChampionBanner({
  champion,
  final,
  teamsById,
}: {
  champion: TournamentTeam;
  final: BracketMatch | undefined;
  teamsById: Map<string, TournamentTeam>;
}) {
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
      <div className="relative flex flex-col items-center px-4 py-8 text-center sm:py-10">
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
        <ul className="mt-4 flex flex-wrap justify-center gap-2">
          {champion.members.map((m) => (
            <li
              key={m.id}
              className="rounded-full border border-amber-400/40 bg-amber-950/40 px-3 py-1 text-xs font-bold text-amber-100 sm:text-sm"
            >
              {m.name}
            </li>
          ))}
        </ul>
        {won != null && lost != null && (
          <p className="mt-5 text-[11px] font-black uppercase tracking-[0.3em] text-white/70 sm:text-xs">
            Grand Final{' '}
            <span className="text-amber-200">
              {won}–{lost}
            </span>
            {runnerUp ? <> vs {runnerUp.name}</> : null}
          </p>
        )}
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
    side: 'px-2 py-3 sm:gap-5 sm:px-6 sm:py-6',
    blueDir: 'sm:flex-row',
    redDir: 'sm:flex-row-reverse',
    nameBox: 'sm:flex-1',
    blueAlign: 'sm:text-left',
    redAlign: 'sm:text-right',
    name: 'text-sm sm:truncate sm:text-3xl',
    members: 'text-[10px] sm:truncate sm:text-sm',
    score: 'text-3xl sm:text-6xl',
    body: 'px-3 py-5 sm:px-8 sm:py-8',
    grid: 'mt-4 gap-2 sm:mt-6 sm:items-center sm:gap-6',
    vs: 'text-3xl sm:text-8xl',
    label: 'text-[10px] sm:text-xs',
    labelBreak: 'block sm:inline',
    labelDot: 'hidden sm:inline',
  },
  compact: {
    side: 'px-3 py-4 lg:gap-2 lg:py-5',
    blueDir: '',
    redDir: '',
    nameBox: '',
    blueAlign: '',
    redAlign: '',
    name: 'text-base lg:text-xl',
    members: 'text-[11px] lg:text-xs',
    score: 'text-4xl lg:text-5xl',
    body: 'px-3 py-5 lg:px-5 lg:py-6',
    grid: 'mt-4 gap-2 lg:gap-3',
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
}: {
  team: TournamentTeam | undefined;
  score: number;
  side: 'blue' | 'red';
  size: VersusSize;
}) {
  const blue = side === 'blue';
  const z = VERSUS_SIZES[size];
  return (
    <div
      className={`relative flex min-w-0 flex-col-reverse items-center justify-end gap-1 rounded-2xl border text-center backdrop-blur-sm ${z.side} ${
        blue
          ? `${z.blueDir} border-sky-400/50 bg-sky-950/25 shadow-[0_0_40px_-6px_rgba(56,189,248,0.45)]`
          : `${z.redDir} border-rose-400/50 bg-rose-950/25 shadow-[0_0_40px_-6px_rgba(251,113,133,0.45)]`
      }`}
    >
      <div className={`w-full min-w-0 ${z.nameBox} ${blue ? z.blueAlign : z.redAlign}`}>
        <p className={`break-words font-black uppercase tracking-wider text-white ${z.name}`}>
          {team?.name ?? 'TBD'}
        </p>
        <p
          className={`mt-1 font-semibold leading-snug ${z.members} ${
            blue ? 'text-sky-200/80' : 'text-rose-200/80'
          }`}
        >
          {team?.members.map((m) => m.name).join(' · ')}
        </p>
      </div>
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
}: {
  match: BracketMatch;
  teamsById: Map<string, TournamentTeam>;
  size?: VersusSize;
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
      {/* Translucent diagonal blue / red split (site art shows through). */}
      <div
        className="absolute inset-0 bg-gradient-to-br from-sky-500/40 via-blue-800/25 to-blue-950/10"
        style={{ clipPath: 'polygon(0 0, 58% 0, 42% 100%, 0 100%)' }}
        aria-hidden
      />
      <div
        className="absolute inset-0 bg-gradient-to-bl from-rose-500/40 via-red-800/25 to-red-950/10"
        style={{ clipPath: 'polygon(58% 0, 100% 0, 100% 100%, 42% 100%)' }}
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
        <div className={`grid grid-cols-[1fr_auto_1fr] items-stretch ${z.grid}`}>
          <VersusSide team={a ? teamsById.get(a) : undefined} score={sa} side="blue" size={size} />
          <span
            className={`select-none bg-gradient-to-b from-white via-slate-300 to-slate-500 bg-clip-text self-center px-1 font-black italic leading-none tracking-tighter text-transparent drop-shadow-[0_4px_12px_rgba(0,0,0,0.8)] ${z.vs}`}
            aria-label="versus"
          >
            VS
          </span>
          <VersusSide team={b ? teamsById.get(b) : undefined} score={sb} side="red" size={size} />
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

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createMax, setCreateMax] = useState(12);

  const [members, setMembers] = useState<ActiveMember[]>([]);
  const [regName, setRegName] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regShowPassword, setRegShowPassword] = useState(false);

  const [highlightInput, setHighlightInput] = useState('');
  const highlight = highlightInput.trim().toLowerCase();

  const loadList = useCallback(async () => {
    try {
      const rows = await fetchTournaments();
      setList(rows);
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

  const handleCreate = () =>
    runAdmin(async () => {
      const t = await createTournamentRequest(createName.trim(), createMax);
      setCreateOpen(false);
      setCreateName('');
      await loadList();
      setSelectedId(t.id);
      setDetail(t);
    });

  const handleDelete = async (t: TournamentSummary) => {
    const ok = await swalConfirm(
      'Delete tournament?',
      `<p><strong>${escapeHtml(t.name)}</strong> and all its registrations, teams and results will be permanently deleted.</p>`,
      'Delete'
    );
    if (!ok) return;
    await runAdmin(async () => {
      await deleteTournamentRequest(t.id);
      forgetTournament(t.id);
    });
  };

  const handleShuffle = async () => {
    if (!detail) return;
    const reshuffle = detail.status === 'ongoing';
    const ok = await swalConfirm(
      reshuffle ? 'Reshuffle teams?' : 'Start tournament now?',
      reshuffle
        ? '<p>All teams will be shuffled again and the bracket regenerated.</p>'
        : `<p>Registration will close and the <strong>${detail.playerCount}</strong> registered players will be shuffled into ${TEAM_SIZE}v${TEAM_SIZE} teams.</p>`,
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

  const submitRegistration = async (mode: 'register' | 'withdraw') => {
    if (!detail || !regName || !regPassword.trim()) return;
    setBusy(true);
    try {
      if (mode === 'register') {
        const out = await registerForTournament(detail.id, regName, regPassword.trim());
        applyDetail(out.tournament);
        void swalSuccess(
          out.started ? 'Registered — teams are set!' : 'Registered!',
          out.started
            ? `<p><strong>${escapeHtml(regName)}</strong> filled the last slot. Players have been shuffled into ${TEAM_SIZE}v${TEAM_SIZE} teams and the bracket is live.</p>`
            : `<p><strong>${escapeHtml(regName)}</strong> is now registered for <strong>${escapeHtml(detail.name)}</strong>.</p>`
        );
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
    !!detail &&
    detail.status === 'registration' &&
    detail.playerCount >= TEAM_SIZE * 2 &&
    detail.playerCount % TEAM_SIZE === 0;

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
  };

  const btn =
    'inline-flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50';

  return (
    <section className="space-y-6 [&_button:not(:disabled)]:cursor-pointer">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-black tracking-tight text-white">
            <Trophy className="h-5 w-5 text-amber-400" aria-hidden />
            Tournament
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {TEAM_SIZE}v{TEAM_SIZE} double elimination · best of 3, Grand Final best of 5. Register with your IGN and password; once all
            slots are filled, the system automatically shuffles players into teams.
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
              onChange={(e) => setCreateMax(Number(e.target.value))}
              className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !createName.trim() || createMax < TEAM_SIZE * 2 || createMax % TEAM_SIZE !== 0}
              className={`${btn} flex-1 bg-blue-600 text-white hover:bg-blue-500`}
            >
              Create ({Math.floor(createMax / TEAM_SIZE) || 0} teams)
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
                      {t.playerCount}/{t.maxPlayers} players
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
                    void submitRegistration(regIsRegistered ? 'withdraw' : 'register');
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
                  <button
                    type="submit"
                    disabled={busy || !regName || !regPassword.trim()}
                    className={`${btn} w-full py-2.5 text-xs ${
                      regIsRegistered
                        ? 'bg-rose-700 text-white hover:bg-rose-600'
                        : 'bg-blue-600 text-white hover:bg-blue-500'
                    }`}
                  >
                    {regIsRegistered ? (
                      <>
                        <UserMinus className="h-4 w-4" aria-hidden /> Withdraw
                      </>
                    ) : (
                      <>
                        <UserPlus className="h-4 w-4" aria-hidden /> Register
                      </>
                    )}
                  </button>
                </form>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
                <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
                  <Users className="h-4 w-4" aria-hidden /> Registered players
                </h4>
                {detail.players.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">No players registered yet.</p>
                ) : (
                  <ol className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
                    {detail.players.map((p, i) => (
                      <li
                        key={p.memberId}
                        className="flex items-center gap-2 rounded-lg bg-slate-950/60 px-3 py-1.5 text-sm text-slate-200"
                      >
                        <span className="w-6 shrink-0 text-right text-[11px] font-bold text-slate-500">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
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
                  final={bracket.matches.find((m) => m.bracket === 'final')}
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
                      size={liveMatches.length > 1 ? 'compact' : 'full'}
                    />
                  ))}
                </div>
              )}

              <div className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h4 className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-400">
                    <Users className="h-4 w-4" aria-hidden /> Teams
                  </h4>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    {isAdmin && detail.status === 'ongoing' && !hasResults && (
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
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-4">
                  {detail.teams.map((t) => {
                    const hit =
                      !!highlight &&
                      (t.name.toLowerCase().includes(highlight) ||
                        t.members.some((m) => m.name.toLowerCase().includes(highlight)));
                    return (
                      <div
                        key={t.id}
                        className={`rounded-xl border bg-slate-900 p-3 ${
                          hit ? 'border-amber-400' : t.id === champion?.id ? 'border-amber-600/60' : 'border-slate-800'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-black text-white">{t.name}</p>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() => void handleRenameTeam(t)}
                              disabled={busy}
                              className="text-[10px] font-bold uppercase tracking-wide text-slate-500 hover:text-blue-300"
                            >
                              Rename
                            </button>
                          )}
                        </div>
                        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-300">
                          {t.members.map((m) => (
                            <li key={m.id} className="truncate">
                              {m.name}
                            </li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              </div>

            </>
          )}

          {bracket && (
            <>
              {bracket.preview && (
                <p className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-2 text-xs text-slate-300">
                  <strong className="text-white">Bracket preview.</strong> Teams are drawn at random once all{' '}
                  {detail.maxPlayers} slots are filled.
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
