import { apiUrl } from './apiState';
import { loadStoredActor } from './apiBidders';

const cred: RequestInit = { credentials: 'include' };

export type TournamentStatus = 'registration' | 'ongoing' | 'completed';

export interface TournamentSummary {
  id: number;
  name: string;
  status: TournamentStatus;
  maxPlayers: number;
  teamSize: number;
  playerCount: number;
  createdBy: string;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  championName: string | null;
  /** Matches started by an admin and still in play, in start order. */
  liveMatchIds: string[];
}

export interface TournamentPlayer {
  memberId: number;
  name: string;
  registeredAt: number;
}

export interface TournamentTeam {
  id: string;
  name: string;
  members: { id: number; name: string }[];
}

export type MatchState = 'pending' | 'ready' | 'done' | 'bye';

export interface BracketMatch {
  id: string;
  bracket: 'upper' | 'lower' | 'final';
  round: number;
  label: string;
  /** Matches whose winner advances into this one. */
  feeds: string[];
  teams: [string | null, string | null];
  /** Series length: 3 for every match, 5 for the Grand Final. */
  bestOf: number;
  /** Games won per slot; null until both teams are known. */
  scores: [number | null, number | null];
  winnerTeamId: string | null;
  state: MatchState;
}

export interface TournamentDetail extends TournamentSummary {
  players: TournamentPlayer[];
  teams: TournamentTeam[];
  bracket: {
    /** True while registration is open: placeholder teams, not clickable. */
    preview: boolean;
    matches: BracketMatch[];
    upperRounds: number;
    lowerRounds: number;
    championTeamId: string | null;
  } | null;
}

/** Thrown for non-2xx responses; `status` lets callers re-prompt on 401. */
export class TournamentApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function authHeaders(): Record<string, string> {
  const actor = loadStoredActor();
  return actor ? { Authorization: `Bearer ${actor.token}` } : {};
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...cred,
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text().catch(() => '');
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new TournamentApiError('Invalid JSON from server', res.status);
  }
  if (!res.ok) {
    const msg =
      json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `${res.status} ${res.statusText}`;
    throw new TournamentApiError(msg, res.status);
  }
  return json as T;
}

export async function fetchTournaments(): Promise<TournamentSummary[]> {
  const o = await request<{ tournaments?: TournamentSummary[] }>('/api/tournaments');
  return Array.isArray(o?.tournaments) ? o.tournaments : [];
}

export async function fetchTournament(id: number): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(`/api/tournaments/${id}`);
  return o.tournament;
}

export async function createTournamentRequest(
  name: string,
  maxPlayers: number
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>('/api/tournaments', {
    method: 'POST',
    body: JSON.stringify({ name, maxPlayers }),
  });
  return o.tournament;
}

export async function deleteTournamentRequest(id: number): Promise<void> {
  await request(`/api/tournaments/${id}`, { method: 'DELETE' });
}

export async function registerForTournament(
  id: number,
  name: string,
  password: string
): Promise<{ started: boolean; tournament: TournamentDetail }> {
  return request(`/api/public/tournaments/${id}/register`, {
    method: 'POST',
    body: JSON.stringify({ name, password }),
  });
}

export async function withdrawFromTournament(
  id: number,
  name: string,
  password: string
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(
    `/api/public/tournaments/${id}/withdraw`,
    { method: 'POST', body: JSON.stringify({ name, password }) }
  );
  return o.tournament;
}

export async function removeTournamentPlayer(
  id: number,
  memberId: number
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(
    `/api/tournaments/${id}/players/${memberId}`,
    { method: 'DELETE' }
  );
  return o.tournament;
}

export async function shuffleTournament(id: number): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(`/api/tournaments/${id}/shuffle`, {
    method: 'POST',
  });
  return o.tournament;
}

export async function reopenTournament(id: number): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(`/api/tournaments/${id}/reopen`, {
    method: 'POST',
  });
  return o.tournament;
}

/** Start (show in the live banners) or stop a match. */
export async function setTournamentMatchLive(
  id: number,
  matchId: string,
  live: boolean
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(
    `/api/tournaments/${id}/matches/${encodeURIComponent(matchId)}/live`,
    { method: 'POST', body: JSON.stringify({ live }) }
  );
  return o.tournament;
}

/** Add (+1) or remove (-1) one game win for `teamId` in a series. */
export async function adjustTournamentMatchScore(
  id: number,
  matchId: string,
  teamId: string,
  delta: 1 | -1
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(
    `/api/tournaments/${id}/matches/${encodeURIComponent(matchId)}`,
    { method: 'POST', body: JSON.stringify({ teamId, delta }) }
  );
  return o.tournament;
}

export async function renameTournamentTeam(
  id: number,
  teamId: string,
  name: string
): Promise<TournamentDetail> {
  const o = await request<{ tournament: TournamentDetail }>(
    `/api/tournaments/${id}/teams/${encodeURIComponent(teamId)}`,
    { method: 'PUT', body: JSON.stringify({ name }) }
  );
  return o.tournament;
}
