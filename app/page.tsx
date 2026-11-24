import Link from "next/link";
import { Suspense } from "react";
import { getCurrentLeagueData, LEAGUE_ID } from "@/lib/sleeper";
import { DataStatus, LoadingLeague, Matchups, CurrentStandings } from "./components/league-views";

import { BrandLogo } from "./components/brand-logo";

async function LeagueHome() {
  const data = await getCurrentLeagueData();
  const league = data.league.data;
  return <>
    <section className="hero">
      <div className="hero-copy"><div className="eyebrow"><span className="lime-dot" /> {league?.name ?? "DYNASTEEZ"} · LEAGUE HQ</div><h1>Built for Sundays.<br /><span>Made for dynasties.</span></h1><p>{league ? `${league.name} · ${league.season} season · ${league.total_rosters ?? data.teams.length} teams` : "League details temporarily unavailable."}</p><div className="hero-actions"><a className="button primary" href="#matchups">Explore matchups ↗</a><Link className="button secondary" href="/handbook">League handbook →</Link></div></div>
      <div className="hero-art" aria-hidden="true"><BrandLogo className="hero-logo" priority/></div>
      <div className="hero-bottom"><span><b>{league?.total_rosters ?? "—"}</b> TEAMS</span><span><b>{data.week ?? "—"}</b> CURRENT WEEK</span><span className="hero-format">DYNASTY FANTASY FOOTBALL</span></div>
    </section>
    <DataStatus sources={data.sources}/>
    <div className="dashboard-grid"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">THE LEAGUE AT A GLANCE</div><h2>Current standings</h2></div><Link className="badge" href="/standings">{league?.season ?? "Season unavailable"} standings ↗</Link></div><CurrentStandings teams={data.teams}/></section>
    <div className="right-column"><section className="panel" id="matchups"><div className="panel-heading"><div><div className="eyebrow">HEAD TO HEAD</div><h2>Weekly matchups</h2></div><span className="badge">WEEK {data.week ?? "UNAVAILABLE"}</span></div><p className="section-note">Sleeper league week · scores as reported, including commissioner overrides</p><Matchups data={data}/><div className="panel-foot"><span>Scores refresh every minute</span><span className="small-dot"/></div></section>
    <section className="panel announcements"><div className="panel-heading"><div><div className="eyebrow">AROUND THE LEAGUE</div><h2>The bulletin</h2></div><span className="broadcast" aria-hidden="true">◉</span></div><div className="bulletin"><span className="bulletin-icon">≡</span><div><span className="mini-label">WEEKLY NEWSLETTER</span><h3><Link href="/weekly-newsletter">Dynasteez Weekly ↗</Link></h3><p>Read the latest recaps, weekly awards, and matchup previews.</p></div></div></section></div></div>
    <section className="explore-section"><div className="explore-heading"><div className="eyebrow">MORE THAN A SINGLE SEASON</div><h2>The rest of the playbook.</h2></div><div className="explore-grid">{[{href:"/history",icon:"◷",title:"League history",text:"Explore seasons linked by Sleeper."},{href:"/records",icon:"♜",title:"The record book",text:"Verified results, clearly sourced."},{href:"/draft",icon:"◎",title:"Draft central",text:"Drafts and reported pick ownership."}].map(item=><Link className="explore-card" key={item.href} href={item.href}><span className="explore-icon" aria-hidden="true">{item.icon}</span><span className="explore-arrow">↗</span><h3>{item.title}</h3><p>{item.text}</p><small>EXPLORE THE LEAGUE</small></Link>)}</div></section>
    <section className="sync-banner"><div className="sync-symbol" aria-hidden="true">⇄</div><div><h3>Your league. In sync.</h3><p>Standings, rosters, and scores from Sleeper. Missing data stays unavailable.</p></div><a className="badge" href={`https://sleeper.com/leagues/${league?.league_id ?? LEAGUE_ID}`} target="_blank" rel="noopener noreferrer">VIEW ON SLEEPER ↗</a></section>
  </>;
}
export default function Home() { return <Suspense fallback={<LoadingLeague/>}><LeagueHome/></Suspense>; }
