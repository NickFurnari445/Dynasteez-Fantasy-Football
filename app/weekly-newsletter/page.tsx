import { Suspense } from "react";
import { Avatar } from "../components/avatar";
import { BrandLogo } from "../components/brand-logo";
import { DataStatus, Empty, LoadingLeague } from "../components/league-views";
import { NewsletterActions } from "../components/newsletter-actions";
import { buildEdition, teamName } from "@/lib/weekly-editorial";
import { getLeagueResults, getPlayers, type SeasonResults } from "@/lib/sleeper";
import { finalGame, lastScored, margin, winnerIndex, type Game } from "@/lib/league-results";
import { points } from "@/lib/sleeper-model";

export const metadata = { title: "Weekly Newsletter" };
type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

function Side({ season, id, score, record }: { season: SeasonResults; id: number; score?: number; record?: string }) {
  const team = season.data.teams.find(entry => entry.id === id);
  return <div className="edition-side">
    <Avatar sources={team?.avatars}/>
    <div><strong>{teamName(season, id)}</strong><small>
      {season.uncertain.has(id) ? "Manager attribution unavailable" : team?.manager ?? "Manager unavailable"}
      {record && ` · ${record}`}
    </small></div>
    {score !== undefined && <b>{points(score)}</b>}
  </div>;
}

function Story({ season, game, headline, body, records }: {
  season: SeasonResults; game: Game; headline: string; body: string; records?: Map<number, string>;
}) {
  const final = finalGame(game);
  const winner = final ? winnerIndex(game) : null;
  return <article className="panel edition-story">
    <h3>{headline}</h3>
    <div className="edition-sides">{game.sides.map((id, i) =>
      <Side key={id} season={season} id={id} score={final ? game.scores[i] : undefined} record={records?.get(id)}/>)}</div>
    {final && <p className="edition-result">{winner === null ? "Final · Tie" :
      `Final · ${teamName(season, game.sides[winner])} won by ${points(margin(game))}`}</p>}
    <p>{body}</p>
  </article>;
}

async function EditionPage({ searchParams }: Props) {
  const [{ seasons, warning }, query, players] = await Promise.all([getLeagueResults(), searchParams, getPlayers()]);
  const season = seasons.find(item => item.league.season === query.season) ?? seasons[0];
  if (!season) return <div className="newsletter"><h1>Dynasteez Weekly</h1><Empty>{warning ?? "Sleeper has no available league seasons."}</Empty></div>;
  const start = season.weeks[0]?.week ?? 1;
  const through = lastScored(season.league);
  const available = new Set([start]);
  for (const row of season.weeks) {
    if (row.week <= through && row.games.some(finalGame)) available.add(row.week + 1);
    if (row.week <= through + 1 && row.games.length && season.league.status !== "complete") available.add(row.week);
  }
  const editions = [...available].sort((a, b) => b - a);
  const week = editions.find(value => String(value) === query.week) ?? editions[0];
  const edition = buildEdition(season, week, players.data);
  const { featured, standings, before } = edition;
  const lead = standings[0];
  const leaders = standings.filter(row => row.rank === 1).map(row => row.team.name).join(" and ");
  const records = new Map(week === start ? season.data.teams.map(team => [team.id, "0–0"]) : standings.map(row => [row.team.id, row.record]));
  const combined = featured ? featured.scores[0] + featured.scores[1] : 0;
  const seasonOver = season.league.status === "complete" && week > through;
  const featuredTitle = featured?.sides.map(id => teamName(season, id)).join(" vs. ");
  const movers = standings.flatMap(row => {
    const previous = before.find(other => other.team.id === row.team.id);
    return previous && previous.rank !== row.rank ? [{ name: row.team.name, from: previous.rank, to: row.rank }] : [];
  }).sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
  return <div className="newsletter section-page">
    <div className="newsletter-toolbar">
      <form className="filters" action="/weekly-newsletter">
        <label>Season<select name="season" defaultValue={season.league.season}>
          {seasons.map(item => <option key={item.league.season}>{item.league.season}</option>)}
        </select></label>
        <label>Edition<select name="week" defaultValue={String(week)}>
          <option value="">Latest available</option>
          {editions.map(value => <option key={value} value={value}>Week {value}</option>)}
        </select></label>
        <button className="button primary" type="submit">Read edition</button>
      </form>
      <NewsletterActions/>
    </div>
    <div className="newsletter-data"><DataStatus sources={[...season.sources, players]}/>
      {warning && <p className="section-note">{warning}</p>}</div>
    <div id="newsletter-edition">
      <header className="panel newsletter-masthead">
        <BrandLogo className="newsletter-logo"/>
        <p className="eyebrow">{season.league.season} season · {seasonOver ? `Week ${through} season wrap` : `Week ${week}`}</p>
        <h1>Dynasteez Weekly</h1>
        <p>{featured ? `Week ${week - 1} put ${featuredTitle} in the spotlight with ${points(margin(featured))} points between them. ${lead ? `${leaders} ${standings[1]?.rank === 1 ? "share" : "set"} the pace in the regular-season standings.` : "Here’s how the verified results came in."}`
          : "The schedule sets the scene for a new edition. The recap desk will have results once Sleeper finalizes the games."}</p>
      </header>
      {featured && <section className="edition-section">
        <h2>Matchup of the Week</h2>
        <div className="edition-feature"><Story season={season} game={featured} headline={featuredTitle!}
          body={`The two lineups combined for ${points(combined)} points. ${margin(featured) === 0 ? "Neither side could find a point of separation." :
            `The ${points(margin(featured))}-point gap was the smallest among the completed games.`} ${lead ? `After the week’s results, ${leaders} sat atop the regular-season standings.` : ""}`}/></div>
        <p className="section-note">Selected by smallest final margin, then highest combined score, then the largest verified upset by pregame standings.</p>
      </section>}
      <section className="edition-section">
        <h2>{week > start ? `Week ${week - 1} recap` : "Previous week recap"}</h2>
        {edition.recaps.length ? <div className="edition-grid">{edition.recaps.map(story =>
          <Story key={story.game.id} season={season} {...story}/>)}</div> :
          <Empty>{week === start ? "This edition opens the season." : "Sleeper has yet to verify completed matchups for this recap."}</Empty>}
      </section>
      {!!edition.awards.length && <section className="edition-section">
        <h2>Weekly superlatives</h2>
        <dl className="panel edition-awards">{edition.awards.map(award => <div key={award.title}>
          <dt>{award.title}</dt>{award.entries.map(entry => <dd key={entry}>{entry}</dd>)}
        </div>)}</dl>
      </section>}
      <section className="edition-section">
        <h2>Standings and playoff picture</h2>
        {lead ? <div className="panel edition-standings">
          <p>{leaders} {standings[1]?.rank === 1 ? "share first place" : "lead the table"} at {lead.record}.</p>
          {edition.slots && <p>{edition.slots} playoff spots are listed in Sleeper. {week < season.league.settings.playoff_week_start ?
            "The teams around the cutoff are still jostling for position." : "The table reflects the regular-season finish. See Sleeper’s brackets for assignments."}</p>}
          <ol>{standings.slice(0, Math.min(standings.length, (edition.slots ?? 3) + 2)).map(row => <li key={row.team.id} value={row.rank}>
            <strong>{row.team.name}</strong> · {row.record} · {points(row.cents / 100)} PF
          </li>)}</ol>
          {!!movers.length && <p>{movers.slice(0, 3).map(row => `${row.name} moved from #${row.from} to #${row.to}`).join(". ")}.</p>}
          <p className="section-note">Order uses win percentage and points for. Official seeds follow Sleeper’s bracket and league rules.</p>
        </div> : <Empty>A complete regular-season standings snapshot is unavailable for this edition.</Empty>}
      </section>
      <section className="edition-section">
        <h2>{seasonOver ? "Looking ahead" : `Week ${week} preview`}</h2>
        {edition.previews.length ? <div className="edition-grid">{edition.previews.map(story =>
          <Story key={story.game.id} season={season} {...story} records={records}/>)}</div> :
          <Empty>{seasonOver ? "The season is complete. The archive will remain available as Dynasteez rolls into its next season." : "Sleeper has yet to publish paired matchups for this week."}</Empty>}
        {!!edition.byes.length && <p className="section-note">Bye or no opponent assigned: {edition.byes.join(", ")}.</p>}
      </section>
      <footer className="edition-closing"><p>{edition.previews.length
        ? "Set your lineups, check the flex spots, and leave the victory speeches in drafts until the scores are final."
        : "Keep one eye on Sleeper for the next schedule. The next edition will pick up where the scoreboard leaves off."}</p></footer>
    </div>
  </div>;
}

export default function NewsletterPage(props: Props) {
  return <Suspense fallback={<LoadingLeague/>}><EditionPage {...props}/></Suspense>;
}
