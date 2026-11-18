import { groupMatchups, matchupScore } from "./sleeper-model";
import type { League, Matchup, NflState, Team } from "./sleeper-types";

export type BracketGame = { r: number; m: number; p?: number | null; t1?: number | null; t2?: number | null; w?: number | null; l?: number | null };
export type Game = {
  week: number; id: string; phase: "regular" | "playoff" | "unknown";
  status: "upcoming" | "live" | "final" | "pending";
  sides: [number, number]; scores: [number | null, number | null];
};
export type Result = Game & { scores: [number, number]; status: "final" };
export type RecordLine = { wins: number; losses: number; ties: number; games: number; cents: number };
export const emptyRecord = (): RecordLine => ({ wins: 0, losses: 0, ties: 0, games: 0, cents: 0 });
export const winPct = (r: RecordLine) => r.games ? (r.wins + r.ties / 2) / r.games : null;
export const perGame = (r: RecordLine) => r.games ? r.cents / 100 / r.games : null;
export const recordLabel = (r: RecordLine) => [r.wins, r.losses, ...(r.ties ? [r.ties] : [])].join("–");
export const scoreCents = (score: number) => Math.round(score * 100);
export const finalGame = (g: Game): g is Result => g.status === "final" && g.scores[0] !== null && g.scores[1] !== null;
export const winnerIndex = (g: Result) => {
  const difference = scoreCents(g.scores[0]) - scoreCents(g.scores[1]);
  return difference > 0 ? 0 : difference < 0 ? 1 : null;
};
export const margin = (g: Result) => Math.abs(scoreCents(g.scores[0]) - scoreCents(g.scores[1])) / 100;
export const lastScored = (league: League) => validWeek(league.settings.last_scored_leg) ? league.settings.last_scored_leg : 0;
export const validWeek = (week: unknown): week is number => typeof week === "number" && Number.isInteger(week) && week >= 1 && week <= 18;

export function seasonGames(league: League, state: NflState | null, week: number, entries: Matchup[], rosterIds: Set<number>): Game[] {
  const playoffStart = league.settings.playoff_week_start;
  const phase = validWeek(playoffStart) ? week < playoffStart ? "regular" : "playoff" : "unknown";
  const ids = entries.map(entry => entry.roster_id);
  return groupMatchups(entries).flatMap(([id, pair]) => {
    if (pair.length !== 2 || pair[0].matchup_id === null) return [];
    const [a, b] = pair;
    if ([a, b].some(side => !rosterIds.has(side.roster_id) || ids.indexOf(side.roster_id) !== ids.lastIndexOf(side.roster_id))) return [];
    const scores = [matchupScore(a), matchupScore(b)] as Game["scores"];
    const hasScoring = pair.some((side, i) => scores[i] !== null && scores[i] !== 0
      || side.custom_points != null || side.starters_points?.some(value => value !== 0));
    const activeWeek = state?.season === league.season && state.season_type === "regular" ? state.week : null;
    const started = validWeek(activeWeek) && week <= activeWeek && league.status === "in_season";
    const scored = week <= lastScored(league);
    const status = scored
      ? scores.every(score => score !== null) && hasScoring ? "final" : "pending"
      : started ? hasScoring ? "live" : week === activeWeek ? "upcoming" : "pending"
      : league.status === "complete" ? "pending" : "upcoming";
    return [{ id, week, phase, status, sides: [a.roster_id, b.roster_id], scores }];
  });
}

export function addResult(record: RecordLine, own: number, opponent: number) {
  const score = scoreCents(own);
  const otherScore = scoreCents(opponent);
  record.games++;
  record.cents += score;
  if (score > otherScore) record.wins++;
  else if (score < otherScore) record.losses++;
  else record.ties++;
}

export function resultsByRoster(games: Result[]) {
  const records = new Map<number, RecordLine>();
  for (const { sides, scores } of games) {
    for (const i of [0, 1]) {
      const record = records.get(sides[i]) ?? emptyRecord();
      addResult(record, scores[i], scores[1 - i]);
      records.set(sides[i], record);
    }
  }
  return records;
}

export function rankTeams(teams: Team[], records: Map<number, RecordLine>) {
  const eligible = teams.flatMap(team => {
    const record = records.get(team.id);
    const ppg = record && perGame(record);
    const pct = record && winPct(record);
    return record && ppg != null && pct != null ? [{ team, record, ppg, pct }] : [];
  });
  if (!eligible.length || eligible.length !== teams.length) return [];
  const low = Math.min(...eligible.map(row => row.ppg));
  const high = Math.max(...eligible.map(row => row.ppg));
  return eligible.map(row => {
    const scoring = high === low ? 0.5 : (row.ppg - low) / (high - low);
    return { ...row, score: 100 * (45 * row.pct + 40 * scoring) / 85 };
  }).sort((a, b) => b.score - a.score || b.pct - a.pct || b.ppg - a.ppg || a.team.id - b.team.id);
}

export function bracketDecided(game: BracketGame) {
  return game.w != null && game.l != null && game.w !== game.l
    && [game.t1, game.t2].includes(game.w) && [game.t1, game.t2].includes(game.l);
}

export function championship(league: League, bracket: BracketGame[], results: Result[]) {
  if (league.status !== "complete" || !validWeek(league.settings.playoff_week_start)) return null;
  const finals = bracket.filter(game => game.p === 1);
  const final = finals[0];
  if (finals.length !== 1 || final.r !== Math.max(...bracket.map(game => game.r)) || !bracketDecided(final)) return null;
  const multiWeek = league.settings.playoff_round_type !== 0;
  const expectedWeek = league.settings.playoff_week_start + final.r - 1;
  const weekly = multiWeek ? [] : results.filter(game => game.phase === "playoff" && game.week === expectedWeek
    && game.sides.includes(final.w!) && game.sides.includes(final.l!));
  const game = weekly.length === 1 ? weekly[0] : null;
  const scores = game ? [game.scores[game.sides.indexOf(final.w!)], game.scores[game.sides.indexOf(final.l!)]] : null;
  return { champion: final.w!, runnerUp: final.l!, scores: scores && scores[0] >= scores[1] ? scores : null, week: game?.week };
}

export function gameRecords(games: Result[]) {
  const performances = games.flatMap(game => game.sides.map((id, i) => ({
    game, id, opponent: game.sides[1 - i], value: game.scores[i],
  })));
  const victories = games.flatMap(game => {
    const winner = winnerIndex(game);
    return winner === null ? [] : [{ game, id: game.sides[winner], opponent: game.sides[1 - winner], value: margin(game) }];
  });
  const extremes = (rows: typeof performances, highest: boolean) => {
    if (!rows.length) return [];
    const value = (highest ? Math.max : Math.min)(...rows.map(row => row.value));
    return rows.filter(row => row.value === value);
  };
  const blowouts = extremes(victories, true);
  const defeats = blowouts.map(row => ({ ...row, id: row.opponent, opponent: row.id }));
  return [extremes(performances, true), extremes(performances, false), extremes(victories, false), blowouts, defeats];
}

export function regularSeasonComplete(league: League, teams: Team[], results: Result[]) {
  const start = league.settings.start_week || 1;
  const end = league.settings.playoff_week_start - 1;
  if (!validWeek(start) || !validWeek(end) || end < start || lastScored(league) < end || teams.length !== league.total_rosters) return false;
  return teams.length > 0 && teams.every(team => {
    for (let week = start; week <= end; week++) {
      if (results.filter(game => game.phase === "regular" && game.week === week && game.sides.includes(team.id)).length !== 1) return false;
    }
    return true;
  });
}

export function seasonAwards(league: League, teams: Team[], regular: Result[], qualifiers: Set<number>) {
  if (!regularSeasonComplete(league, teams, regular)) return null;
  const records = resultsByRoster(regular);
  const rows = teams.map(team => ({ team, record: records.get(team.id)! }));
  const order = (a: typeof rows[number], b: typeof rows[number]) => winPct(b.record)! - winPct(a.record)! || b.record.cents - a.record.cents;
  const ranked = [...rows].sort(order);
  const topPoints = Math.max(...rows.map(row => row.record.cents));
  const start = league.settings.start_week || 1;
  const end = league.settings.playoff_week_start - 1;
  const split = start + Math.floor((end - start + 1) / 2);
  const first = resultsByRoster(regular.filter(game => game.week < split));
  const second = resultsByRoster(regular.filter(game => game.week >= split));
  const improvements = rows.filter(row => qualifiers.has(row.team.id)).flatMap(row => {
    const early = first.get(row.team.id);
    const late = second.get(row.team.id);
    if (!early || !late || early.games < 2 || late.games < 2) return [];
    const before = winPct(early)!;
    const after = winPct(late)!;
    return before < 0.5 && after > before ? [{ ...row, before, after, gain: after - before }] : [];
  }).sort((a, b) => b.gain - a.gain || b.record.cents - a.record.cents);
  return {
    points: rows.filter(row => row.record.cents === topPoints),
    manager: ranked.filter(row => order(row, ranked[0]) === 0),
    comeback: league.status === "complete" && improvements.length ? improvements.filter(row =>
      Math.abs(row.gain - improvements[0].gain) < 1e-10 && row.record.cents === improvements[0].record.cents) : [],
  };
}

