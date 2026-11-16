import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getLeagueData, getPlayers } from "@/lib/sleeper";
import { playerName, points } from "@/lib/sleeper-model";
import { DataStatus, Empty, LoadingLeague, TeamLink } from "@/app/components/league-views";

export const metadata = { title: "Team roster" };
async function TeamPageContent({ params }: { params: Promise<{rosterId:string}> }) {
  const { rosterId } = await params;
  if (!/^\d+$/.test(rosterId)) notFound();
  const [data, players] = await Promise.all([getLeagueData(), getPlayers()]);
  const team = data.teams.find(t=>t.id===Number(rosterId));
  if (!team && data.teams.length) notFound();
  if (!team) return <div className="section-page"><Link className="back-link" href="/teams">← All teams</Link><h1>Team unavailable</h1><DataStatus sources={data.sources}/><Empty>This roster cannot be loaded right now. Please try again shortly.</Empty></div>;
  const roster = team.roster;
  const ids = [...new Set([...(roster.players ?? []),...(roster.reserve ?? []),...(roster.taxi ?? []),...(roster.starters ?? [])])].filter(id=>id!=="0");
  const picks = data.picks?.filter(p=>p.ownerId===team.id);
  const group = (id: string) => roster.reserve?.includes(id) ? "Injured reserve" : roster.taxi?.includes(id) ? "Taxi squad" : roster.starters?.includes(id) ? "Starter" : "Bench";
  return <div className="section-page"><Link className="back-link" href="/teams">← All teams</Link><div className="eyebrow">{data.league.data?.season ?? "SEASON UNAVAILABLE"} · ROSTER #{team.id}</div><h1>{team.name}</h1><p className="section-description">Manager: {team.manager ?? "Unavailable"}{team.coManagers.length ? ` · Co-managers: ${team.coManagers.join(", ")}` : ""}</p><DataStatus sources={[...data.sources,players]}/><div className="team-stats"><span><b>{[team.wins,team.losses,team.ties].map(v=>v ?? "—").join("–")}</b>W–L–T</span><span><b>{points(team.pointsFor)}</b>Points for</span><span><b>{points(team.pointsAgainst)}</b>Points against</span></div>
    <section className="panel"><div className="panel-heading"><h2>Player roster</h2><span className="badge">{ids.length} PLAYERS REPORTED</span></div>{ids.length ? <div className="table-wrap"><table><thead><tr><th>POS</th><th>PLAYER</th><th>NFL TEAM</th><th>ROSTER STATUS</th><th>INJURY</th></tr></thead><tbody>{ids.map(id=>{ const player=players.data?.[id];return <tr key={id}><td>{player?.position ?? "—"}</td><td>{playerName(player,id)}</td><td>{player?.team ?? "Unavailable"}</td><td>{group(id)}</td><td>{player?.injury_status ?? "Not reported"}</td></tr>; })}</tbody></table></div> : <Empty>{roster.players === null || roster.players === undefined ? "Player roster not provided by Sleeper." : "No players are listed on this roster."}</Empty>}</section>
    <section className="panel picks-panel"><div className="panel-heading"><h2>Confirmed available draft picks</h2></div><p className="section-note">Includes untraded picks only when an unstarted draft publishes its rounds, plus explicitly reported future traded picks. Future untraded picks without a published draft cannot be verified and are not listed. This may be a partial inventory.</p>{picks?.length ? <div className="pick-list">{picks.map(pick=><div key={`${pick.season}-${pick.round}-${pick.originalRosterId}`}><strong>{pick.season} · Round {pick.round}</strong><span>Originally <TeamLink id={pick.originalRosterId} team={data.teams.find(t=>t.id===pick.originalRosterId)}/></span><small>{pick.source === "scheduled" ? "Scheduled draft" : "Reported by traded-picks API"}</small></div>)}</div> : <Empty>{data.picks === null ? "Draft-pick ownership is temporarily unavailable." : "No available picks can be confirmed for this team from the published draft and traded-pick data. This does not mean the team owns no future picks."}</Empty>}</section>
  </div>;
}
export default function TeamPage(props: { params: Promise<{rosterId:string}> }) { return <Suspense fallback={<LoadingLeague/>}><TeamPageContent {...props}/></Suspense>; }
