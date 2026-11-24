import { Avatar } from "../components/avatar";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getHistory, getCurrentLeagueData } from "@/lib/sleeper";
import { CurrentStandings, DataStatus, Empty, LoadingLeague, Standings, TeamLink } from "../components/league-views";
import { Handbook } from "../components/handbook";
import { LeagueStatistics } from "../components/league-statistics";
import type { LeagueData } from "@/lib/sleeper";

const sections = { teams: "The teams", history: "League history", records: "The record book", draft: "Draft central", handbook: "League handbook", "manager-history": "Manager History", "hall-of-champions": "Hall of Champions", "power-rankings": "Power Rankings", "this-week": "This Week", standings: "Standings" };
export function generateStaticParams() { return Object.keys(sections).map(section=>({section})); }
export async function generateMetadata({ params }: { params: Promise<{section:string}> }) {
  const { section } = await params;
  return { title: Object.hasOwn(sections,section) ? sections[section as keyof typeof sections] : "Page not found" };
}
function Drafts({ data }: { data: LeagueData }) {
  return <><div className="pending-list">{data.drafts.data?.map(draft=><article key={draft.draft_id} className="panel pending-item"><div className="eyebrow">{draft.season} DRAFT</div><h2>{draft.type ?? "Format unavailable"}</h2><p>Status: {draft.status.replaceAll("_"," ")}</p><p>Rounds: {draft.settings?.rounds ?? "Unavailable"}</p><p>{draft.start_time ? new Date(draft.start_time).toLocaleString("en-US", {timeZone:"UTC"}) + " UTC" : "Start date not published"}</p><a className="back-link" href={`https://sleeper.com/draft/nfl/${draft.draft_id}`} target="_blank" rel="noopener noreferrer">Open draft on Sleeper ↗</a></article>)}</div>{!data.drafts.data?.length && <Empty>{data.drafts.error ? "Drafts are temporarily unavailable." : "No drafts reported by Sleeper."}</Empty>}<section className="panel picks-panel"><div className="panel-heading"><h2>Reported available picks</h2></div><p className="section-note">Untraded picks appear only for scheduled, unstarted drafts with published rounds. Other future picks shown here are explicitly reported trades; this is not a complete future inventory.</p>{data.picks?.length ? <div className="table-wrap" role="region" aria-label="Reported available picks" tabIndex={0}><table className="picks-table"><thead><tr><th>SEASON</th><th>ROUND</th><th>ORIGINAL TEAM</th><th>CURRENT OWNER</th></tr></thead><tbody>{data.picks.map(pick=><tr key={`${pick.season}-${pick.round}-${pick.originalRosterId}`}><td>{pick.season}</td><td>{pick.round}</td><td><TeamLink id={pick.originalRosterId} team={data.teams.find(t=>t.id===pick.originalRosterId)}/></td><td><TeamLink id={pick.ownerId} team={data.teams.find(t=>t.id===pick.ownerId)}/></td></tr>)}</tbody></table></div> : <Empty>{data.picks === null ? "Pick ownership is temporarily unavailable." : "No available picks can currently be confirmed from the published draft and trade data."}</Empty>}</section></>;
}
async function History() {
  const { seasons, warning } = await getHistory();
  return <><p className="section-description">Seasons follow Sleeper’s previous league links. Results belong to each season’s own rosters and managers.</p>{warning && <div className="preview-notice">{warning}</div>}{seasons.length === 1 && seasons[0].league.data && !seasons[0].league.data.previous_league_id && <div className="preview-notice">Sleeper has not linked a previous league to this season. No earlier seasons or champions are inferred.</div>}{seasons.map(data=><section className="history-season" key={data.league.data?.league_id ?? "unavailable"}><DataStatus sources={data.sources}/><div className="panel"><div className="panel-heading"><div><div className="eyebrow">{data.league.data?.name ?? "League unavailable"}</div><h2>{data.league.data?.season ?? "Season unavailable"}</h2></div><span className="badge">{data.league.data?.status.replaceAll("_"," ") ?? "UNAVAILABLE"}</span></div><Standings teams={data.teams} linkTeams={false}/><p className="section-note">Season roster totals reported by Sleeper. Displayed order is not a championship result.</p></div></section>)}</>;
}
type Props = { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };
const statistics = new Set(["records", "manager-history", "hall-of-champions", "power-rankings", "this-week"]);

async function SectionContent({ params, searchParams }: Props) {
  const { section } = await params;
  if (!Object.hasOwn(sections,section)) notFound();
  if (section === "handbook") return <div className="section-page handbook-page"><Link className="back-link" href="/">← Back to overview</Link><Handbook/></div>;
  const title = sections[section as keyof typeof sections];
  const data = section === "history" || statistics.has(section) ? null : await getCurrentLeagueData();
  const league = data?.league.data;
  const oddsOrder = section === "standings" ? (await searchParams).odds : undefined;
  const sort = oddsOrder === "asc" || oddsOrder === "desc" ? oddsOrder : "rank";
  return <div className="section-page"><Link className="back-link" href="/">← Back to overview</Link><div className="eyebrow">DYNASTEEZ FANTASY FOOTBALL</div><h1>{title}</h1>{data && <DataStatus sources={data.sources}/>}
    {section === "history" && <History/>}
    {section === "teams" && data && <><p className="section-description">{league?.name ?? "League"} · {league?.season ?? "Season unavailable"}. Select a team to see its roster and confirmed draft picks.</p><div className="team-grid">{data.teams.map(team=><Link className="panel team-card" href={`/teams/${team.id}`} key={team.id}><Avatar sources={team.avatars} size={48}/><h2>{team.name}</h2><p>{team.manager ?? "Manager unavailable"}</p><small>View roster and picks ↗</small></Link>)}</div>{!data.teams.length && <Empty>Teams are temporarily unavailable.</Empty>}</>}
    {section === "draft" && data && <Drafts data={data}/>}
    {statistics.has(section) && <LeagueStatistics section={section} searchParams={searchParams}/>}
    {section === "standings" && data && <>
      <section className="panel feature-panel"><div className="panel-heading"><h2>{league?.season ?? "Current"} standings</h2></div><CurrentStandings teams={data.teams} sort={sort}/></section>
      {league && <details className="panel settings-panel">
        <summary>Sleeper league configuration and scoring</summary>
        <dl className="settings-list">
          <div><dt>Roster positions</dt><dd>{league.roster_positions?.join(" · ") ?? "Unavailable"}</dd></div>
          <div><dt>Playoff teams</dt><dd>{league.settings.playoff_teams ?? "Unavailable"}</dd></div>
          <div><dt>Playoffs begin</dt><dd>{league.settings.playoff_week_start ? `Week ${league.settings.playoff_week_start}` : "Unavailable"}</dd></div>
        </dl>
        <pre>{JSON.stringify({ settings: league.settings, scoring: league.scoring_settings ?? null }, null, 2)}</pre>
      </details>}
    </>}
  </div>;
}
export default function SectionPage(props: Props) { return <Suspense fallback={<LoadingLeague/>}><SectionContent {...props}/></Suspense>; }
