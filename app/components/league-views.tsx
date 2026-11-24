import { Avatar } from "./avatar";
import Link from "next/link";
import { Suspense } from "react";
import type { ApiResult } from "@/lib/sleeper-cache";
import { groupMatchups, matchupScore, playerName, points } from "@/lib/sleeper-model";
import type { PlayoffOdds } from "@/lib/playoff-odds";
import { getCurrentPlayoffOdds, type LeagueData } from "@/lib/sleeper";
import type { Players, Team, Transaction } from "@/lib/sleeper-types";

export function DataStatus({ sources }: { sources: ApiResult<unknown>[] }) {
  const bad = sources.filter(s => s.error);
  const times = sources.map(s => s.fetchedAt).filter((t): t is string => t !== null).sort();
  return <div className={`preview-notice ${bad.length ? "data-warning" : ""}`} role="status"><span className="notice-icon">i</span><div><p>{bad.length ? bad.some(s => s.stale) ? "Some Sleeper requests failed. Last-known-good data is shown where available; missing sections are marked below." : "Some Sleeper data is unavailable. Available sections remain usable; retries happen automatically." : "League data from Sleeper. Scores and records refresh automatically."}</p>{times[0] && <small>Oldest displayed source: <time dateTime={times[0]}>{new Date(times[0]).toLocaleString("en-US", { timeZone: "UTC" })} UTC</time></small>}</div><span className="badge">{bad.length ? "DEGRADED" : "SLEEPER"}</span></div>;
}
export function Empty({ children }: { children: React.ReactNode }) { return <p className="empty-state">{children}</p>; }
export function TeamLink({ team, id }: { team?: Team; id: number }) { return <Link href={`/teams/${id}`}>{team?.name ?? `Roster #${id} (name unavailable)`}</Link>; }
type OddsSort = "asc" | "desc" | "rank";
const oddsBands = [
  { minimum: 75, color: "green", range: "75%+" },
  { minimum: 50, color: "purple", range: "50–<75%" },
  { minimum: 25, color: "orange", range: "25–<50%" },
  { minimum: 0, color: "red", range: "<25%" },
];
const qualificationLabels = { clinched: "Clinched", eliminated: "Eliminated", qualified: "Qualified", missed: "Missed playoffs" };

function OddsCell({ odds }: { odds?: PlayoffOdds[number] }) {
  if (!odds) return <span className="odds-unavailable">Unavailable</span>;
  const { percent, status } = odds;
  const color = oddsBands.find(band => percent >= band.minimum)?.color;
  const rounded = percent.toFixed(1);
  const label = !status && rounded === "100.0" ? ">99.9%" :
    !status && rounded === "0.0" ? "<0.1%" : rounded + "%";
  return <div className="odds-value" data-band={color} data-percent={percent}>
    <div><strong>{label}</strong>{status && <small>{qualificationLabels[status]}</small>}</div>
    <div className="odds-track" aria-hidden="true"><div style={{ width: percent + "%" }}/></div>
  </div>;
}

async function CurrentStandingsData({ teams, sort }: { teams: Team[]; sort?: OddsSort }) {
  return <Standings teams={teams} odds={await getCurrentPlayoffOdds()} sort={sort}/>;
}

export function CurrentStandings({ teams, sort }: { teams: Team[]; sort?: OddsSort }) {
  return <Suspense fallback={<Standings teams={teams} oddsLoading/>}>
    <CurrentStandingsData teams={teams} sort={sort}/>
  </Suspense>;
}

export function Standings({ teams, linkTeams = true, odds, sort, oddsLoading = false }: {
  teams: Team[]; linkTeams?: boolean; odds?: PlayoffOdds | null; sort?: OddsSort; oddsLoading?: boolean;
}) {
  if (!teams.length) return <Empty>Standings are temporarily unavailable. No substitute records are shown.</Empty>;
  const showOdds = oddsLoading || odds !== undefined;
  const rows = teams.map((team, index) => ({ team, rank: index + 1 }));
  if (odds && (sort === "asc" || sort === "desc")) {
    rows.sort((a, b) => (odds[a.team.id].percent - odds[b.team.id].percent) * (sort === "asc" ? 1 : -1) || a.rank - b.rank);
  }
  const ariaSort = sort === "asc" ? "ascending" : sort === "desc" ? "descending" : undefined;
  const nextSort = sort === "desc" ? "asc" : "desc";
  const confirmed = odds && Object.values(odds).some(item => item.status === "qualified");
  return <>
    <div className="table-wrap standings-wrap" role="region" aria-label="League standings" tabIndex={0}>
      <table className={showOdds ? "standings-table with-odds" : "standings-table"}>
        <caption className="sr-only">Records and points reported by Sleeper. Rank uses win percentage, then points for.</caption>
        <thead><tr>
          <th scope="col" aria-sort={sort === "rank" ? "ascending" : undefined}>
            {sort && sort !== "rank" ? <Link href="/standings" scroll={false} aria-label="Restore rank order">Rank</Link> : "Rank"}
          </th>
          <th scope="col">Team</th><th scope="col">W–L–T</th><th scope="col">PF</th><th scope="col">PA</th>
          {showOdds && <th scope="col" aria-sort={ariaSort}>{sort && odds ?
            <Link href={"/standings?odds=" + nextSort} scroll={false} aria-label={"Sort playoff odds " + (nextSort === "asc" ? "ascending" : "descending")}>
              Playoff Odds <span aria-hidden="true">{sort === "asc" ? "↑" : sort === "desc" ? "↓" : "↕"}</span>
            </Link> : "Playoff Odds"}</th>}
        </tr></thead>
        <tbody>{rows.map(({ team, rank }) => <tr key={team.id}>
          <td>{rank}</td>
          <th scope="row"><div className="standings-identity">
            <Avatar sources={team.avatars}/>
            <span className="team-name">{linkTeams ? <TeamLink team={team} id={team.id}/> : team.name}<small>{team.manager ?? "Manager unavailable"}</small></span>
          </div></th>
          <td>{[team.wins, team.losses, team.ties].map(value => value ?? "—").join("–")}</td>
          <td>{points(team.pointsFor)}</td><td>{points(team.pointsAgainst)}</td>
          {showOdds && <td>{oddsLoading ? "—" : <OddsCell odds={odds?.[team.id]}/>}</td>}
        </tr>)}</tbody>
      </table>
    </div>
    {showOdds && <div className="odds-explainer">
      <ul className="odds-legend" aria-label="Playoff odds color legend">{oddsBands.map(band =>
        <li key={band.color} data-band={band.color}><span aria-hidden="true"/>{band.range}</li>)}</ul>
      {oddsLoading ? <p role="status">Loading playoff odds…</p> :
        confirmed ? <p>Final playoff qualification from the Sleeper winners bracket.</p> :
        <p>Playoff odds are estimated using 20,000 simulations of the remaining regular season based on current standings, historical scoring performance, and remaining schedules. Estimates are independent of official Sleeper odds.</p>}
    </div>}
    <div className="panel-foot"><span>Rank by win percentage, then PF</span>{linkTeams && <Link href="/teams">All teams ↗</Link>}</div>
  </>;
}

export function Matchups({ data }: { data: LeagueData }) {
  const rows = data.matchups?.data;
  if (!rows) return <Empty>{data.week === null ? "The league’s current week is not available yet." : "Weekly matchups are temporarily unavailable."}</Empty>;
  if (!rows.length) return <Empty>Sleeper has not published matchups for this week.</Empty>;
  return <div className="matchups">{groupMatchups(rows).map(([key, entries])=><div className="live-matchup" key={key}>{entries.map(entry=><div className="matchup-side" key={entry.roster_id}><Avatar sources={data.teams.find(t=>t.id===entry.roster_id)?.avatars}/><TeamLink team={data.teams.find(t=>t.id===entry.roster_id)} id={entry.roster_id}/><strong>{points(matchupScore(entry))}</strong></div>)}{entries.length===1 && <small>{entries[0].matchup_id === null ? "No opponent assigned / bye" : "Opponent data unavailable"}</small>}</div>)}</div>;
}
export function Transactions({ transactions, players, teams, unavailable, throughWeek }: { transactions: Transaction[]; players: Players | null; teams: Team[]; unavailable: boolean; throughWeek: number | null }) {
  return <section className="panel transactions"><div className="panel-heading"><div><div className="eyebrow">THE LATEST MOVES</div><h2>Recent transactions</h2></div><span className="badge">COMPLETED ONLY</span></div><p className="section-note">{throughWeek === null ? "Transaction week unavailable" : `Season activity through week ${throughWeek} · latest 15`}{unavailable ? " · Some activity may be unavailable" : ""}</p>{!transactions.length ? <Empty>{unavailable || throughWeek === null ? "Transaction activity is temporarily unavailable." : "No completed trades, waivers, or free-agent moves reported in this period."}</Empty> : <div>{transactions.map(t=><article className="transaction" key={t.transaction_id}><div className="transaction-heading"><h3>{t.type === "trade" ? "Trade" : t.type === "waiver" ? "Waiver claim" : "Free-agent activity"}</h3>{(t.status_updated ?? t.created) ? <time dateTime={new Date(t.status_updated ?? t.created!).toISOString()}>{new Date(t.status_updated ?? t.created!).toLocaleString("en-US", { timeZone:"UTC" })} UTC</time> : <span>Date unavailable</span>}</div><p>{(t.roster_ids ?? []).map((id,i)=><span key={id}>{i>0 ? " · " : ""}<TeamLink id={id} team={teams.find(team=>team.id===id)}/></span>)}</p>{Object.entries(t.adds ?? {}).map(([id,roster])=><p key={`add-${id}`}><span className="transaction-add">+ {playerName(players?.[id],id)}</span> → <TeamLink id={roster} team={teams.find(team=>team.id===roster)}/></p>)}{Object.entries(t.drops ?? {}).map(([id,roster])=><p key={`drop-${id}`}>− {playerName(players?.[id],id)} from <TeamLink id={roster} team={teams.find(team=>team.id===roster)}/></p>)}{(t.draft_picks ?? []).map((pick,i)=><p key={`pick-${i}`}>{pick.season} round {pick.round} (original roster #{pick.roster_id}) → <TeamLink id={pick.owner_id} team={teams.find(team=>team.id===pick.owner_id)}/></p>)}{(t.waiver_budget ?? []).map((move,i)=><p key={`faab-${i}`}>FAAB {move.amount}: <TeamLink id={move.sender} team={teams.find(team=>team.id===move.sender)}/> → <TeamLink id={move.receiver} team={teams.find(team=>team.id===move.receiver)}/></p>)}{t.settings?.waiver_bid != null && <p>Waiver bid: {t.settings.waiver_bid}</p>}</article>)}</div>}</section>;
}
export function LoadingLeague() { return <div className="preview-notice" role="status">Loading league data from Sleeper…</div>; }
