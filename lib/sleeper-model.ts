import { managerIdentity, teamAvatars } from "./league-identity";
import type { AvailablePick, Draft, League, Matchup, NflState, Player, Roster, Team, TradedPick, Transaction, User } from "./sleeper-types";

export const numeric = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
export const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
export const points = (value: number | null | undefined) => numeric(value)?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—";
export function totalPoints(settings: Record<string, number> | undefined, field: string) {
  const whole = numeric(settings?.[field]);
  const fraction = numeric(settings?.[`${field}_decimal`]);
  // Sleeper uses integer hundredths. A missing fractional component is not a known zero.
  return whole === null || fraction === null ? null : whole + fraction / 100;
}
export function makeTeams(rosters: Roster[], users: User[]): Team[] {
  return rosters.map(roster => {
    const user = users.find(user => user.user_id === roster.owner_id);
    const { name: manager, username } = managerIdentity(user, roster.owner_id ?? undefined);
    return { id: roster.roster_id, name: text(user?.metadata?.team_name) ?? text(user?.display_name) ?? text(user?.username) ?? `Roster #${roster.roster_id} (name unavailable)`, manager, username, avatars: teamAvatars(roster, user),
      coManagers: (roster.co_owners ?? []).map(id => { const co = users.find(user => user.user_id === id); return managerIdentity(co, id).name ?? `User ${id} (name unavailable)`; }),
      roster, wins: numeric(roster.settings?.wins), losses: numeric(roster.settings?.losses), ties: numeric(roster.settings?.ties),
      pointsFor: totalPoints(roster.settings, "fpts"), pointsAgainst: totalPoints(roster.settings, "fpts_against") };
  }).sort((a, b) => {
    const pct = (t: Team) => t.wins === null || t.losses === null || t.ties === null ? -1 : (t.wins + t.losses + t.ties ? (t.wins + t.ties / 2) / (t.wins + t.losses + t.ties) : 0);
    return pct(b) - pct(a) || (b.pointsFor ?? -Infinity) - (a.pointsFor ?? -Infinity) || a.id - b.id;
  });
}
export function currentWeek(league: League, state: NflState | null): number | null {
  const leg = numeric(league.settings.leg);
  if (leg !== null && Number.isInteger(leg) && leg >= 1 && leg <= 18) return leg;
  if (state?.season === league.season && state.season_type === "regular") {
    const week = numeric(state.leg) ?? numeric(state.week);
    if (week !== null && Number.isInteger(week) && week >= 1 && week <= 18) return week;
  }
  return null;
}
export function groupMatchups(matchups: Matchup[]) {
  const groups = new Map<string, Matchup[]>();
  for (const matchup of matchups) {
    const key = matchup.matchup_id === null ? `bye-${matchup.roster_id}` : `match-${matchup.matchup_id}`;
    groups.set(key, [...(groups.get(key) ?? []), matchup]);
  }
  return [...groups.entries()];
}
export const matchupScore = (matchup: Matchup) => numeric(matchup.custom_points) ?? numeric(matchup.points);
export const playerName = (player: Player | undefined, id: string) => text(player?.full_name) ?? text([player?.first_name, player?.last_name].filter(Boolean).join(" ")) ?? `Player ${id} (name unavailable)`;

export function recentTransactions(transactions: Transaction[]) {
  const unique = new Map(transactions.filter(t => t.status === "complete" && ["trade", "waiver", "free_agent"].includes(t.type)).map(t => [t.transaction_id, t]));
  return [...unique.values()].sort((a,b) => (b.status_updated ?? b.created ?? 0) - (a.status_updated ?? a.created ?? 0)).slice(0,15);
}

export function availablePicks(rosters: Roster[], drafts: Draft[], traded: TradedPick[]): AvailablePick[] {
  const result = new Map<string, AvailablePick>();
  // Only materialize untraded picks for a draft whose season and rounds Sleeper explicitly supplies.
  // A completed startup draft is never used to guess the next rookie draft's round count or horizon.
  for (const draft of drafts.filter(d => d.status === "pre_draft")) {
    const rounds = numeric(draft.settings?.rounds);
    if (rounds === null || !Number.isInteger(rounds) || rounds < 1 || rounds > 50) continue;
    for (const roster of rosters) for (let round = 1; round <= rounds; round++) {
      const key = `${draft.season}:${round}:${roster.roster_id}`;
      result.set(key, { season: draft.season, round, originalRosterId: roster.roster_id, ownerId: roster.roster_id, source: "scheduled" });
    }
  }
  for (const pick of traded) {
    if (drafts.some(d => d.season === pick.season && d.status !== "pre_draft")) continue;
    const key = `${pick.season}:${pick.round}:${pick.roster_id}`;
    result.set(key, { season: pick.season, round: pick.round, originalRosterId: pick.roster_id, ownerId: pick.owner_id, source: "reported trade" });
  }
  return [...result.values()].sort((a,b) => a.season.localeCompare(b.season) || a.round - b.round || a.originalRosterId - b.originalRosterId);
}
