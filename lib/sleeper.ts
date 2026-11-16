import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import path from "node:path";
import { createSleeperClient, type ApiResult } from "./sleeper-cache";
import { availablePicks, currentWeek, makeTeams, numeric, recentTransactions } from "./sleeper-model";
import type { Draft, League, Matchup, NflState, Players, Roster, TradedPick, Transaction, User } from "./sleeper-types";

export const LEAGUE_ID = "1394584575056822272";
const client = createSleeperClient({ directory: path.join(process.cwd(), ".next", "cache", "sleeper") });
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const string = (v: unknown): v is string => typeof v === "string";
const number = (v: unknown): v is number => numeric(v) !== null;
const optional = (v: unknown, check: (v: unknown) => boolean) => v == null || check(v);
const strings = (v: unknown) => Array.isArray(v) && v.every(string);
const numbers = (v: unknown) => object(v) && Object.values(v).every(number);
const list = <T>(check: (v: unknown) => v is T) => (v: unknown): v is T[] => Array.isArray(v) && v.every(check);
const leagueCheck = (v: unknown): v is League => object(v) && string(v.league_id) && string(v.name) && string(v.season) && string(v.status) && v.sport === "nfl" && numbers(v.settings) && optional(v.previous_league_id, string) && optional(v.roster_positions, strings) && optional(v.scoring_settings, numbers);
const rosterCheck = (v: unknown): v is Roster => object(v) && number(v.roster_id) && optional(v.owner_id, string) && optional(v.co_owners, strings) && optional(v.settings, numbers) && [v.players,v.starters,v.reserve,v.taxi].every(value => optional(value, strings));
const userCheck = (v: unknown): v is User => object(v) && string(v.user_id) && optional(v.display_name, string) && optional(v.username, string) && optional(v.metadata, value => object(value) && optional(value.team_name, string));
const matchupCheck = (v: unknown): v is Matchup => object(v) && number(v.roster_id) && (v.matchup_id === null || number(v.matchup_id)) && optional(v.points, number) && optional(v.custom_points, number);
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
  return { league, teams, week, matchups, drafts, tradedPicks,
    picks: tradedPicks.data && drafts.data && rosters.data ? availablePicks(rosters.data, drafts.data, tradedPicks.data) : null,
    sources: [league, rosters, users, state, drafts, tradedPicks, ...(matchups ? [matchups] : [])],
  };
});
export type LeagueData = Awaited<ReturnType<typeof getLeagueData>>;
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
  let id: string | null = LEAGUE_ID;
  let warning: string | null = null;
  while (id && seasons.length < 20) {
    if (visited.has(id)) { warning = "Sleeper returned a repeated previous-league link. History stops here."; break; }
    visited.add(id);
    const data = await getLeagueData(id);
    seasons.push(data);
    if (!data.league.data) { warning = "An older season could not be loaded. Available seasons are shown below."; break; }
    id = data.league.data.previous_league_id ?? null;
  }
  if (id && seasons.length === 20) warning = "Showing the first 20 linked seasons.";
  return { seasons, warning };
});
