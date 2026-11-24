import { Suspense } from "react";
import Link from "next/link";
import { getFuturesView, getWeeklyView } from "@/lib/odds-data";
import { americanOdds, probabilityLabel } from "@/lib/odds-math";
import { marketLabels, type Futures, type Market } from "@/lib/season-odds";
import type { Team } from "@/lib/sleeper-types";
import { winnerIndex, finalGame } from "@/lib/league-results";
import { Avatar } from "../components/avatar";
import HistoryChart from "./history-chart";
import "./odds.css";

export const metadata = { title: "Odds Center", description: "Fair, model-generated Dynasteez fantasy football odds." };
const tabs = [["futures", "Futures"], ["weekly", "Weekly Lines"], ["specials", "Specials"], ["history", "Odds History"]] as const;
const specialLabels = { high: "Highest Scoring Team of the Week", low: "Lowest Scoring Team of the Week",
  margin: "Largest Margin of Victory", close: "Closest Matchup of the Week", starter: "Highest Scoring Individual Starter of the Week",
  record: "Any Team to Break the League’s Single-Week Scoring Record" };

function TeamLabel({ team, fallback }: { team?: Team; fallback?: string }) {
  return <span className="odds-team">
    {team && <Avatar sources={team.avatars} size={30} fallback={<span aria-hidden="true" className="odds-avatar-fallback">{team.name.slice(0, 1)}</span>}/>}
    <span>{team ? <Link href={`/teams/${team.id}`}>{team.name}</Link> : fallback ?? "Team unavailable"}{team?.manager && <small>{team.manager}</small>}</span>
  </span>;
}

function Odds({ p, status, draws }: { p: number | null; status?: string; draws?: number }) {
  return <span className="odds-quote">{status ?? (p === null ? "—" : americanOdds(p) ?? probabilityLabel(p, draws))}</span>;
}

function MarketRows({ rows }: { rows: { key: string; p: number; name?: string; team?: Team; status?: string; change?: number }[] }) {
  return <div className="odds-market">
    <div className="odds-market-head" aria-hidden="true"><span>#</span><span>Outcome</span><span>Probability</span><span>Odds</span></div>
    <ol>{[...rows].sort((a,b) => b.p - a.p).map((row, index) => <li key={row.key}>
      <span className="odds-rank">{index + 1}</span><TeamLabel team={row.team} fallback={row.name}/>
      <div className="odds-prob"><b>{probabilityLabel(row.p, undefined, !!row.status)}</b>
        <span className="odds-prob-track" aria-hidden="true"><span style={{ width: `${row.p * 100}%` }}/></span>
        {row.change !== undefined && <small title="Change since previous recorded week" className={row.change > 0 ? "odds-up" : row.change < 0 ? "odds-down" : ""}>
          {row.change === 0 ? "No change" : `${row.change > 0 ? "+" : "−"}${Math.abs(row.change * 100).toFixed(1)} pp`}
        </small>}
      </div><Odds p={row.p} status={row.status}/>
    </li>)}</ol>
  </div>;
}

function MarketPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <details className="odds-card odds-detail"><summary>{title}</summary>{children}</details>;
}

function NoMarket({ children }: { children?: React.ReactNode }) {
  return <p className="odds-empty">{children ?? "Market unavailable with the verified data currently published by Sleeper."}</p>;
}

async function FuturesView({ history }: { history: boolean }) {
  const { data, futures, snapshots, storageAvailable, playoffOdds } = await getFuturesView();
  const teams = data.teams;
  const latest = data.league.data?.settings.last_scored_leg ?? 0;
  const previous = snapshots.filter(snapshot => snapshot.week < latest).at(-1);
  if (history) return <HistoryChart teams={teams.map(({ id, name, avatars }) => ({ id, name, avatars }))} snapshots={snapshots} storageAvailable={storageAvailable}/>;
  function rows(key: Market, model: Futures | null) {
    const values = model?.markets[key];
    if (!values) return null;
    return <MarketRows rows={teams.flatMap(team => {
      const p = values[team.id];
      const certainty = model.certified[key]?.[team.id];
      const prior = previous?.futures.markets[key]?.[team.id];
      return p === undefined ? [] : [{ key: String(team.id), team, p,
        status: certainty === 1 ? "Confirmed" : certainty === 0 ? "Eliminated" : undefined,
        change: prior === undefined ? undefined : p - prior }];
    })}/>;
  }
  return <div className="odds-stack">
    <section className="odds-card odds-feature"><div className="odds-market-title"><h2>Championship Winner</h2><span>{data.league.data?.season ?? "Dynasteez"} season</span></div>
      {rows("champion", futures) ?? <NoMarket/>}
    </section>
    <MarketPanel title={marketLabels.finalist}>{rows("finalist", futures) ?? <NoMarket/>}</MarketPanel>
    <h2 className="odds-group-title">Playoff markets</h2>
    <MarketPanel title="Make or Miss the Playoffs">{(futures?.markets.playoffs ?? playoffOdds) ? <>
      <div className="odds-qualify-head"><span>Team</span><span>Make</span><span>Miss</span></div>
      {[...teams].sort((a, b) => (playoffOdds?.[b.id]?.percent ?? 0) - (playoffOdds?.[a.id]?.percent ?? 0)).map(team => {
        const entry = playoffOdds?.[team.id];
        if (!entry) return null;
        const p = futures?.markets.playoffs?.[team.id] ?? entry.percent / 100;
        const locked = !!entry.status;
        const prior = previous?.futures.markets.playoffs?.[team.id];
        const change = prior === undefined ? undefined : (p - prior) * 100;
        return <div key={team.id} data-playoff-team={team.id} data-playoff-percent={entry.percent} className="odds-qualify-head odds-qualify-row"><TeamLabel team={team}/>
          <span><Odds p={p} status={entry.status ? p === 1 ? "Clinched" : "Eliminated" : undefined}/><small>{probabilityLabel(p, undefined, locked)}</small>
            {change !== undefined && <small className={change > 0 ? "odds-up" : change < 0 ? "odds-down" : ""}>{change === 0 ? "No change" : `${change > 0 ? "+" : "−"}${Math.abs(change).toFixed(1)} pp`}</small>}</span>
          <span><Odds p={1-p} status={locked ? p === 0 ? "Confirmed" : "Eliminated" : undefined}/><small>{probabilityLabel(1-p, undefined, locked)}</small></span></div>;
      })}</> : <NoMarket/>}</MarketPanel>
    <MarketPanel title={marketLabels.bye}>{rows("bye", futures) ?? <NoMarket/>}</MarketPanel>
    <MarketPanel title="Final Playoff Seed">{futures ? <div className="odds-seed-wrap" tabIndex={0} role="region" aria-label="Playoff seed probabilities">
      <table><thead><tr><th scope="col">Team</th>{futures.seeds.map((_, i) => <th scope="col" key={i}>Seed {i+1}</th>)}<th scope="col">Miss</th></tr></thead>
      <tbody>{[...teams].sort((a, b) => (futures.markets.playoffs?.[b.id] ?? 0) - (futures.markets.playoffs?.[a.id] ?? 0)).map(team =>
        <tr key={team.id}><td><TeamLabel team={team}/></td>{[...futures.seeds, futures.markets.miss!].map((row, i) =>
          <td key={i}>{probabilityLabel(row[team.id], undefined, futures.seedsConfirmed ||
            (i < futures.seeds.length ? playoffOdds?.[team.id]?.status === "eliminated" : !!playoffOdds?.[team.id]?.status))}</td>)}</tr>)}</tbody></table>
    </div> : <NoMarket/>}</MarketPanel>
    <h2 className="odds-group-title">Regular season</h2>
    {(["regular", "scoring"] as const).map(key => <MarketPanel key={key} title={marketLabels[key]}>{rows(key, futures) ?? <NoMarket/>}</MarketPanel>)}
    <h2 className="odds-group-title">Draft &amp; consolation</h2>
    {(["draft", "punishment"] as const).map(key => <MarketPanel key={key} title={marketLabels[key]}>{rows(key, futures) ?? <NoMarket>The custom two-week results or schedule could not be verified.</NoMarket>}</MarketPanel>)}
    <p className="odds-note">Draft positions refer to original roster slots. The handbook specifies two-week aggregate matchups and leaves exact dates and ties unspecified. Before those weeks are verified the model uses two historical-score draws and splits exact ties by a fair draw. Movement is measured in percentage points (pp) against the previous recorded week.</p>
  </div>;
}

async function WeeklyView({ week, specials }: { week?: number; specials: boolean }) {
  const view = await getWeeklyView(week);
  const teams = new Map(view.data.teams.map(team => [team.id, team]));
  const matchupName = (id: string) => view.games.find(game => game.id === id)?.sides.map(team => teams.get(team)?.name ?? "Team unavailable").join(" vs. ");
  return <div className="odds-stack">
    <div className="odds-week-heading"><h2>{specials ? "Weekly Specials" : "Weekly matchup lines"}</h2>
      {view.weeks.length > 0 && <form className="odds-week-picker" action="/odds-center"><input type="hidden" name="tab" value={specials ? "specials" : "weekly"}/>
        <label htmlFor="odds-week">Week</label><select id="odds-week" name="week" defaultValue={view.week ?? undefined}>{view.weeks.map(w => <option key={w} value={w}>{w}</option>)}</select><button type="submit">View</button></form>}
    </div>
    {specials ? <>
      <p className="odds-note">League-wide specials require reliable inputs for every scheduled team. Equal outcomes split probability credit.</p>
      {Object.entries(specialLabels).map(([key, label]) => {
        const market = view.result?.specials[key];
        return <MarketPanel key={key} title={label}>
          {key === "record" && view.record !== null && <p className="odds-note odds-inset">Verified league record · {view.record.toFixed(2)} pts</p>}
          {market ? <MarketRows rows={Object.entries(market).map(([id, p]) => ({ key: id, p,
            team: ["high", "low", "margin"].includes(key) ? teams.get(Number(id)) : undefined,
            name: key === "starter" ? view.names[id] : key === "close" ? matchupName(id) : { yes: "Yes", no: "No", tie: "No decisive matchup" }[id],
          }))}/> : <NoMarket>{key === "starter" ? "A complete projected starter field and sufficient player-level scoring history are required." : undefined}</NoMarket>}
        </MarketPanel>;
      })}
    </> : <>
      <p className="odds-note">Pregame means use Sleeper starter projections under league scoring. Win probabilities include ties. Moneylines are conditional on a decisive result.</p>
      {!view.games.length && <div className="odds-card"><NoMarket>No verified matchups for this week.</NoMarket></div>}
      <div className="odds-week-grid">{view.games.map(game => {
        const currentLine = view.result?.lines[game.id];
        const saved = view.archived?.lines[game.id];
        const archive = saved?.rosterIds?.every((id, i) => id === game.sides[i]) ? saved : undefined;
        const line = currentLine ?? archive;
        const final = finalGame(game);
        const winner = final ? winnerIndex(game) : null;
        return <section className="odds-card odds-match" key={game.id}>
          <div className="odds-match-status"><span>Week {game.week}</span><strong>{final ? "Final" : game.status === "live" ? "In progress" : game.status === "pending" ? "Awaiting finalization" : "Scheduled"}</strong></div>
          <div className="odds-match-cols odds-market-head"><span>Team</span><span>{final || game.status !== "upcoming" ? "Score" : "Proj."}</span><span>Spread</span><span>Moneyline</span></div>
          {game.sides.map((id, i) => <div key={id} className="odds-match-cols odds-match-row">
            <TeamLabel team={teams.get(id)}/><b>{final || game.status !== "upcoming" ? game.scores[i]?.toFixed(2) ?? "—" : line?.sides[i].projected.toFixed(1) ?? "—"}</b>
            <span>{line?.sides[i].spread ?? "—"}</span><Odds p={line?.sides[i].moneyline ?? null} draws={line?.decisions}/>
          </div>)}
          {final && <p className="odds-note odds-inset">{winner === null ? "Tied matchup" : `${teams.get(game.sides[winner])?.name ?? "Team"} won`}</p>}
          {archive && !currentLine && <p className="odds-note odds-inset">Archived pregame line · {view.archived?.at.slice(0, 10)} · Projections {archive.sides.map(side => side.projected.toFixed(1)).join(" / ")}</p>}
          {line && line.tie !== null ? <div className="odds-match-prob">
            <div className="odds-match-track" aria-hidden="true"><span style={{width: `${line.sides[0].win! * 100}%`}}/><span style={{width: `${line.sides[1].win! * 100}%`}}/></div>
            <div><b>{probabilityLabel(line.sides[0].win!)}</b><span>Tie {probabilityLabel(line.tie)}</span><b>{probabilityLabel(line.sides[1].win!)}</b></div>
          </div> : <p className="odds-note odds-inset">{final ? archive ? "Archived moneyline unavailable" : "No archived pregame line" :
            game.status === "pending" ? "Sleeper has yet to confirm the final scores." :
            game.status === "live" ? "Current scores shown. Live odds unavailable." :
              line ? "Moneyline unavailable · insufficient scoring history" : "Pregame projections unavailable"}</p>}
        </section>;
      })}</div>
    </>}
  </div>;
}

async function Content({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string }> }) {
  const query = await searchParams;
  const tab = tabs.find(([id]) => id === query.tab)?.[0] ?? "futures";
  const week = typeof query.week === "string" && /^\d{1,2}$/.test(query.week) ? Number(query.week) : undefined;
  return <>
    <nav className="odds-tabs" aria-label="Odds Center sections">{tabs.map(([id, text]) =>
      <Link key={id} href={id === "futures" ? "/odds-center" : `/odds-center?tab=${id}`} aria-current={id === tab ? "page" : undefined}>{text}</Link>)}</nav>
    <Suspense key={`${tab}/${week}`} fallback={<div className="odds-card"><p className="odds-empty" role="status">Loading league data and model estimates…</p></div>}>
      {tab === "weekly" || tab === "specials" ? <WeeklyView week={week} specials={tab === "specials"}/> : <FuturesView history={tab === "history"}/>}
    </Suspense>
  </>;
}

export default function OddsCenter({ searchParams }: { searchParams: Promise<{ tab?: string; week?: string }> }) {
  return <div className="odds-center">
    <header className="odds-hero"><p>DYNASTEEZ / LEAGUE MODEL</p><h1>Odds Center</h1><span>Season futures, weekly lines, and probability history.</span></header>
    <Suspense fallback={<p className="odds-empty" role="status">Loading Odds Center…</p>}><Content searchParams={searchParams}/></Suspense>
    <details className="odds-card odds-detail odds-method"><summary>How are these odds calculated?</summary>
      <div className="odds-method-copy"><p>Season futures use 20,000 Monte Carlo runs. We start from finalized standings and scores, then simulate the remaining schedule and postseason using each team’s historical scoring average and volatility. In-progress scores enter the season model when Sleeper finalizes the week.</p>
      <p>Sleeper starting lineup projections determine weekly spreads and the expected score behind weekly moneylines. Historical volatility supplies the uncertainty. Lines require complete, scorable lineups before kickoff. A combined 50-plus-yard field goal projection is insufficient when the league awards different points for 50–59 and 60-plus yards.</p>
      <p>Weekly specials share one team score per draw. Individual starter volatility uses each player’s scoring history, informed by position when enough data is available. Tied scoring champions split probability credit.</p>
      <p>American odds are fair model estimates, rounded for readability. Extreme simulation results use one-sided 95% probability bounds. The site refreshes automatically as Sleeper data changes. History contains snapshots recorded after installation.</p></div>
    </details>
    <footer className="odds-disclaimer">Model-generated fair odds. No sportsbook margin. For entertainment and statistical analysis only.</footer>
  </div>;
}
