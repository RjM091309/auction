/**
 * Tournament brackets — 3v3 double elimination.
 *
 * Flow:
 *   1. Officer/Admin/Developer creates a tournament, either with a player cap
 *      (multiple of the team size) or open (no cap) when the turnout is not
 *      known yet.
 *   2. Members register themselves with IGN + password (same credential
 *      check as "Join queue").
 *   3. With a cap, the registration that fills the last slot shuffles
 *      everyone into teams server-side and seeds the bracket. Admins can also
 *      start early (the only way to start an open tournament) or reshuffle
 *      before any result is recorded. Players past the last full team — the
 *      latest signups — sit out as reserves.
 *   4. Admins click the winning team of each match; the bracket is
 *      recomputed from `results_json` (`tournamentBracket.js`).
 *
 * Deleting an unfinished tournament moves its players into a waiting pool
 * (`tournament_pool`); the next tournament created is seeded from it, so
 * players don't have to register again. Pool entries stay until picked up
 * or removed by an admin.
 */
import { computeDoubleElimBracket } from './tournamentBracket.js';
import { shuffleIds } from './shuffleRandom.js';
import { sanitizeMemberClass } from './memberClasses.js';

export const TEAM_SIZE = 3;
const MIN_TEAMS = 2;
const MAX_PLAYERS = 192;

function clientError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function parseJson(raw, fallback) {
  if (typeof raw !== 'string' || !raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function parseTournamentId(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) throw clientError(400, 'Invalid tournament id');
  return Number(s);
}

/**
 * Started matches that are still being played, in start order. Finished or
 * no-longer-valid ids (e.g. after an upstream edit) drop out automatically.
 */
function liveMatchIds(stored, bracket) {
  if (!bracket || !Array.isArray(stored)) return [];
  const ready = new Set(bracket.matches.filter((m) => m.state === 'ready').map((m) => m.id));
  return [...new Set(stored.map(String))].filter((mid) => ready.has(mid));
}

/** Player cap, or null for open registration. */
function playerCap(row) {
  return row.max_players == null ? null : Number(row.max_players);
}

function rowToSummary(row, playerCount) {
  const teams = parseJson(row.teams_json, []);
  const results = parseJson(row.results_json, {});
  let champion = null;
  let live = [];
  if (teams.length >= MIN_TEAMS) {
    const b = computeDoubleElimBracket(
      teams.map((t) => t.id),
      results
    );
    champion = teams.find((t) => t.id === b.championTeamId) ?? null;
    live = liveMatchIds(parseJson(row.live_matches_json, []), b);
  }
  return {
    id: Number(row.id),
    name: String(row.name),
    status: row.status,
    maxPlayers: playerCap(row),
    teamSize: Number(row.team_size),
    playerCount: Number(playerCount ?? 0),
    createdBy: String(row.created_by ?? ''),
    createdAt: Number(row.created_at),
    startedAt: row.started_at == null ? null : Number(row.started_at),
    completedAt: row.completed_at == null ? null : Number(row.completed_at),
    championName: champion ? champion.name : null,
    liveMatchIds: live,
  };
}

export async function listTournaments(pool) {
  const [rows] = await pool.query(
    `SELECT t.*, (SELECT COUNT(*) FROM tournament_players p WHERE p.tournament_id = t.id) AS player_count
     FROM tournaments t
     ORDER BY t.created_at DESC
     LIMIT 100`
  );
  return rows.map((r) => rowToSummary(r, r.player_count));
}

export async function getTournament(pool, idRaw) {
  const id = parseTournamentId(idRaw);
  const [rows] = await pool.query(`SELECT * FROM tournaments WHERE id = ? LIMIT 1`, [id]);
  if (!rows.length) throw clientError(404, 'Tournament not found');
  const row = rows[0];
  const [players] = await pool.query(
    `SELECT member_id, name, registered_at FROM tournament_players
     WHERE tournament_id = ? ORDER BY registered_at ASC, member_id ASC`,
    [id]
  );
  const teams = parseJson(row.teams_json, []);
  const results = parseJson(row.results_json, {});
  // Job classes are read live from `members` so profile edits show up.
  const memberIds = [
    ...new Set([...players.map((p) => Number(p.member_id)), ...teams.flatMap((t) => t.members.map((m) => Number(m.id)))]),
  ];
  const classById = new Map();
  if (memberIds.length) {
    const [cls] = await pool.query(`SELECT id, job_class FROM members WHERE id IN (?)`, [memberIds]);
    for (const c of cls) classById.set(Number(c.id), c.job_class ?? null);
  }
  for (const t of teams) {
    for (const m of t.members) m.jobClass = classById.get(Number(m.id)) ?? null;
  }
  // Before the shuffle, preview the empty bracket for the planned team count
  // (from the cap, or from the signups so far when registration is open) so
  // players can see the layout while signups are open. Placeholder ids
  // match the ids `shuffleIntoTeams` will assign (t1..tN).
  const preview = teams.length < MIN_TEAMS;
  const teamSize = Number(row.team_size) || TEAM_SIZE;
  const plannedTeams = Math.floor((playerCap(row) ?? players.length) / teamSize);
  const inTeam = new Set(teams.flatMap((t) => t.members.map((m) => Number(m.id))));
  const bracket = computeDoubleElimBracket(
    preview
      ? Array.from({ length: Math.max(MIN_TEAMS, plannedTeams) }, (_, i) => `t${i + 1}`)
      : teams.map((t) => t.id),
    preview ? {} : results
  );
  const playerList = players.map((p) => ({
    memberId: Number(p.member_id),
    name: String(p.name),
    jobClass: classById.get(Number(p.member_id)) ?? null,
    registeredAt: Number(p.registered_at),
  }));
  return {
    ...rowToSummary(row, players.length),
    players: playerList,
    teams,
    // Registered but left out of the teams (count not a multiple of the team size).
    reserves: preview ? [] : playerList.filter((p) => !inTeam.has(p.memberId)),
    bracket: {
      preview,
      matches: bracket.matches,
      upperRounds: bracket.upperRounds,
      lowerRounds: bracket.lowerRounds,
      championTeamId: preview ? null : bracket.championTeamId,
    },
  };
}

export async function createTournament(pool, body, actor) {
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 128) : '';
  if (!name) throw clientError(400, 'Tournament name is required');
  // Empty / null / 0 = open registration: no cap, admin starts it manually.
  const rawCap = body?.maxPlayers;
  const open = rawCap == null || rawCap === '' || Number(rawCap) === 0;
  const maxPlayers = open ? null : Number(rawCap);
  if (!open && (!Number.isInteger(maxPlayers) || maxPlayers < TEAM_SIZE * MIN_TEAMS)) {
    throw clientError(400, `Player count must be at least ${TEAM_SIZE * MIN_TEAMS}`);
  }
  if (!open && maxPlayers > MAX_PLAYERS) {
    throw clientError(400, `Player count must be at most ${MAX_PLAYERS}`);
  }
  if (!open && maxPlayers % TEAM_SIZE !== 0) {
    throw clientError(400, `Player count must be a multiple of ${TEAM_SIZE} (3v3 teams)`);
  }
  const conn = await pool.getConnection();
  let id;
  try {
    await conn.beginTransaction();
    const [res] = await conn.query(
      `INSERT INTO tournaments (name, status, max_players, team_size, created_by, created_at)
       VALUES (?, 'registration', ?, ?, ?, ?)`,
      [name, maxPlayers, TEAM_SIZE, actor.name, Date.now()]
    );
    id = res.insertId;
    // Seed from the waiting pool (earliest first, up to the cap). Overflow
    // stays in the pool for the next tournament. A full cap is not
    // auto-started here — the admin starts it.
    const [pooled] = await conn.query(
      `SELECT member_id, name, registered_at FROM tournament_pool
       ORDER BY registered_at ASC, member_id ASC LIMIT ? FOR UPDATE`,
      [maxPlayers ?? MAX_PLAYERS]
    );
    if (pooled.length) {
      await conn.query(
        `INSERT INTO tournament_players (tournament_id, member_id, name, registered_at) VALUES ?`,
        [pooled.map((p) => [id, p.member_id, p.name, p.registered_at])]
      );
      await conn.query(`DELETE FROM tournament_pool WHERE member_id IN (?)`, [
        pooled.map((p) => p.member_id),
      ]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
  return getTournament(pool, id);
}

/**
 * Delete a tournament. Players of an unfinished one (registration or
 * ongoing) go back to the waiting pool, keeping their original signup time.
 * Returns how many were carried over.
 */
export async function deleteTournament(pool, idRaw) {
  const id = parseTournamentId(idRaw);
  return withLockedTournament(pool, id, async (conn, row) => {
    let carried = 0;
    if (row.status !== 'completed') {
      const [res] = await conn.query(
        `INSERT IGNORE INTO tournament_pool (member_id, name, registered_at)
         SELECT member_id, name, registered_at FROM tournament_players WHERE tournament_id = ?`,
        [id]
      );
      carried = res.affectedRows;
    }
    await conn.query(`DELETE FROM tournaments WHERE id = ?`, [id]);
    return { carried };
  });
}

export async function listPool(pool) {
  const [rows] = await pool.query(
    `SELECT member_id, name, registered_at FROM tournament_pool
     ORDER BY registered_at ASC, member_id ASC`
  );
  return rows.map((p) => ({
    memberId: Number(p.member_id),
    name: String(p.name),
    registeredAt: Number(p.registered_at),
  }));
}

/** Admin: remove a player from the waiting pool for good. */
export async function removeFromPool(pool, memberIdRaw) {
  const memberId = Number(memberIdRaw);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw clientError(400, 'Invalid member id');
  }
  const [res] = await pool.query(`DELETE FROM tournament_pool WHERE member_id = ?`, [memberId]);
  if (!res.affectedRows) throw clientError(404, 'Player is not in the waiting pool');
}

/** Run `fn(conn, row)` inside a transaction holding a row lock on the tournament. */
async function withLockedTournament(pool, id, fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(
      `SELECT * FROM tournaments WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!rows.length) throw clientError(404, 'Tournament not found');
    const out = await fn(conn, rows[0]);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback().catch(() => {});
    throw e;
  } finally {
    conn.release();
  }
}

/**
 * Randomly split players into teams of `teamSize` so that no team has two
 * players of the same job class whenever that is possible (each class has at
 * most one player per team). When a class has more players than there are
 * teams, its extras are spread so as few teams as possible share a class.
 *
 * Method: order players by class — biggest class first, ties and players
 * within a class shuffled — then deal them round-robin across the teams.
 * A class of c ≤ teamCount players lands on c consecutive (mod teamCount)
 * slots, i.e. c different teams. Players without a class go last and are
 * unconstrained. Teams and members are shuffled afterwards so team numbers
 * (= seeds) and pairings stay random.
 *
 * @param {{ id: number, name: string, jobClass: string | null }[]} players
 * @param {number} teamSize
 * @returns {{ id: number, name: string, jobClass: string | null }[][]}
 */
export function buildClassBalancedTeams(players, teamSize) {
  const teamCount = Math.floor(players.length / teamSize);
  const byClass = new Map();
  const classless = [];
  for (const p of players) {
    if (!p.jobClass) {
      classless.push(p);
      continue;
    }
    const list = byClass.get(p.jobClass) ?? [];
    list.push(p);
    byClass.set(p.jobClass, list);
  }
  const shuffled = (list) => shuffleIds(list.map((_, i) => i)).map((i) => list[i]);
  const groups = shuffled([...byClass.values()].map(shuffled)).sort((x, y) => y.length - x.length);
  const ordered = [...groups.flat(), ...shuffled(classless)];

  const offset = shuffleIds(Array.from({ length: teamCount }, (_, i) => i))[0] ?? 0;
  const teams = Array.from({ length: teamCount }, () => []);
  ordered.forEach((p, i) => teams[(i + offset) % teamCount].push(p));
  return shuffled(teams).map(shuffled);
}

/**
 * Shuffle registered players into teams and open the bracket. When the count
 * is not a multiple of the team size, the latest signups (first come, first
 * served) are left out as reserves — `getTournament` derives them.
 */
async function shuffleIntoTeams(conn, row) {
  const [players] = await conn.query(
    `SELECT member_id, name FROM tournament_players WHERE tournament_id = ?
     ORDER BY registered_at ASC, member_id ASC`,
    [row.id]
  );
  const teamSize = Number(row.team_size) || TEAM_SIZE;
  if (players.length < teamSize * MIN_TEAMS) {
    throw clientError(400, `Need at least ${teamSize * MIN_TEAMS} players to start`);
  }
  const starters = players.slice(0, players.length - (players.length % teamSize));
  const ids = starters.map((p) => Number(p.member_id));
  const classById = new Map();
  if (ids.length) {
    const [cls] = await conn.query(`SELECT id, job_class FROM members WHERE id IN (?)`, [ids]);
    for (const c of cls) classById.set(Number(c.id), c.job_class ?? null);
  }
  const teams = buildClassBalancedTeams(
    starters.map((p) => ({
      id: Number(p.member_id),
      name: String(p.name),
      jobClass: classById.get(Number(p.member_id)) ?? null,
    })),
    teamSize
  ).map((members, i) => ({
    id: `t${i + 1}`,
    name: `Team ${i + 1}`,
    members: members.map((m) => ({ id: m.id, name: m.name })),
  }));
  await conn.query(
    `UPDATE tournaments
     SET status = 'ongoing', teams_json = ?, results_json = '{}', live_matches_json = NULL,
         started_at = ?, completed_at = NULL
     WHERE id = ?`,
    [JSON.stringify(teams), Date.now(), row.id]
  );
  return teams;
}

/**
 * Public self-registration. `member` is the already-verified `{ id, name }`.
 * Returns `{ started }` — true when this signup filled the last slot and
 * triggered the automatic team shuffle.
 */
export async function registerPlayer(pool, idRaw, member, jobClassRaw) {
  const id = parseTournamentId(idRaw);
  const jobClass = sanitizeMemberClass(jobClassRaw);
  if (!jobClass) throw clientError(400, 'Please select your class');
  return withLockedTournament(pool, id, async (conn, row) => {
    if (row.status !== 'registration') {
      throw clientError(400, 'Registration for this tournament is closed');
    }
    const [[{ n }]] = await conn.query(
      `SELECT COUNT(*) AS n FROM tournament_players WHERE tournament_id = ?`,
      [id]
    );
    const [dup] = await conn.query(
      `SELECT 1 FROM tournament_players WHERE tournament_id = ? AND member_id = ? LIMIT 1`,
      [id, member.id]
    );
    if (dup.length) throw clientError(400, `${member.name} is already registered`);
    const cap = playerCap(row);
    if (Number(n) >= (cap ?? MAX_PLAYERS)) {
      throw clientError(400, 'This tournament is already full');
    }
    await conn.query(
      `INSERT INTO tournament_players (tournament_id, member_id, name, registered_at)
       VALUES (?, ?, ?, ?)`,
      [id, member.id, member.name, Date.now()]
    );
    // The picked class is saved on the member profile (Bidders tab "Class").
    await conn.query(`UPDATE members SET job_class = ? WHERE id = ?`, [jobClass, member.id]);
    if (cap != null && Number(n) + 1 >= cap) {
      await shuffleIntoTeams(conn, row);
      return { started: true };
    }
    return { started: false };
  });
}

/** Remove a player while registration is still open (self-withdraw or admin). */
export async function removePlayer(pool, idRaw, memberIdRaw) {
  const id = parseTournamentId(idRaw);
  const memberId = Number(memberIdRaw);
  if (!Number.isInteger(memberId) || memberId <= 0) {
    throw clientError(400, 'Invalid member id');
  }
  return withLockedTournament(pool, id, async (conn, row) => {
    if (row.status !== 'registration') {
      throw clientError(400, 'Players can only be removed while registration is open');
    }
    const [res] = await conn.query(
      `DELETE FROM tournament_players WHERE tournament_id = ? AND member_id = ?`,
      [id, memberId]
    );
    if (!res.affectedRows) throw clientError(404, 'Player is not registered');
  });
}

/**
 * Admin: start early (registration; Officer+) or reshuffle teams (ongoing,
 * before any match result is recorded; Developer only).
 */
export async function adminShuffle(pool, idRaw, actor) {
  const id = parseTournamentId(idRaw);
  return withLockedTournament(pool, id, async (conn, row) => {
    if (row.status === 'completed') {
      throw clientError(400, 'Tournament is already completed');
    }
    if (row.status === 'ongoing') {
      if (actor?.role !== 'Developer') {
        throw clientError(403, 'Only a Developer can reshuffle teams');
      }
      const results = parseJson(row.results_json, {});
      if (Object.keys(results).length > 0) {
        throw clientError(400, 'Cannot reshuffle after match results are recorded');
      }
    }
    return shuffleIntoTeams(conn, row);
  });
}

/** Admin: reopen registration — drops teams and all results. */
export async function reopenRegistration(pool, idRaw) {
  const id = parseTournamentId(idRaw);
  return withLockedTournament(pool, id, async (conn) => {
    await conn.query(
      `UPDATE tournaments
       SET status = 'registration', teams_json = NULL, results_json = NULL, live_matches_json = NULL,
           started_at = NULL, completed_at = NULL
       WHERE id = ?`,
      [id]
    );
  });
}

/**
 * Admin: add (`delta = 1`) or remove (`delta = -1`) one game win for a team
 * in a series. The series is decided once a team reaches the required wins
 * (best of 3, Grand Final best of 5). Lowering a decided series reopens it;
 * downstream scores that no longer match the new participants are dropped
 * by the recompute, so editing an early match cascades safely.
 */
export async function adjustMatchScore(pool, idRaw, matchIdRaw, teamIdRaw, deltaRaw) {
  const id = parseTournamentId(idRaw);
  const matchId = String(matchIdRaw ?? '').trim();
  const teamId = String(teamIdRaw ?? '');
  const delta = Number(deltaRaw);
  if (delta !== 1 && delta !== -1) throw clientError(400, 'delta must be 1 or -1');
  return withLockedTournament(pool, id, async (conn, row) => {
    if (row.status === 'registration') {
      throw clientError(400, 'Tournament has not started yet');
    }
    const teams = parseJson(row.teams_json, []);
    const teamIds = teams.map((t) => t.id);
    const results = { ...parseJson(row.results_json, {}) };
    const current = computeDoubleElimBracket(teamIds, results);
    const match = current.matches.find((m) => m.id === matchId);
    if (!match) throw clientError(404, 'Match not found');
    if (match.state !== 'ready' && match.state !== 'done') {
      throw clientError(400, 'Match is not ready yet');
    }
    const idx = match.teams.indexOf(teamId);
    if (idx < 0) throw clientError(400, 'Team is not in this match');

    const scores = [...match.scores];
    if (delta === 1 && match.state === 'done') {
      throw clientError(400, 'This series is already decided');
    }
    if (delta === -1 && scores[idx] <= 0) {
      throw clientError(400, 'Score is already 0');
    }
    scores[idx] += delta;
    results[matchId] = { [match.teams[0]]: scores[0], [match.teams[1]]: scores[1] };

    // Recording a game on a match nobody pressed "Start" on starts it.
    const stored = parseJson(row.live_matches_json, []);
    if (delta === 1 && !stored.includes(matchId)) stored.push(matchId);

    const next = computeDoubleElimBracket(teamIds, results);
    const completed = next.championTeamId != null;
    await conn.query(
      `UPDATE tournaments SET results_json = ?, live_matches_json = ?, status = ?, completed_at = ? WHERE id = ?`,
      [
        JSON.stringify(next.appliedResults),
        JSON.stringify(liveMatchIds(stored, next)),
        completed ? 'completed' : 'ongoing',
        completed ? Number(row.completed_at ?? 0) || Date.now() : null,
        id,
      ]
    );
  });
}

/**
 * Admin: start (`live = true`) or stop a match. Started matches are shown in
 * the live VS banners — several can run at once (e.g. two games at a time in
 * the opening round). A match leaves the banner on its own once decided.
 */
export async function setMatchLive(pool, idRaw, matchIdRaw, liveRaw) {
  const id = parseTournamentId(idRaw);
  const matchId = String(matchIdRaw ?? '').trim();
  const live = liveRaw !== false;
  return withLockedTournament(pool, id, async (conn, row) => {
    const teams = parseJson(row.teams_json, []);
    if (row.status === 'registration' || teams.length < MIN_TEAMS) {
      throw clientError(400, 'Tournament has not started yet');
    }
    const b = computeDoubleElimBracket(
      teams.map((t) => t.id),
      parseJson(row.results_json, {})
    );
    const match = b.matches.find((m) => m.id === matchId);
    if (!match) throw clientError(404, 'Match not found');
    if (live && match.state !== 'ready') {
      throw clientError(400, 'Only a match with both teams set can be started');
    }
    const stored = parseJson(row.live_matches_json, []).filter((mid) => mid !== matchId);
    if (live) stored.push(matchId);
    await conn.query(`UPDATE tournaments SET live_matches_json = ? WHERE id = ?`, [
      JSON.stringify(liveMatchIds(stored, b)),
      id,
    ]);
  });
}

/** Admin: rename a team (bracket stays the same). */
export async function renameTeam(pool, idRaw, teamIdRaw, nameRaw) {
  const id = parseTournamentId(idRaw);
  const teamId = String(teamIdRaw ?? '');
  const name = typeof nameRaw === 'string' ? nameRaw.trim().slice(0, 64) : '';
  if (!name) throw clientError(400, 'Team name is required');
  return withLockedTournament(pool, id, async (conn, row) => {
    const teams = parseJson(row.teams_json, []);
    const team = teams.find((t) => t.id === teamId);
    if (!team) throw clientError(404, 'Team not found');
    team.name = name;
    await conn.query(`UPDATE tournaments SET teams_json = ? WHERE id = ?`, [
      JSON.stringify(teams),
      id,
    ]);
  });
}
