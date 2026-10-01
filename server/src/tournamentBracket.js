/**
 * Double-elimination bracket builder.
 *
 * The bracket is a pure function of the seeded team list and the admin's
 * recorded series scores (`{ [matchId]: { [teamId]: gamesWon } }`). Nothing
 * about the match graph is persisted — recomputing it keeps byes and
 * cascading edits consistent without a per-match table.
 *
 * Every match is a best-of-3 series; the Grand Final is best-of-5. The
 * series is decided as soon as one team reaches the required wins.
 *
 * Layout for P = next power of two ≥ team count (k = log2 P):
 *   Upper  R1..Rk      standard seeding; seeds > team count are byes.
 *   Lower  R1          losers of Upper R1, paired.
 *   Lower  drop-in j   Lower survivors vs losers of Upper Rj (j = 2..k).
 *   Lower  merge       Lower survivors paired up (between drop-in rounds).
 *   Grand Final        Upper champion vs Lower champion (no bracket reset).
 *
 * A slot whose source can never produce a team (a bye) is "empty"; a match
 * with one empty slot auto-advances the other team, so byes never need an
 * admin click.
 */

export const BEST_OF = 3;
export const GRAND_FINAL_BEST_OF = 5;

const EMPTY = { kind: 'empty' };
const PENDING = { kind: 'pending' };

/** Standard bracket seed order so seed 1 meets seed P, 2 meets P-1, etc. */
function seedOrder(size) {
  let order = [0];
  while (order.length < size) {
    const n = order.length * 2;
    const next = [];
    for (const s of order) {
      next.push(s, n - 1 - s);
    }
    order = next;
  }
  return order;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Build the static match graph (no teams resolved yet). */
function buildSkeleton(teamCount) {
  const size = nextPow2(Math.max(2, teamCount));
  const k = Math.log2(size);
  const matches = [];
  const add = (m) => {
    matches.push(m);
    return m.id;
  };

  // Upper bracket.
  const upper = [];
  const order = seedOrder(size);
  const r1 = [];
  for (let i = 0; i < size / 2; i += 1) {
    r1.push(
      add({
        id: `W1-${i + 1}`,
        bracket: 'upper',
        round: 1,
        sources: [
          { type: 'seed', seed: order[i * 2] },
          { type: 'seed', seed: order[i * 2 + 1] },
        ],
      })
    );
  }
  upper.push(r1);
  for (let r = 2; r <= k; r += 1) {
    const prev = upper[r - 2];
    const round = [];
    for (let i = 0; i < prev.length / 2; i += 1) {
      round.push(
        add({
          id: `W${r}-${i + 1}`,
          bracket: 'upper',
          round: r,
          sources: [
            { type: 'winner', match: prev[i * 2] },
            { type: 'winner', match: prev[i * 2 + 1] },
          ],
        })
      );
    }
    upper.push(round);
  }
  const upperFinal = upper[k - 1][0];

  // Lower bracket.
  let lowerRound = 0;
  let lowerChampionSource;
  if (k === 1) {
    // Two teams: the Upper final loser goes straight to the Grand Final.
    lowerChampionSource = { type: 'loser', match: upperFinal };
  } else {
    lowerRound += 1;
    let survivors = [];
    for (let i = 0; i < r1.length / 2; i += 1) {
      survivors.push(
        add({
          id: `L${lowerRound}-${i + 1}`,
          bracket: 'lower',
          round: lowerRound,
          sources: [
            { type: 'loser', match: r1[i * 2] },
            { type: 'loser', match: r1[i * 2 + 1] },
          ],
        })
      );
    }
    for (let j = 2; j <= k; j += 1) {
      // Drop-in: alternate the order of incoming Upper losers so teams that
      // just met in the Upper bracket do not immediately rematch.
      const droppers = j % 2 === 0 ? [...upper[j - 1]].reverse() : upper[j - 1];
      lowerRound += 1;
      const dropIn = [];
      for (let i = 0; i < survivors.length; i += 1) {
        dropIn.push(
          add({
            id: `L${lowerRound}-${i + 1}`,
            bracket: 'lower',
            round: lowerRound,
            sources: [
              { type: 'winner', match: survivors[i] },
              { type: 'loser', match: droppers[i] },
            ],
          })
        );
      }
      survivors = dropIn;
      if (j < k) {
        lowerRound += 1;
        const merged = [];
        for (let i = 0; i < survivors.length / 2; i += 1) {
          merged.push(
            add({
              id: `L${lowerRound}-${i + 1}`,
              bracket: 'lower',
              round: lowerRound,
              sources: [
                { type: 'winner', match: survivors[i * 2] },
                { type: 'winner', match: survivors[i * 2 + 1] },
              ],
            })
          );
        }
        survivors = merged;
      }
    }
    lowerChampionSource = { type: 'winner', match: survivors[0] };
  }

  add({
    id: 'GF-1',
    bracket: 'final',
    round: 1,
    sources: [{ type: 'winner', match: upperFinal }, lowerChampionSource],
  });

  return { matches, upperRounds: k, lowerRounds: lowerRound };
}

function roundLabel(bracket, round, upperRounds, lowerRounds) {
  if (bracket === 'final') return 'Grand Final';
  if (bracket === 'upper') {
    if (round === upperRounds) return 'Upper Final';
    if (round === upperRounds - 1 && upperRounds > 2) return 'Upper Semifinal';
    return `Upper Round ${round}`;
  }
  if (round === lowerRounds) return 'Lower Final';
  return `Lower Round ${round}`;
}

/**
 * @param {string[]} teamIds seeded order (index 0 = seed 1)
 * @param {Record<string, Record<string, number>>} results matchId → games won per team id
 * @returns {{
 *   matches: object[],
 *   upperRounds: number,
 *   lowerRounds: number,
 *   championTeamId: string | null,
 *   appliedResults: Record<string, Record<string, number>>,
 * }}
 */
/** Wins needed to take a series of `bestOf` games. */
export function winsNeeded(bestOf) {
  return Math.floor(bestOf / 2) + 1;
}

/**
 * Series score for a match's two teams, or null if the stored score belongs
 * to a different pairing (an upstream result changed) and must be dropped.
 */
function seriesScore(raw, teams) {
  if (!raw || typeof raw !== 'object') return [0, 0];
  const keys = Object.keys(raw);
  if (keys.some((k) => !teams.includes(k))) return null;
  return teams.map((t) => {
    const n = Number(raw[t] ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
  });
}

export function computeDoubleElimBracket(teamIds, results = {}) {
  const { matches: skeleton, upperRounds, lowerRounds } = buildSkeleton(teamIds.length);
  const out = new Map();
  const appliedResults = {};
  const matches = [];

  const resolve = (src) => {
    if (src.type === 'seed') {
      const id = teamIds[src.seed];
      return id ? { kind: 'team', id } : EMPTY;
    }
    const o = out.get(src.match);
    if (!o) return PENDING;
    return src.type === 'winner' ? o.winner : o.loser;
  };

  let championTeamId = null;

  for (const m of skeleton) {
    const slots = m.sources.map(resolve);
    const teams = slots.map((s) => (s.kind === 'team' ? s.id : null));
    const base = {
      id: m.id,
      bracket: m.bracket,
      round: m.round,
      label: roundLabel(m.bracket, m.round, upperRounds, lowerRounds),
      // Matches whose winner advances into this one (for connector lines).
      feeds: m.sources.filter((s) => s.type === 'winner').map((s) => s.match),
      teams,
      bestOf: m.bracket === 'final' ? GRAND_FINAL_BEST_OF : BEST_OF,
      scores: [null, null],
      winnerTeamId: null,
      state: 'pending',
    };

    let winner = PENDING;
    let loser = PENDING;
    if (slots.some((s) => s.kind === 'pending')) {
      base.state = 'pending';
    } else if (slots.every((s) => s.kind === 'empty')) {
      base.state = 'bye';
      winner = EMPTY;
      loser = EMPTY;
    } else if (slots.some((s) => s.kind === 'empty')) {
      const team = slots.find((s) => s.kind === 'team');
      base.state = 'bye';
      base.winnerTeamId = team.id;
      winner = team;
      loser = EMPTY;
    } else {
      const score = seriesScore(results[m.id], teams) ?? [0, 0];
      const need = winsNeeded(base.bestOf);
      base.scores = score;
      if (score[0] > 0 || score[1] > 0) {
        appliedResults[m.id] = { [teams[0]]: score[0], [teams[1]]: score[1] };
      }
      const wonIdx = score[0] >= need ? 0 : score[1] >= need ? 1 : -1;
      if (wonIdx >= 0) {
        const picked = teams[wonIdx];
        base.state = 'done';
        base.winnerTeamId = picked;
        winner = { kind: 'team', id: picked };
        loser = { kind: 'team', id: teams[1 - wonIdx] };
      } else {
        base.state = 'ready';
      }
    }
    out.set(m.id, { winner, loser });
    matches.push(base);

    if (m.id === 'GF-1' && base.winnerTeamId && base.state !== 'pending') {
      championTeamId = base.winnerTeamId;
    }
  }

  return { matches, upperRounds, lowerRounds, championTeamId, appliedResults };
}
