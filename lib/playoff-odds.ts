import { finalGame, scoreCents, seasonGames, validWeek } from "./league-results";
import type { League, Matchup, Team } from "./sleeper-types";

export const simulationCount = 20_000;
export type PlayoffOdds = Record<number, { percent: number; status?: "clinched" | "eliminated" | "qualified" | "missed" }>;
type Entry = { id: number; record: number; pf: number; pa: number; division: number; samples: number[] };
export type Model = { spots: number; median: boolean; divisions: boolean; entries: Entry[]; weeks: [number, number][][] };

export function preparePlayoffModel(league: League, teams: Team[], weeks: Matchup[][]): Model | null {
  const { start_week: start = 1, playoff_week_start: end, playoff_teams: spots, last_scored_leg: through,
    league_average_match: median = 0, divisions = 0 } = league.settings;
  if (!validWeek(start) || !validWeek(end) || end <= start || !validWeek(through) || through < start ||
    !Number.isInteger(spots) || spots < 1 || spots > teams.length || teams.length !== (league.total_rosters ?? league.settings.num_teams) ||
    weeks.length !== end - start || ![0, 1].includes(median)) return null;

  const entries: Entry[] = [];
  for (const team of [...teams].sort((a, b) => a.id - b.id)) {
    const { wins, losses, ties, pointsFor, pointsAgainst } = team;
    const division = team.roster.settings?.division ?? 0;
    const games = (Math.min(through, end - 1) - start + 1) * (1 + median);
    if (wins === null || losses === null || ties === null || pointsFor === null || pointsAgainst === null ||
      ![wins, losses, ties].every(value => Number.isInteger(value) && value >= 0) || wins + losses + ties !== games) return null;
    entries.push({ id: team.id, record: 2 * wins + ties, pf: scoreCents(pointsFor), pa: scoreCents(pointsAgainst), division, samples: [] });
  }
  const groups = new Set(entries.map(entry => entry.division));
  if (groups.size > spots || (groups.size > 1 && groups.has(0)) || (divisions > 0 && groups.size !== divisions)) return null;

  const indices = new Map(entries.map((entry, i) => [entry.id, i]));
  if (indices.size !== entries.length) return null;
  const remaining: Model["weeks"] = [];
  for (const [offset, matchups] of weeks.entries()) {
    const week = start + offset;
    const games = seasonGames(league, null, week, matchups, new Set(indices.keys()));
    if (games.length * 2 !== entries.length || matchups.length !== entries.length) return null;
    games.sort((a, b) => a.id.localeCompare(b.id, "en"));
    if (week > through) {
      remaining.push(games.map(game => game.sides.map(id => indices.get(id)!).sort((a, b) => a - b) as [number, number]));
      continue;
    }
    for (const game of games) {
      if (!finalGame(game)) return null;
      game.sides.forEach((id, i) => entries[indices.get(id)!].samples.push(game.scores[i]));
    }
  }
  if (!entries.some(entry => entry.samples.some(score => score > 0))) return null;
  return { entries, spots, median: !!median, divisions: groups.size > 1, weeks: remaining };
}

export function scoringStats(samples: number[]) {
  const mean = samples.reduce((sum, score) => sum + score, 0) / samples.length;
  const deviation = Math.sqrt(samples.reduce((sum, score) => sum + (score - mean) ** 2, 0) / Math.max(1, samples.length - 1));
  return { mean, deviation };
}

export function randomGenerator(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6D2B79F5) | 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (((value ^ (value >>> 14)) >>> 0) + 0.5) / 4294967296;
  };
}

function certainty(entry: Entry, model: Model): "clinched" | "eliminated" | undefined {
  // Everyone plays the same number of games; a win counts twice as much as a tie.
  // Equal records are left unresolved because future points and tiebreakers can change.
  const swing = model.weeks.length * (model.median ? 4 : 2);
  const others = model.entries.filter(other => other !== entry);
  const canCatch = others.filter(other => other.record + swing >= entry.record);
  if (!model.divisions) {
    if (canCatch.length < model.spots) return "clinched";
    if (others.filter(other => other.record > entry.record + swing).length >= model.spots) return "eliminated";
  } else {
    const wildcards = model.spots - new Set(model.entries.map(other => other.division)).size;
    if (canCatch.every(other => other.division !== entry.division) || canCatch.length < wildcards) return "clinched";
    const alwaysAhead = others.filter(other => other.record > entry.record + swing);
    if (alwaysAhead.some(other => other.division === entry.division) && alwaysAhead.length >= model.spots) return "eliminated";
  }
}

export function simulatePlayoffOdds(model: Model, seed: number, observe?: (result: {
  ranked: number[]; seeds: number[]; pf: number[]; run: number;
}) => void): PlayoffOdds {
  const { entries, weeks, spots, median, divisions } = model;
  const leagueStats = scoringStats(entries.flatMap(entry => entry.samples));
  const profiles = entries.map(entry => entry.samples.length >= 3 ? scoringStats(entry.samples) : leagueStats);
  const random = randomGenerator(seed);
  const counts = entries.map(() => 0);
  const indices = entries.map((_, i) => i);

  for (let run = 0; run < simulationCount; run++) {
    const record = entries.map(entry => entry.record);
    const pf = entries.map(entry => entry.pf);
    const pa = entries.map(entry => entry.pa);
    for (const pairs of weeks) {
      const scores = profiles.map(({ mean, deviation }) => {
        const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
        return scoreCents(Math.max(0, mean + normal * deviation));
      });
      scores.forEach((score, i) => { pf[i] += score; });
      for (const [a, b] of pairs) {
        const outcome = Math.sign(scores[a] - scores[b]);
        record[a] += 1 + outcome;
        record[b] += 1 - outcome;
        pa[a] += scores[b];
        pa[b] += scores[a];
      }
      if (median) {
        const sorted = [...scores].sort((a, b) => a - b);
        const middle = (sorted[(scores.length - 1) >> 1] + sorted[scores.length >> 1]) / 2;
        scores.forEach((score, i) => { record[i] += 1 + Math.sign(score - middle); });
      }
    }
    const coin = indices.map(() => random());
    const ranked = [...indices].sort((a, b) => record[b] - record[a] || pf[b] - pf[a] || pa[b] - pa[a] || coin[b] - coin[a]);
    const qualifying = new Set<number>();
    if (divisions) {
      const won = new Set<number>();
      for (const i of ranked) {
        if (won.has(entries[i].division)) continue;
        won.add(entries[i].division);
        qualifying.add(i);
      }
    }
    for (const i of ranked) {
      if (qualifying.size === spots) break;
      qualifying.add(i);
    }
    for (const i of qualifying) counts[i]++;
    observe?.({ ranked, seeds: [...qualifying], pf, run });
  }

  if (counts.reduce((sum, count) => sum + count, 0) !== simulationCount * spots) throw new Error("Incorrect playoff spot total");
  return Object.fromEntries(entries.map((entry, i) => [
    entry.id, { percent: counts[i] * 100 / simulationCount, status: certainty(entry, model) },
  ]));
}

export function confirmedPlayoffOdds(teams: Team[], spots: number, participants: number[]): PlayoffOdds | null {
  const ids = new Set(teams.map(team => team.id));
  const qualified = new Set(participants);
  if (!Number.isInteger(spots) || spots < 1 || qualified.size !== spots || [...qualified].some(id => !ids.has(id))) return null;
  return Object.fromEntries(teams.map(({ id }) => [id, qualified.has(id)
    ? { percent: 100, status: "qualified" }
    : { percent: 0, status: "missed" }]));
}
