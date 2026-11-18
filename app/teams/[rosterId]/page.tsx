import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getCurrentLeagueData, getPlayers, getWeeklyMatchups, getNflWeek } from "@/lib/sleeper";
import { matchupScore, playerName, points } from "@/lib/sleeper-model";
import { DataStatus, Empty, LoadingLeague, TeamLink } from "@/app/components/league-views";

import { TeamSwitcher } from "@/app/components/team-switcher";
import { Avatar } from "@/app/components/avatar";
import { lastScored, validWeek } from "@/lib/league-results";
import { nflGameStatus, offensiveProjection } from "@/lib/nfl-week";
import { lineupGroups, playerHeadshot } from "@/lib/weekly-lineup";

export const metadata = { title: "Team roster" };
type Props = { params: Promise<{rosterId:string}>; searchParams: Promise<Record<string, string | string[] | undefined>> };
async function TeamPageContent({ params, searchParams }: Props) {
  const [{ rosterId }, query] = await Promise.all([params, searchParams]);
  if (!/^\d+$/.test(rosterId)) notFound();
  const [data, players] = await Promise.all([getCurrentLeagueData(), getPlayers()]);
  const team = data.teams.find(t=>t.id===Number(rosterId));
  if (!team && data.teams.length) notFound();
  if (!team) return <div className="section-page"><Link className="back-link" href="/teams">← All teams</Link><h1>Team unavailable</h1><DataStatus sources={data.sources}/><Empty>This roster cannot be loaded right now. Please try again shortly.</Empty></div>;
  const league = data.league.data;
  const picks = data.picks?.filter(pick => pick.ownerId === team.id);
  const state = data.state.data;
  const active = league?.status === "in_season" && state?.season === league.season && state.season_type === "regular" && validWeek(state.week)
    ? state.week : null;
  const through = league ? lastScored(league) : 0;
  const latest = Math.max(through, data.week ?? 0, active ?? 0);
  const first = validWeek(league?.settings.start_week) ? league.settings.start_week : 1;
  const weeks = Array.from({ length: Math.max(0, latest - first + 1) }, (_, i) => first + i);
  const week = weeks.find(item => String(item) === query.week) ?? weeks.at(-1);
  const [source, nfl] = league && week !== undefined
    ? await Promise.all([getWeeklyMatchups(league.league_id, week), getNflWeek(league.season, week, week <= through)])
    : [null, null];
  const playerWeeks = new Map(nfl?.players.map(entry => [entry.player_id, entry]));
  const matchup = source?.data?.find(row => row.roster_id === team.id) ?? null;
  const isCurrent = week === undefined || (league?.status === "in_season" && week === latest) || league?.status === "pre_draft";
  const isFinal = week !== undefined && week <= through && matchup !== null;
  const liveScore = week === active && matchup && (matchupScore(matchup) !== null && matchupScore(matchup) !== 0 ||
    matchup.starters_points?.some(value => value !== 0) || nfl?.games.some(game => ["Live", "Final"].includes(nflGameStatus(game.status) ?? "")));
  const hasScore = !!(isFinal || liveScore);
  const sources = [...data.sources, players, ...(source ? [source] : []), ...(nfl?.sources ?? [])];
  const degraded = sources.some(item => item.error);
  const groups = lineupGroups(league?.roster_positions ?? [], team.roster, matchup, players.data, isCurrent, hasScore);
  return <div className="section-page roster-page">
    <Link className="back-link" href="/teams">← All teams</Link>
    <div className="roster-identity"><Avatar sources={team.avatars} size={72}/>
      <div><p className="eyebrow">{league?.season ?? "Season unavailable"} · Dynasteez</p><h1>{team.name}</h1>
        <p>{team.manager ?? "Manager unavailable"}{team.coManagers.length ? ` · Co-managers: ${team.coManagers.join(", ")}` : ""}</p></div>
    </div>
    {degraded && <DataStatus sources={sources}/>}
    <div className="team-stats"><span><b>{[team.wins, team.losses, team.ties].map(value => value ?? "—").join("–")}</b>W–L–T</span>
      <span><b>{points(team.pointsFor)}</b>Points for</span><span><b>{points(team.pointsAgainst)}</b>Points against</span></div>
    <form className="filters roster-toolbar" action={`/teams/${team.id}`}>
      <TeamSwitcher teams={data.teams.map(({ id, name }) => ({ id, name }))} current={team.id} week={week}/>
      {!!weeks.length && <>
        <label>Lineup week<select name="week" defaultValue={String(week)}>{weeks.map(item =>
          <option key={item} value={item}>Week {item}</option>)}</select></label>
        <button className="button primary" type="submit">Show lineup</button>
      </>}
    </form>
    <section className="panel lineup-panel" aria-label="Player roster">
      <div className="panel-heading"><div><p className="eyebrow">{week ? `Week ${week}` : "Current roster"}</p><h2>Player roster</h2></div>
        {hasScore && matchup && <div className="lineup-total"><strong>{points(matchupScore(matchup))}</strong><small>{isFinal ? "Final team total" : "Current team total"}</small></div>}
      </div>
      <p className="section-note">Weekly actuals follow Sleeper’s league scoring and include commissioner overrides in team totals. Offensive projections are estimates from Sleeper’s weekly stat projections and league weights. Full projected totals, kicker projections, and defense projections are unavailable. {isCurrent ? "Reserve and taxi assignments reflect the current roster." : "Sleeper’s historical matchup data does not identify injured reserve or taxi assignments."}</p>
      {groups.map(group => <section className="lineup-group" key={group.title}>
        <header><h3>{group.title}</h3><span>Fantasy pts</span></header>
        {group.rows.length ? <ul>{group.rows.map((row, index) => {
          const headshot = row.id && playerHeadshot(row.id, row.player?.position);
          const reported = row.id ? playerWeeks.get(row.id) : undefined;
          const nflTeam = reported?.team ?? (isCurrent ? row.player?.team : null);
          const game = nfl?.games.find(game => game.game_id === reported?.game_id) ??
            (nflTeam ? nfl?.games.find(game => [game.home, game.away].includes(nflTeam)) : undefined);
          const status = nflGameStatus(game?.status);
          const opponent = game && nflTeam
            ? (game.home === nflTeam ? `vs ${game.away}` : game.away === nflTeam ? `at ${game.home}` : null)
            : null;
          const projected = status === "Upcoming" ? offensiveProjection(row.player?.position, reported, league?.scoring_settings) : null;
          const actual = status === "Upcoming" || status === "Unavailable" || (status === null && !isFinal && row.score === 0)
            ? null : row.score;
          const label = actual !== null ? isFinal || status === "Final" ? "Final" : status === "Live" ? "Live" : "Current"
            : projected !== null ? "Projected" : null;
          return <li key={row.id ?? `empty-${index}`} className="lineup-row">
            <span className={`position-badge position-${row.slot.toLowerCase()}`}>{row.slot}</span>
            <div className="lineup-photo">{headshot && <Avatar sources={[headshot]} className="player-headshot" size={40}/>}</div>
            <div className="lineup-player"><strong>{row.id ? playerName(row.player, row.id) : "Empty slot"}</strong>
              {row.id && <small>{[row.player?.position, nflTeam, opponent, status, isCurrent ? row.player?.injury_status : null].filter(Boolean).join(" · ") || "Player details unavailable"}</small>}</div>
            <div className="lineup-score"><strong>{points(actual ?? projected)}</strong>{label && <small>{label}</small>}</div>
          </li>;
        })}</ul> : <p className="lineup-empty">{group.available ? "No players listed." : "Unavailable for this week."}</p>}
      </section>)}
    </section>
    {!degraded && <DataStatus sources={sources}/>}
    <section className="panel picks-panel"><div className="panel-heading"><h2>Confirmed available draft picks</h2></div><p className="section-note">Includes untraded picks only when an unstarted draft publishes its rounds, plus explicitly reported future traded picks. Future untraded picks without a published draft cannot be verified and are not listed. This may be a partial inventory.</p>{picks?.length ? <div className="pick-list">{picks.map(pick=><div key={`${pick.season}-${pick.round}-${pick.originalRosterId}`}><strong>{pick.season} · Round {pick.round}</strong><span>Originally <TeamLink id={pick.originalRosterId} team={data.teams.find(t=>t.id===pick.originalRosterId)}/></span><small>{pick.source === "scheduled" ? "Scheduled draft" : "Reported by traded-picks API"}</small></div>)}</div> : <Empty>{data.picks === null ? "Draft-pick ownership is temporarily unavailable." : "No available picks can be confirmed for this team from the published draft and traded-pick data. This does not mean the team owns no future picks."}</Empty>}</section>
  </div>;
}
export default function TeamPage(props: Props) { return <Suspense fallback={<LoadingLeague/>}><TeamPageContent {...props}/></Suspense>; }
