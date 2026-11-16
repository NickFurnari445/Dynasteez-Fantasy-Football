import Link from "next/link";
import { Suspense } from "react";
import { getLeagueData, getPlayers, getTransactions, LEAGUE_ID } from "@/lib/sleeper";
import { DataStatus, LoadingLeague, Matchups, Standings, Transactions } from "./components/league-views";

async function LeagueHome() {
  const [data, players] = await Promise.all([getLeagueData(), getPlayers()]);
  const activity = await getTransactions(LEAGUE_ID, data.week);
  const league = data.league.data;
  return <>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="lime-dot" /> {league?.name ?? "DYNASTEEZ"} · LEAGUE HQ</div><h1>Built for Sundays.<br /><span>Made for dynasties.</span></h1><p>{league ? `${league.name} · ${league.season} season · ${league.total_rosters ?? data.teams.length} teams` : "League details temporarily unavailable."}<br />Your home for every matchup, move, and moment.</p><div className="hero-actions"><a className="button primary" href="#matchups">Explore matchups ↗</a><Link className="button secondary" href="/handbook">League handbook →</Link></div></div>
      <div className="hero-art" aria-hidden="true"><div className="field-lines"/><div className="hero-shield"><span>★ ★ ★</span><strong>D</strong><small>DYNASTEEZ</small></div><span className="art-caption">THE LONG GAME STARTS HERE.</span></div>
      <div className="hero-bottom"><span><b>{league?.total_rosters ?? "—"}</b> TEAMS</span><span><b>{data.week ?? "—"}</b> CURRENT WEEK</span><span className="hero-format">DYNASTY FANTASY FOOTBALL</span></div>
    </section>
    <DataStatus sources={[...data.sources, players, ...activity.sources]}/>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">THE LEAGUE AT A GLANCE</div><h2>Current standings</h2></div><span className="badge">{league?.season ?? "SEASON UNAVAILABLE"}</span></div><Standings teams={data.teams}/></section>
    <div className="right-column"><section className="panel" id="matchups"><div className="panel-heading"><div><div className="eyebrow">HEAD TO HEAD</div><h2>Weekly matchups</h2></div><span className="badge">WEEK {data.week ?? "UNAVAILABLE"}</span></div><p className="section-note">Sleeper league week · scores as reported, including commissioner overrides</p><Matchups data={data}/><div className="panel-foot"><span>Scores refresh every minute</span><span className="small-dot"/></div></section>
    <section className="panel announcements"><div className="panel-heading"><div><div className="eyebrow">AROUND THE LEAGUE</div><h2>The bulletin</h2></div><span className="broadcast" aria-hidden="true">◉</span></div><div className="bulletin"><span className="bulletin-icon">≡</span><div><span className="mini-label">COMMISSIONER ANNOUNCEMENTS</span><h3>A space for league news.</h3><p>No announcements have been added. Sleeper’s public API does not provide a league announcement feed.</p></div></div></section></div></div>
    <Transactions transactions={activity.transactions} teams={data.teams} players={players.data} unavailable={activity.sources.some(s=>!!s.error)} throughWeek={activity.throughWeek}/>
    <section className="explore-section"><div className="explore-heading"><div className="eyebrow">MORE THAN A SINGLE SEASON</div><h2>The rest of the playbook.</h2></div><div className="explore-grid">{[{href:"/history",icon:"◷",title:"League history",text:"Explore seasons linked by Sleeper."},{href:"/records",icon:"♜",title:"The record book",text:"Verified results, clearly sourced."},{href:"/draft",icon:"◎",title:"Draft central",text:"Drafts and reported pick ownership."}].map(item=><Link className="explore-card" key={item.href} href={item.href}><span className="explore-icon" aria-hidden="true">{item.icon}</span><span className="explore-arrow">↗</span><h3>{item.title}</h3><p>{item.text}</p><small>EXPLORE THE LEAGUE</small></Link>)}</div></section>
    <section className="sync-banner"><div className="sync-symbol" aria-hidden="true">⇄</div><div><h3>Your league. In sync.</h3><p>Standings, rosters, scores, and completed moves from Sleeper. Missing data stays unavailable.</p></div><a className="badge" href={`https://sleeper.com/leagues/${LEAGUE_ID}`} target="_blank" rel="noopener noreferrer">VIEW ON SLEEPER ↗</a></section>
  </>;
}
export default function Home() { return <Suspense fallback={<LoadingLeague/>}><LeagueHome/></Suspense>; }
