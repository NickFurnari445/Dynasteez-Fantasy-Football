import { scoreCents, type Game } from "./league-results";
import { normalScore, pointSpreads } from "./odds-math";
import { offensiveProjection, type NflPlayerWeek } from "./nfl-week";
import { randomGenerator, scoringStats, simulationCount } from "./playoff-odds";

export function starterProjection(entry: NflPlayerWeek | undefined, position: string | undefined, rules: Record<string, number> | undefined) {
  const stats = entry?.stats;
  if (!stats || !rules || !Number.isFinite(stats.pts_ppr)) return null;
  if (stats.pts_ppr === 0 && !Object.entries(stats).some(([key, value]) => rules[key] && value)) return 0;
  if (position !== "K" && position !== "DEF") return offensiveProjection(position, entry, rules);
  const keys = Object.keys(rules).filter(key => rules[key] !== 0);
  const kick = /^(fgm|fgmiss|xpm|xpmiss)(_|$)/;
  const defense = /^(pts_allow|sack|int|fum_rec|ff|safe|blk_kick|def_|st_)/;
  if (position === "K") {
    if (!Number.isFinite(stats.fgm) || !Number.isFinite(stats.xpm)) return null;
    const long = stats.fgm_50p ?? 0;
    const split = (stats.fgm_50_59 ?? 0) + (stats.fgm_60p ?? 0);
    if (long && !split && rules.fgm_50_59 !== rules.fgm_60p) return null;
    const fieldGoals = (stats.fgm_0_19 ?? 0) + (stats.fgm_20_29 ?? 0) + (stats.fgm_30_39 ?? 0)
      + (stats.fgm_40_49 ?? 0) + (split || long);
    if (Math.abs(stats.fgm - fieldGoals) > 0.05 && keys.some(key => /^fgm_\d/.test(key))) return null;
    return keys.filter(key => kick.test(key)).reduce((sum, key) =>
      sum + rules[key] * (stats[key] ?? (key === "fgmiss" ? (stats.fga ?? stats.fgm) - stats.fgm :
        key === "fgm_50_59" && !split ? long : 0)), 0);
  }
  if (!Number.isFinite(stats.pts_allow) || !Object.keys(stats).some(key => /^pts_allow_/.test(key))) return null;
  return keys.filter(key => defense.test(key)).reduce((sum, key) => sum + rules[key] * (stats[key] ?? 0), 0);
}

export function lineupTotal(starters: string[] | null | undefined, slots: number, projections: Map<string, number>) {
  if (!slots || !starters || starters.length !== slots || starters.includes("0") || new Set(starters).size !== slots
    || starters.some(id => !projections.has(id))) return null;
  return starters.reduce((sum, id) => sum + projections.get(id)!, 0);
}

export type WeeklyProfile = { mean: number; deviation: number | null };
export type WeeklySide = { projected: number; spread: string; win: number | null; moneyline: number | null };
export type WeeklyLine = { rosterIds: [number, number]; sides: [WeeklySide, WeeklySide]; tie: number | null; decisions: number };
export type PlayerProfile = { id: string; mean: number; deviation: number };
export type WeeklyResult = {
  lines: Record<string, WeeklyLine>;
  specials: Record<string, Record<string, number>>;
};

export function historicalDeviation(team: number[], league: number[]) {
  const individual = team.length >= 3 ? scoringStats(team).deviation : 0;
  return individual || (league.length >= 3 ? scoringStats(league).deviation || null : null);
}

export function simulateWeekly(games: Game[], profiles: Record<number, WeeklyProfile>, record: number | null,
  players: PlayerProfile[] | null, allTeams: boolean, seed: number): WeeklyResult {
  const upcoming = games.filter(game => game.status === "upcoming" && game.sides.every(id => !!profiles[id]));
  const decisive = upcoming.filter(game => game.sides.every(id => profiles[id].deviation !== null));
  const teamIds = [...new Set(decisive.flatMap(game => game.sides))];
  const full = allTeams && games.length > 0 && decisive.length === games.length;
  const random = randomGenerator(seed);
  const playerRandom = randomGenerator(seed ^ 0x729a038b);
  const outcomes = decisive.map(() => [0, 0, 0]);
  const specials: WeeklyResult["specials"] = {};
  if (full) {
    const teamDistribution = () => Object.fromEntries(teamIds.map(id => [id, 0]));
    specials.high = teamDistribution();
    specials.low = teamDistribution();
    specials.margin = { ...teamDistribution(), tie: 0 };
    specials.close = Object.fromEntries(games.map(game => [game.id, 0]));
    if (record !== null) specials.record = { yes: 0, no: 0 };
  }
  if (players?.length) specials.starter = Object.fromEntries(players.map(player => [player.id, 0]));
  const split = (market: Record<string, number>, tied: (string | number)[]) => {
    for (const key of tied) market[key] += 1 / tied.length;
  };
  for (let run = 0; run < simulationCount; run++) {
    const scores = Object.fromEntries(teamIds.map(id => [id, scoreCents(normalScore(profiles[id].mean, profiles[id].deviation!, random))]));
    const differences = decisive.map((game, i) => {
      const delta = scores[game.sides[0]] - scores[game.sides[1]];
      outcomes[i][delta > 0 ? 0 : delta < 0 ? 1 : 2]++;
      return delta;
    });
    if (full) {
      const values = teamIds.map(id => scores[id]);
      const high = Math.max(...values);
      const low = Math.min(...values);
      split(specials.high, teamIds.filter(id => scores[id] === high));
      split(specials.low, teamIds.filter(id => scores[id] === low));
      const margins = differences.map(Math.abs);
      const large = Math.max(...margins);
      const small = Math.min(...margins);
      split(specials.close, games.filter((_, i) => margins[i] === small).map(game => game.id));
      split(specials.margin, large === 0 ? ["tie"] : games.flatMap((game, i) =>
        margins[i] === large ? [game.sides[differences[i] > 0 ? 0 : 1]] : []));
      if (record !== null) specials.record[high > scoreCents(record) ? "yes" : "no"]++;
    }
    if (players?.length) {
      const points = players.map(player => scoreCents(normalScore(player.mean, player.deviation, playerRandom)));
      const best = Math.max(...points);
      split(specials.starter, players.filter((_, i) => points[i] === best).map(player => player.id));
    }
  }
  const drawCounts = new Map(decisive.map((game, i) => [game.id, outcomes[i]]));
  const lines = Object.fromEntries(upcoming.map(game => {
    const projected = game.sides.map(id => profiles[id].mean);
    const spreads = pointSpreads(projected[0], projected[1]);
    const data = drawCounts.get(game.id);
    if (data && data[0] + data[1] + data[2] !== simulationCount) throw new Error("Weekly matchup probability mass mismatch");
    const decisions = data ? data[0] + data[1] : 0;
    const sides = game.sides.map((_, i) => ({ projected: projected[i], spread: spreads[i],
      win: data ? data[i] / simulationCount : null, moneyline: data && decisions ? data[i] / decisions : null,
    })) as WeeklyLine["sides"];
    return [game.id, { rosterIds: game.sides, sides, tie: data ? data[2] / simulationCount : null, decisions }];
  }));
  for (const market of Object.values(specials)) {
    if (Math.abs(Object.values(market).reduce((sum, p) => sum + p, 0) - simulationCount) > 1e-7)
      throw new Error("Weekly special probability mass mismatch");
    for (const key of Object.keys(market)) market[key] /= simulationCount;
  }
  return { lines, specials };
}
