import { numeric } from "./sleeper-model";
import type { Matchup, Players, Roster } from "./sleeper-types";

export function lineupGroups(positions: string[], roster: Roster, matchup: Matchup | null,
  directory: Players | null, isCurrent: boolean, reportedPoints: boolean) {
  const starters = matchup?.starters ?? (isCurrent ? roster.starters : null);
  const activeSlots = positions.filter(position => !["BN", "IR", "TAXI"].includes(position));
  const row = (id: string | undefined, slot: string, index?: number) => {
    const playerId = id && id !== "0" ? id : null;
    const player = playerId ? directory?.[playerId] : undefined;
    const score = reportedPoints && playerId
      ? (index === undefined ? null : numeric(matchup?.starters_points?.[index])) ?? numeric(matchup?.players_points?.[playerId])
      : null;
    return { id: playerId, slot: slot.replace("SUPER_FLEX", "SUPERFLEX"), player, score };
  };
  const ids = matchup?.players ?? (isCurrent ? roster.players : null);
  const reserve = isCurrent ? roster.reserve : null;
  const taxi = isCurrent ? roster.taxi : null;
  const distinct = (items?: string[] | null) => [...new Set(items ?? [])].filter(id => id !== "0");
  const asRows = (items: string[]) => items.map(id => row(id, directory?.[id]?.position ?? "—"));
  return [
    { title: "Starting lineup", available: !!starters, rows: !starters ? [] :
      Array.from({ length: Math.max(starters.length, activeSlots.length) }, (_, i) => row(starters[i], activeSlots[i] ?? "—", i)) },
    { title: isCurrent ? "Bench" : "Bench and other non-starters", available: !!ids && !!starters, rows: ids && starters ?
      asRows(distinct(ids).filter(id => !starters.includes(id) && !reserve?.includes(id) && !taxi?.includes(id))) : [] },
    { title: "Injured Reserve", available: isCurrent, rows: asRows(distinct(reserve)) },
    { title: "Taxi Squad", available: isCurrent, rows: asRows(distinct(taxi)) },
  ];
}

export function playerHeadshot(id: string, position?: string) {
  if (/^\d+$/.test(id)) return `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
  if (/^[A-Z]{2,3}$/.test(id) && (position === "DEF" || !position)) return `https://sleepercdn.com/images/team_logos/nfl/${id.toLowerCase()}.png`;
  return null;
}
