import "server-only";
import { cache } from "react";
import { hash } from "node:crypto";
import { getCurrentLeagueData, getCurrentSeasonOdds, getLeagueResults, getNflWeek, getWeeklyMatchups, oddsModelVersion } from "./sleeper";
import { lastScored, seasonGames, validWeek } from "./league-results";
import { nflGameStatus } from "./nfl-week";
import { snapshotStore } from "./odds-history";
import { scoringStats } from "./playoff-odds";
import { historicalDeviation, lineupTotal, simulateWeekly, starterProjection, type PlayerProfile, type WeeklyProfile } from "./weekly-odds";

const history = snapshotStore(process.env.ODDS_HISTORY_DIRECTORY);
const weeklyCache = new Map<string, ReturnType<typeof simulateWeekly>>();

export const getFuturesView = cache(async () => {
  const data = await getCurrentLeagueData();
  const league = data.league.data;
  const result = await getCurrentSeasonOdds();
  let snapshots: Awaited<ReturnType<typeof history.list>> = [];
  let storageAvailable = history.enabled;
  if (league && storageAvailable) {
    try {
      const week = lastScored(league);
      snapshots = await history.list(league.league_id, league.season, oddsModelVersion);
      if (result?.futures && validWeek(week) && !snapshots.some(snapshot => snapshot.week === week)) {
        await history.save({ league: league.league_id, season: league.season, week, version: oddsModelVersion,
          at: new Date().toISOString(), futures: result.futures });
        snapshots = await history.list(league.league_id, league.season, oddsModelVersion);
      }
    } catch (error) {
      storageAvailable = false;
      console.warn("[Odds Center] Snapshot storage unavailable", error);
    }
  }
  return { data, futures: result?.futures ?? null, playoffOdds: result?.playoffOdds ?? null, snapshots, storageAvailable };
});

export const getWeeklyView = cache(async (requested?: number) => {
  const data = await getCurrentLeagueData();
  const league = data.league.data;
  const state = data.state.error ? null : data.state.data;
  const nflWeek = state?.season === league?.season && state?.season_type === "regular" && validWeek(state.week) ? state.week : null;
  const regularEnd = validWeek(league?.settings.playoff_week_start) && league?.status === "in_season"
    ? league.settings.playoff_week_start - 1 : 0;
  const maximum = Math.min(18, Math.max(data.week ?? 0, league ? lastScored(league) : 0, regularEnd,
    league?.status === "in_season" ? nflWeek ?? 0 : 0));
  const minimum = league && validWeek(league.settings.start_week) ? league.settings.start_week : 1;
  const weeks = Array.from({ length: Math.max(0, maximum - minimum + 1) }, (_, i) => minimum + i);
  const week = validWeek(requested) && weeks.includes(requested) ? requested : data.week;
  const base = { data, weeks, week, record: null as number | null, result: null as ReturnType<typeof simulateWeekly> | null,
    names: {} as Record<string, string>, archived: null as Awaited<ReturnType<typeof history.getPregame>> };
  if (!league || week === null || !weeks.includes(week)) return { ...base, games: [] };
  const source = await getWeeklyMatchups(league.league_id, week);
  let games = seasonGames(league, data.state.data, week, source.data ?? [], new Set(data.teams.map(team => team.id)));
  const through = lastScored(league);
  if (history.enabled) {
    base.archived = await history.getPregame(league.league_id, league.season, oddsModelVersion, week).catch(error => {
      console.warn("[Odds Center] Pregame archive unavailable", error);
      return null;
    });
  }
  if (week <= through || (week !== data.week && week !== nflWeek) || league.status !== "in_season"
    || !games.length || data.league.error || source.error)
    return { ...base, games };

  const [nfl, historyData] = await Promise.all([getNflWeek(league.season, week, false), getLeagueResults()]);
  const season = historyData.seasons.find(item => item.league.league_id === league.league_id);
  const final = historyData.seasons.flatMap(item => item.final);
  const record = final.length ? Math.max(...final.flatMap(game => game.scores)) : null;
  // The schedule feed only publishes a calendar date. Stop issuing pregame projections
  // at the start of the first game date if a verified kickoff time is unavailable.
  const earliest = nfl?.games.map(game => Date.parse(game.date));
  const allPregame = nfl && !nfl.sources.some(item => item.error) && earliest?.length
    && earliest.every(date => Number.isFinite(date) && date > Date.now())
    && nfl.games.every(game => nflGameStatus(game.status) === "Upcoming");
  if (!allPregame || !nfl) {
    const statuses = nfl && !nfl.sources[0].error ? nfl.games.map(game => nflGameStatus(game.status)) : [];
    if (statuses.length && statuses.every(status => status === "Final")) {
      games = games.map(game => ({ ...game, status: "pending" }));
    } else if (statuses.some(status => status === "Live" || status === "Final")) {
      games = games.map(game => ({ ...game, status: "live" }));
    }
    return { ...base, games, record };
  }

  const projections = new Map<string, number>();
  const positions = new Map<string, string>();
  const names: Record<string, string> = {};
  for (const entry of nfl.projections) {
    const score = starterProjection(entry, entry.player?.position, league.scoring_settings);
    if (score !== null) projections.set(entry.player_id, score);
    if (entry.player?.position) positions.set(entry.player_id, entry.player.position);
    names[entry.player_id] = [entry.player?.first_name, entry.player?.last_name].filter(Boolean).join(" ") || entry.player_id;
  }
  const slots = league.roster_positions?.filter(position => !["BN", "IR", "TAXI"].includes(position)).length ?? 0;
  const samples: Record<number, number[]> = {};
  const playerScores = new Map<string, number[]>();
  for (const game of season?.regular ?? []) {
    if (game.week >= week) continue;
    game.sides.forEach((id, i) => { (samples[id] ??= []).push(game.scores[i]); });
  }
  for (const prior of season?.weeks ?? []) {
    if (prior.week >= week || prior.week > through || prior.source.error) continue;
    for (const row of prior.source.data ?? []) {
      row.starters?.forEach((id, index) => {
        const score = row.starters_points?.[index] ?? row.players_points?.[id];
        if (id !== "0" && typeof score === "number" && Number.isFinite(score)) {
          const list = playerScores.get(id) ?? [];
          list.push(score);
          playerScores.set(id, list);
        }
      });
    }
  }
  const profiles: Record<number, WeeklyProfile> = {};
  const allScores = Object.values(samples).flat();
  const scheduled = new Set(games.flatMap(game => game.sides));
  const starters: string[] = [];
  for (const row of source.data ?? []) {
    if (!scheduled.has(row.roster_id)) continue;
    const total = lineupTotal(row.starters, slots, projections);
    if (total !== null) {
      profiles[row.roster_id] = { mean: total, deviation: historicalDeviation(samples[row.roster_id] ?? [], allScores) };
      starters.push(...row.starters!);
    }
  }
  const allTeams = scheduled.size === data.teams.length;
  const playerProfiles: PlayerProfile[] = [];
  if (allTeams && starters.length === slots * data.teams.length && new Set(starters).size === starters.length) {
    const withinPosition = new Map<string, { sumSquares: number; degrees: number }>();
    for (const [id, scores] of playerScores) {
      const position = positions.get(id);
      if (scores.length < 3 || !position) continue;
      const degree = scores.length - 1;
      const group = withinPosition.get(position) ?? { sumSquares: 0, degrees: 0 };
      group.sumSquares += scoringStats(scores).deviation ** 2 * degree;
      group.degrees += degree;
      withinPosition.set(position, group);
    }
    for (const id of starters) {
      const scores = playerScores.get(id) ?? [];
      const position = positions.get(id);
      const own = historicalDeviation(scores, []);
      const group = position ? withinPosition.get(position) : undefined;
      const priorWeight = 3;
      const deviation = own !== null && group && group.degrees - (scores.length - 1) >= 8
        ? Math.sqrt((own ** 2 * (scores.length - 1) + priorWeight * group.sumSquares / group.degrees) / (scores.length - 1 + priorWeight))
        : own;
      if (deviation !== null) playerProfiles.push({ id, mean: projections.get(id)!, deviation });
    }
  }
  const players = playerProfiles.length && playerProfiles.length === starters.length ? playerProfiles : null;
  const key = hash("sha256", JSON.stringify([oddsModelVersion, league.league_id, week,
    games.map(({ id, sides, status }) => [id, sides, status]), profiles, record, players, allTeams]));
  let result = weeklyCache.get(key);
  if (!result) {
    result = simulateWeekly(games, profiles, record, players, allTeams, Number.parseInt(key.slice(0, 8), 16));
    if (weeklyCache.size >= 8) weeklyCache.clear();
    weeklyCache.set(key, result);
  }
  if (history.enabled && !base.archived && Object.keys(result.lines).length && earliest.every(date => date > Date.now())) {
    await history.savePregame({ league: league.league_id, season: league.season, week, version: oddsModelVersion,
      at: new Date().toISOString(), lines: result.lines }).catch(error => {
      console.warn("[Odds Center] Pregame snapshot unavailable", error);
    });
  }
  return { ...base, games, record, result, names };
});
