import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import path from "node:path";
import { mkdir, readdir } from "node:fs/promises";
import { hash } from "node:crypto";
import { createSleeperClient, type ApiResult } from "./sleeper-cache";
import { availablePicks, currentWeek, makeTeams, matchupScore, numeric, recentTransactions } from "./sleeper-model";
import type { Draft, League, Matchup, NflState, Players, Roster, TradedPick, Transaction, User } from "./sleeper-types";
import { weekByeTeams, type NflGame, type NflPlayerWeek } from "./nfl-week";
import { bracketDecided, finalGame, lastScored, scoreCents, seasonGames, validWeek, type BracketGame } from "./league-results";
import { confirmedPlayoffOdds, preparePlayoffModel, simulatePlayoffOdds, type PlayoffOdds } from "./playoff-odds";
import { bracketOrder, playoffDimensions, simulateSeason, type Futures, type Postseason } from "./season-odds";

export const LEAGUE_ID = "1394584575056822272";
const cacheDirectory = path.join(process.cwd(), ".next", "cache", "sleeper");
const client = createSleeperClient({ directory: cacheDirectory });
const nflClient = createSleeperClient({ directory: path.join(cacheDirectory, "nfl"), baseUrl: "https://api.sleeper.app/" });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const number = (v: unknown): v is number => numeric(v) !== null;
const optional = (v: unknown, check: (v: unknown) => boolean) => v == null || check(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(string);
const numbers = (v: unknown) => object(v) && Object.values(v).every(number);
const list = <T>(check: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.every(check);
const leagueCheck = (v: unknown): v is League => object(v) && string(v.league_id) && string(v.name) && string(v.season) && string(v.status) && v.sport === "nfl" && numbers(v.settings) && optional(v.previous_league_id, string) && optional(v.roster_positions, strings) && optional(v.scoring_settings, numbers);
const rosterCheck = (v: unknown): v is Roster => object(v) && number(v.roster_id) && optional(v.owner_id, string) && optional(v.co_owners, strings) && optional(v.settings, numbers) && [v.players,v.starters,v.reserve,v.taxi].every(value => optional(value, strings));
const userCheck = (v: unknown): v is User => object(v) && string(v.user_id) && optional(v.display_name, string) && optional(v.username, string) && optional(v.avatar, string) && optional(v.metadata, value => object(value) && optional(value.team_name, string));
const matchupCheck = (v: unknown): v is Matchup => object(v) && number(v.roster_id) && (v.matchup_id === null || number(v.matchup_id)) && optional(v.points, number) && optional(v.custom_points, number) && optional(v.starters, strings) && optional(v.players, strings) && optional(v.players_points, numbers) && optional(v.starters_points, value => Array.isArray(value) && value.every(number));
const bracketCheck = (v: unknown): v is BracketGame => object(v) && number(v.r) && number(v.m) && [v.p, v.t1, v.t2, v.w, v.l].every(value => optional(value, number));
const stateCheck = (v: unknown): v is NflState => object(v) && string(v.season) && number(v.week) && optional(v.leg, number);
const pickCheck = (v: unknown): v is TradedPick => object(v) && string(v.season) && number(v.round) && number(v.roster_id) && number(v.owner_id);
const draftCheck = (v: unknown): v is Draft => object(v) && string(v.draft_id) && string(v.season) && string(v.status) && optional(v.type, string) && optional(v.start_time, number) && optional(v.settings, value => object(value) && optional(value.rounds, number));
const transactionCheck = (v: unknown): v is Transaction => object(v) && string(v.transaction_id) && string(v.type) && string(v.status) && optional(v.roster_ids, value => Array.isArray(value) && value.every(number)) && optional(v.created, number) && optional(v.status_updated, number) && optional(v.adds, numbers) && optional(v.drops, numbers) && optional(v.draft_picks, list(pickCheck)) && optional(v.settings, value => object(value) && optional(value.waiver_bid, number)) && optional(v.waiver_budget, value => Array.isArray(value) && value.every(item => object(item) && number(item.sender) && number(item.receiver) && number(item.amount)));
const playersCheck = (v: unknown): v is Players => object(v) && Object.keys(v).length > 0 && Object.values(v).every(p => object(p) && [p.full_name,p.first_name,p.last_name,p.team,p.position,p.injury_status].every(value => optional(value, string)));

export const getLeagueData = cache(async (id: string = LEAGUE_ID) => {
  await connection();
  if (!/^\d{15,22}$/.test(id)) throw new Error("Invalid league ID");
  const [league, rosters, users, state, drafts, tradedPicks] = await Promise.all([
    client.get(`league/${id}`, leagueCheck), client.get(`league/${id}/rosters`, list(rosterCheck)),
    client.get(`league/${id}/users`, list(userCheck)), client.get("state/nfl", stateCheck),
    client.get(`league/${id}/drafts`, list(draftCheck), 300), client.get(`league/${id}/traded_picks`, list(pickCheck), 300),
  ]);
  const teams = makeTeams(rosters.data ?? [], users.data ?? []);
  const week = league.data ? currentWeek(league.data, state.data) : null;
  const matchups = week !== null ? await client.get(`league/${id}/matchups/${week}`, list(matchupCheck)) : null;
  const uncertain = new Set((await Promise.all((rosters.data ?? []).map(async roster =>
    await observedChange(id, roster) ? roster.roster_id : null))).filter(value => value !== null));
  return { league, teams, users, state, rosters, uncertain, week, matchups, drafts, tradedPicks,
    picks: tradedPicks.data && drafts.data && rosters.data ? availablePicks(rosters.data, drafts.data, tradedPicks.data) : null,
    sources: [league, rosters, users, state, drafts, tradedPicks, ...(matchups ? [matchups] : [])],
  };
});
export type LeagueData = Awaited<ReturnType<typeof getLeagueData>>;
const scheduleCheck = (v: unknown): v is NflGame => object(v) && [v.game_id, v.status, v.home, v.away, v.date].every(string) && validWeek(v.week);
const playerWeekCheck = (v: unknown): v is NflPlayerWeek => object(v) && string(v.player_id) &&
  [v.game_id, v.team, v.opponent].every(value => optional(value, string)) && numbers(v.stats) &&
  optional(v.player, player => object(player) && [player.position, player.injury_status].every(value => optional(value, string)));
export const getNflWeek = cache(async (season: string, week: number, historical: boolean) => {
  await connection();
  if (!/^\d{4}$/.test(season) || !validWeek(week)) return null;
  const [schedule, projections, stats] = await Promise.all([
    nflClient.get(`schedule/nfl/regular/${season}`, list(scheduleCheck)),
    nflClient.get(`projections/nfl/${season}/${week}?season_type=regular`, list(playerWeekCheck), historical ? 3600 : 300),
    historical ? nflClient.get(`stats/nfl/${season}/${week}?season_type=regular`, list(playerWeekCheck), 3600) : null,
  ]);
  const games = (schedule.data ?? []).filter(game => game.week === week);
  return { games, byeTeams: weekByeTeams(schedule.data ?? [], week, season),
    projections: projections.data ?? [], stats: stats?.data ?? [], sources: [schedule, projections, ...(stats ? [stats] : [])] };
});

export const getWeeklyMatchups = cache(async (id: string, week: number) => {
  await connection();
  return client.get(`league/${id}/matchups/${week}`, list(matchupCheck));
});
export const getPlayers = cache(async () => {
  await connection();
  return client.get("players/nfl", playersCheck, 86400);
});
export const getTransactions = cache(async (id: string, week: number | null) => {
  await connection();
  if (week === null) return { transactions: [], sources: [], throughWeek: null };
  const sources: ApiResult<Transaction[]>[] = [];
  // Include the offseason (week 0), with a bounded batch size and per-week caching.
  for (let start = 0; start <= week; start += 5) {
    sources.push(...await Promise.all(Array.from({ length: Math.min(5, week - start + 1) }, (_, offset) => client.get(`league/${id}/transactions/${start + offset}`, list(transactionCheck), 300))));
  }
  return { transactions: recentTransactions(sources.flatMap(source => source.data ?? [])), sources, throughWeek: week };
});
export const getHistory = cache(async () => {
  await connection();
  const seasons: LeagueData[] = [];
  const visited = new Set<string>();
  const root = await getLeagueData();
  let id: string | null = await renewedLeague(root) ?? LEAGUE_ID;
  let warning: string | null = null;
  while (id && seasons.length < 20) {
    if (visited.has(id)) { warning = "Sleeper returned a repeated previous-league link. History stops here."; break; }
    visited.add(id);
    const data = await getLeagueData(id);
    seasons.push(data);
    if (!data.league.data) { warning = "An older season could not be loaded. Available seasons are shown below."; break; }
    id = id === LEAGUE_ID ? null : data.league.data.previous_league_id ?? null;
  }
  if (id && seasons.length === 20) warning = "Showing the first 20 linked seasons.";
  return { seasons, warning };
});

// Discover renewals through current members, then require an unbroken link to Dynasteez.
async function renewedLeague(root: LeagueData) {
  const original = root.league.data;
  // Sleeper can publish its next league season before the NFL season changes.
  const year = Number(root.state.data?.league_season ?? root.state.data?.season);
  if (!original || !root.users.data?.length || !Number.isInteger(year) || year <= Number(original.season)) return original?.league_id;
  const memberIds = [...new Set(root.teams.map(team => team.roster.owner_id))]
    .filter((id): id is string => !!id && /^\d+$/.test(id));
  for (const season of [year, year - 1].filter(value => value > Number(original.season))) {
    const sources = await Promise.all(memberIds.map(id => client.get(`user/${id}/leagues/nfl/${season}`, list(leagueCheck), 21600)));
    const candidates = new Map(sources.flatMap(source => source.data ?? [])
      .filter(league => Number(league.season) === season).map(league => [league.league_id, league]));
    const linked: string[] = [];
    for (const candidate of candidates.values()) {
      let league: League | null = candidate;
      for (let depth = 0; league && depth < 20; depth++) {
        const previous = league.previous_league_id;
        if (previous === original.league_id) { linked.push(candidate.league_id); break; }
        if (!previous || !/^\d{15,22}$/.test(previous)) break;
        const parent: ApiResult<League> = await client.get(`league/${previous}`, leagueCheck, 21600);
        if (parent.data && Number(parent.data.season) >= Number(league.season)) break;
        league = parent.data;
      }
    }
    if (linked.length === 1) return linked[0];
    if (linked.length > 1) return original.league_id;
  }
  return original.league_id;
}

export const getCurrentLeagueData = cache(async () => {
  const root = await getLeagueData();
  const id = await renewedLeague(root);
  return id && id !== LEAGUE_ID ? getLeagueData(id) : root;
});

const oddsSnapshots = new Map<string, { key: string; result: { playoffOdds: PlayoffOdds; futures: Futures | null } }>();

export const oddsModelVersion = "1";
export const getCurrentSeasonOdds = cache(async () => {
  const data = await getCurrentLeagueData();
  const league = data.league.data;
  if (!league || data.league.error || data.rosters.error || data.state.error || data.state.data?.season !== league.season ||
    !["in_season", "complete"].includes(league.status) ||
    data.teams.length !== (league.total_rosters ?? league.settings.num_teams)) return null;

  const { start_week: start = 1, playoff_week_start: end, playoff_teams: spots } = league.settings;
  if (!validWeek(start) || !validWeek(end) || end <= start) return null;
  const id = league.league_id;
  const through = lastScored(league);
  let confirmed: PlayoffOdds | null = null;
  let official: BracketGame[] = [];
  if (through >= end - 1 || league.status === "complete") {
    const bracket = await client.get(`league/${id}/winners_bracket`, list(bracketCheck));
    if (bracket.error || !bracket.data) return null;
    const participants = bracket.data.flatMap(game => [game.t1, game.t2, game.w, game.l]
      .filter((roster): roster is number => typeof roster === "number" && roster > 0));
    confirmed = confirmedPlayoffOdds(data.teams, spots, participants);
    official = bracket.data;
  }
  if (through < start) return null;

  const weeks: Matchup[][] = [];
  for (let week = start; week < end; week += 6) {
    const batch = await Promise.all(Array.from({ length: Math.min(6, end - week) }, (_, offset) =>
      client.get(`league/${id}/matchups/${week + offset}`, list(matchupCheck))));
    for (const source of batch) {
      if (source.error || !source.data) return confirmed ? { playoffOdds: confirmed, futures: null } : null;
      weeks.push(source.data);
    }
  }
  const model = preparePlayoffModel(league, data.teams, weeks);
  if (!model) return confirmed ? { playoffOdds: confirmed, futures: null } : null;
  const key = hash("sha256", JSON.stringify([id, league.season, model]));
  const { rounds } = playoffDimensions(spots);
  const settings = league.settings;
  const ranked = [...model.entries].sort((a, b) => b.record - a.record || b.pf - a.pf || b.pa - a.pa);
  const seeds = ranked.slice(0, spots).map(entry => entry.id);
  const slots = bracketOrder(2 ** rounds).map(position => seeds[position] ?? null);
  const opening = official.filter(game => game.r === 1 && game.p == null && game.t1 && game.t2);
  const matchesOpening = opening.every(game => slots.some((team, i) =>
    i % 2 === 0 && team !== null && slots[i + 1] !== null
    && [game.t1, game.t2].includes(team) && [game.t1, game.t2].includes(slots[i + 1])));
  // Public bracket membership is authoritative. If manual seeding changes membership,
  // retain verified qualification and withhold markets that require an exact seed order.
  if (through >= end - 1 && (!confirmed || !seeds.every(seed => confirmed![seed]?.percent === 100) || model.divisions || !matchesOpening
    || ranked.some((entry, i) => i > 0 && entry.record === ranked[i - 1].record
      && entry.pf === ranked[i - 1].pf && entry.pa === ranked[i - 1].pa))) {
    return confirmed ? { playoffOdds: confirmed, futures: null } : null;
  }
  const actual: Postseason["actual"] = {};
  const customWeeks: number[] = [];
  if (confirmed && validWeek(data.week) && data.week >= end) {
    const postseasonEnd = Math.min(18, Math.max(through, end + rounds - 1));
    const sources = await Promise.all(Array.from({ length: postseasonEnd - end + 1 }, (_, i) => getWeeklyMatchups(id, end + i)));
    for (const [i, source] of sources.entries()) {
      const week = end + i;
      if (source.error || !source.data) {
        if (week <= through) return { playoffOdds: confirmed, futures: null };
        continue;
      }
      if (week <= through) actual[week] = Object.fromEntries(source.data.flatMap(row => {
        const points = matchupScore(row);
        return points === null ? [] : [[row.roster_id, scoreCents(points)]];
      }));
      const pairs = seasonGames(league, data.state.data, week, source.data, new Set(ranked.map(entry => entry.id)));
      if (ranked.length === 10 && [[6, 7], [8, 9]].every(([a, b]) => pairs.some(game =>
        (week > through || finalGame(game)) && game.sides.includes(ranked[a].id) && game.sides.includes(ranked[b].id)))) customWeeks.push(week);
    }
  }
  const postseason: Postseason | null = settings.playoff_round_type === 0 && [0, 1].includes(settings.playoff_seed_type) &&
    !model.divisions && rounds > 0 && end + rounds - 1 <= 18 ? {
      start: end, through, lengths: Array<number>(rounds).fill(1), reseed: settings.playoff_seed_type === 1,
      bracket: official, fixedSeeds: confirmed ? seeds : undefined, actual, custom: true,
      customWeeks: customWeeks.length === 2 && customWeeks[1] === customWeeks[0] + 1 ? customWeeks : null,
    } : null;
  const versioned = hash("sha256", JSON.stringify([oddsModelVersion, key, postseason]));
  const previous = oddsSnapshots.get(id);
  if (previous?.key === versioned) return previous.result;
  const seed = Number.parseInt(key.slice(0, 8), 16);
  let result: { playoffOdds: PlayoffOdds; futures: Futures | null };
  try {
    result = simulateSeason(model, seed, postseason);
  } catch (error) {
    console.warn("[Odds Center] Expanded simulation unavailable", error);
    result = { playoffOdds: confirmed ?? simulatePlayoffOdds(model, seed), futures: null };
  }
  if (confirmed) result.playoffOdds = confirmed;
  if (oddsSnapshots.size >= 4) oddsSnapshots.clear();
  oddsSnapshots.set(id, { key: versioned, result });
  return result;
});

export const getCurrentPlayoffOdds = cache(async (): Promise<PlayoffOdds | null> =>
  (await getCurrentSeasonOdds())?.playoffOdds ?? null);

// Matchups identify roster slots, not owners. Withhold attribution for any slot
// whose primary ownership changed while this installation was observing it.
const ownershipObservations = new Map<string, Set<string>>();
async function observedChange(id: string, roster: Roster) {
  const key = `${id}/${roster.roster_id}`;
  const marker = hash("sha256", roster.owner_id || "vacant");
  const observed = ownershipObservations.get(key) ?? new Set<string>();
  ownershipObservations.set(key, observed);
  observed.add(marker);
  const directory = path.join(cacheDirectory, "ownership", key);
  try {
    await mkdir(path.join(directory, marker), { recursive: true });
    for (const file of await readdir(directory)) observed.add(file);
  } catch { /* Process-local observations remain available. */ }
  return observed.size > 1;
}

async function loadSeasonResults(data: LeagueData, league: League) {
  const id = league.league_id;
  const through = lastScored(league);
  const start = validWeek(league.settings.start_week) ? league.settings.start_week : 1;
  const end = league.status === "complete" ? through : 18;
  const weekNumbers = Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
  const bracket = await client.get(`league/${id}/winners_bracket`, list(bracketCheck), league.status === "complete" ? 900 : 60);
  const results: ApiResult<Matchup[]>[] = [];
  for (let i = 0; i < weekNumbers.length; i += 6) {
    results.push(...await Promise.all(weekNumbers.slice(i, i + 6).map(week =>
      client.get(`league/${id}/matchups/${week}`, list(matchupCheck), week < through || league.status === "complete" ? 900 : 60))));
  }
  const rosterIds = new Set(data.teams.map(team => team.id));
  const weeks = results.map((source, index) => ({
    week: weekNumbers[index], source,
    games: seasonGames(league, data.state.data, weekNumbers[index], source.data ?? [], rosterIds),
  }));
  const final = weeks.flatMap(week => week.games).filter(finalGame);
  const regular = final.filter(game => game.phase === "regular");
  const playoffStart = league.settings.playoff_week_start;
  const playoffStarted = validWeek(playoffStart) && through >= playoffStart;
  const decided = (bracket.data ?? []).filter(game => bracketDecided(game) && rosterIds.has(game.w!) && rosterIds.has(game.l!));
  const playoff = playoffStarted ? decided.filter(game => game.p == null || game.p === 1) : [];
  const qualifierIds = new Set(playoffStarted ? decided.flatMap(game => [game.w!, game.l!]) : []);
  return {
    data, league, weeks, final, regular, bracket: bracket.data ?? [], playoff, qualifierIds, uncertain: data.uncertain,
    sources: [...data.sources, bracket, ...results],
  };
}
export type SeasonResults = Awaited<ReturnType<typeof loadSeasonResults>>;

export const getLeagueResults = cache(async () => {
  const root = await getLeagueData();
  const latest = await renewedLeague(root);
  const seasons: SeasonResults[] = [];
  const ids = new Set<string>();
  let id = latest;
  let year = Infinity;
  let warning = root.league.data ? null : "Sleeper league data is temporarily unavailable.";
  while (id && ids.size < 20) {
    if (!/^\d{15,22}$/.test(id) || ids.has(id)) { warning = "A Sleeper season link could not be verified."; break; }
    ids.add(id);
    const data = await getLeagueData(id);
    const league = data.league.data;
    if (!league || league.league_id !== id || !(Number(league.season) < year)) {
      warning = "A Sleeper season could not be loaded or verified.";
      break;
    }
    seasons.push(await loadSeasonResults(data, league));
    if (id === LEAGUE_ID) break; // The configured league is the inaugural season.
    year = Number(league.season);
    id = league.previous_league_id ?? undefined;
  }
  return { seasons, warning };
});
