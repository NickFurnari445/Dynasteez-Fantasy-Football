import { Avatar } from "./avatar";
import { preview, recap, weeklyStandings } from "@/lib/weekly-editorial";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { addResult, championship, emptyRecord, finalGame, gameRecords, margin, perGame, rankTeams, recordLabel, regularSeasonComplete, resultsByRoster, seasonAwards, validWeek, winnerIndex, winPct, type RecordLine } from "@/lib/league-results";
import { points } from "@/lib/sleeper-model";
import { getLeagueResults, type SeasonResults } from "@/lib/sleeper";
import type { Team } from "@/lib/sleeper-types";
import { DataStatus, Empty } from "./league-views";

type Query = Record<string, string | string[] | undefined>;
const pct = (value: number | null) => value === null ? "—" : (value * 100).toFixed(1) + "%";
const manager = (team?: Team) => team?.manager ?? "Manager unavailable";
const findTeam = (season: SeasonResults, id: number) => season.data.teams.find(team => team.id === id);
const owner = (season: SeasonResults, id: number) => season.uncertain.has(id) ? null : findTeam(season, id)?.roster.owner_id || null;
const attributed = (season: SeasonResults, id: number) => owner(season, id) ? manager(findTeam(season, id)) : "Manager attribution unavailable";

function Stats({ items }: { items: [string, ReactNode][] }) {
  return <dl className="stat-grid">{items.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="panel feature-panel"><div className="panel-heading"><h2>{title}</h2></div>{children}</section>;
}

export function Filters({ action, fields }: { action: string; fields: { name: string; label: string; value: string; options: [string, string][] }[] }) {
  return <form className="filters" action={action}>
    {fields.map(field => <label key={field.name}>{field.label}<select name={field.name} defaultValue={field.value}>
      {field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>)}
    <button className="button primary" type="submit">Apply filters</button>
  </form>;
}

type Profile = {
  id: string; team: Team; avatar?: string | null; current: boolean;
  seasons: Set<string>; regular: RecordLine; playoff: RecordLine;
  appearances: number; finals: number; championships: number; runnersUp: number;
};

function managerHistory(seasons: SeasonResults[]) {
  const people = new Map<string, Profile>();
  const headToHead = new Map<string, RecordLine>();
  seasons.forEach((season, index) => {
    const { league, data, regular, playoff, qualifierIds } = season;
    const title = championship(league, season.bracket, season.final);
    for (const team of data.teams) {
      const id = team.roster.owner_id;
      if (!id) continue;
      const person = people.get(id) ?? {
        id, team, avatar: data.users.data?.find(user => user.user_id === id)?.avatar, current: index === 0,
        seasons: new Set<string>(), regular: emptyRecord(), playoff: emptyRecord(),
        appearances: 0, finals: 0, championships: 0, runnersUp: 0,
      };
      people.set(id, person);
      if (!owner(season, team.id)) continue;
      if (regular.some(game => game.sides.includes(team.id)) || qualifierIds.has(team.id)) person.seasons.add(league.season);
      if (qualifierIds.has(team.id)) person.appearances++;
      if (title?.champion === team.id) { person.finals++; person.championships++; }
      if (title?.runnerUp === team.id) { person.finals++; person.runnersUp++; }
      for (const game of playoff) {
        if (game.w === team.id) person.playoff.wins++;
        if (game.l === team.id) person.playoff.losses++;
      }
    }
    for (const game of regular) {
      for (const i of [0, 1]) {
        const id = owner(season, game.sides[i]);
        const opponent = owner(season, game.sides[1 - i]);
        const person = id ? people.get(id) : null;
        if (!person) continue;
        addResult(person.regular, game.scores[i], game.scores[1 - i]);
        if (!opponent || id === opponent) continue;
        const key = id + ":" + opponent;
        const line = headToHead.get(key) ?? emptyRecord();
        addResult(line, game.scores[i], game.scores[1 - i]);
        headToHead.set(key, line);
      }
    }
  });
  return { profiles: [...people.values()].sort((a, b) => Number(b.current) - Number(a.current) || manager(a.team).localeCompare(manager(b.team))), headToHead };
}

function ManagerHistory({ seasons }: { seasons: SeasonResults[] }) {
  const { profiles, headToHead } = managerHistory(seasons);
  return <>
    <p className="section-description">Career results from Dynasteez’s linked Sleeper seasons. Regular-season games and championship-bracket results are tracked separately.</p>
    <p className="source-note">Sleeper’s weekly matches identify roster slots. Manager attribution uses each season’s listed primary owners and excludes slots with a detected ownership change. Transfers before tracking began may be unavailable.</p>
    <div className="profile-grid">{profiles.map(person => <article key={person.id} className="panel profile-card">
      <header className="profile-heading">
        {person.avatar && /^[a-z0-9_-]+$/i.test(person.avatar)
          ? <Image unoptimized src={`https://sleepercdn.com/avatars/thumbs/${person.avatar}`} width={52} height={52} alt="" />
          : <span className="avatar-fallback" aria-hidden="true">{manager(person.team).slice(0, 2).toUpperCase()}</span>}
        <div><h2>{manager(person.team)}</h2><p>{person.team.name}{!person.current && " · Last listed team"}</p></div>
      </header>
      <h3>Regular-season history</h3>
      <Stats items={[
        ["Career record", recordLabel(person.regular)], ["Win percentage", pct(winPct(person.regular))],
        ["Points for", person.regular.games ? points(person.regular.cents / 100) : "—"], ["Points per game", points(perGame(person.regular))], ["Seasons played", person.seasons.size],
      ]}/>
      <h3>Playoff history</h3>
      <Stats items={[
        ["Playoff record", recordLabel(person.playoff)], ["Playoff appearances", person.appearances],
        ["Championship appearances", person.finals], ["Championships", person.championships], ["Runner-up finishes", person.runnersUp],
      ]}/>
    </article>)}</div>
    {!profiles.length && <Empty>No primary manager profiles are available.</Empty>}
    {!!profiles.length && <Panel title="Regular-season head-to-head">
      <p className="section-note">Read each record from the row manager’s perspective. Scroll across to see all opponents.</p>
      <div className="table-wrap matrix-wrap" role="region" aria-label="Regular-season manager head-to-head records" tabIndex={0}>
        <table className="matrix"><thead><tr><th scope="col">Manager <span aria-hidden="true">→</span></th>{profiles.map(person => <th key={person.id} scope="col"><span>{manager(person.team)}</span></th>)}</tr></thead>
          <tbody>{profiles.map(row => <tr key={row.id}><th scope="row">{manager(row.team)}</th>{profiles.map(column => {
            const result = headToHead.get(row.id + ":" + column.id);
            return <td key={column.id} className={row.id === column.id ? "matrix-self" : result ? (result.wins > result.losses ? "winning" : result.wins < result.losses ? "losing" : "even") : "matrix-unplayed"}>
              {result ? recordLabel(result) : "—"}
            </td>;
          })}</tr>)}</tbody>
        </table>
      </div>
    </Panel>}
  </>;
}

function Hall({ seasons }: { seasons: SeasonResults[] }) {
  const titles = seasons.flatMap(season => {
    const title = championship(season.league, season.bracket, season.final);
    return title && findTeam(season, title.champion) && findTeam(season, title.runnerUp) ? [{ season, title }] : [];
  });
  if (!titles.length) {
    const awaitingVerification = seasons.some(season => season.league.status === "complete");
    return <section className="panel hall-empty">
      <p className="publication-kicker">{awaitingVerification ? "Championship archive" : "Inaugural season"}</p>
      <h2>{awaitingVerification ? "Championship results pending verification" : "The first chapter is being written"}</h2>
      <p>{awaitingVerification ? "The Hall will list results when Sleeper’s final bracket can verify the champion and runner-up." : "The inaugural Dynasteez champion will be crowned after the league’s first completed playoffs."}</p>
    </section>;
  }
  return <div className="feature-stack">{titles.map(({ season, title }) => {
    const records = resultsByRoster(season.regular);
    const standingsAvailable = regularSeasonComplete(season.league, season.data.teams, season.regular);
    return <section className="panel hall-season" key={season.league.league_id}>
      <h2 className="sr-only">{season.league.season} Championship</h2>
      <div className="podium-grid">{[title.champion, title.runnerUp].map((id, index) => {
        const team = findTeam(season, id);
        const record = records.get(id);
        return <article className="podium-card" key={id}>
          <p className="publication-kicker">{season.league.season} season · {index === 0 ? "Champion" : "Runner-up"}</p>
          <h3>{attributed(season, id)}</h3><p>{team?.name}</p>
          <Stats items={[
            ["Championship score", points(title.scores?.[index])],
            ["Playoff record", season.playoff.filter(game => game.w === id).length + "–" + season.playoff.filter(game => game.l === id).length],
            ["Regular-season record", standingsAvailable && record ? recordLabel(record) : "—"],
            ["Regular-season order", standingsAvailable ? "#" + (season.data.teams.findIndex(team => team.id === id) + 1) : "—"],
            ["Official playoff seed", "Unavailable"],
          ]}/>
        </article>;
      })}</div>
      <p className="section-note">Regular-season order uses Sleeper’s reported win percentage and points for. Official seeding can reflect commissioner overrides and is shown only when verified.</p>
    </section>;
  })}</div>;
}

function PowerRankings({ season }: { season: SeasonResults }) {
  const rankings = rankingsFor(season);
  const scoringLeader = rankings.length ? Math.max(...rankings.map(row => row.ppg)) : null;
  const recordLeader = rankings.length ? Math.max(...rankings.map(row => row.pct)) : null;
  return <>
    <p className="section-description">Provisional formula · 45/85 (52.9%) regular-season winning percentage and 40/85 (47.1%) points per game. Ties count as half a win.</p>
    <p className="source-note">Win percentage already falls between 0 and 1. Scoring is scaled from the lowest to highest league average, with 0.5 for every team when all averages match. The weighted sum is shown on a 0–100 scale. Sleeper’s public league data does not supply verified rest-of-season projections.</p>
    <Panel title={season.league.season + " Power Rankings"}>
      {rankings.length ? <div className="table-wrap" role="region" aria-label="Power rankings" tabIndex={0}><table><thead><tr>
        {["Rank", "Team / manager", "Record", "Points for", "PPG", "Power score", "Ranking breakdown"].map(label => <th key={label} scope="col">{label}</th>)}
      </tr></thead><tbody>{rankings.map((row, index) => <tr key={row.team.id}>
        <td>{index + 1}</td><td><Avatar sources={row.team.avatars}/><Link href={`/teams/${row.team.id}`}>{row.team.name}</Link><small className="cell-detail">{manager(row.team)}</small></td>
        <td>{recordLabel(row.record)}</td><td>{points(row.record.cents / 100)}</td><td>{points(row.ppg)}</td><td><strong>{row.score.toFixed(1)}</strong></td>
        <td className="ranking-explanation">{row.pct === recordLeader ? "League-leading win rate" : pct(row.pct) + " win rate"} · {row.ppg === scoringLeader ? "League-leading scoring average" : points(row.ppg) + " PPG"}</td>
      </tr>)}</tbody></table></div> : <Empty>Rankings are available once every team has at least one verified regular-season result and the scored weeks can be loaded.</Empty>}
    </Panel>
  </>;
}

function rankingsFor(season: SeasonResults) {
  const cutoff = Math.min(season.league.settings.playoff_week_start - 1, season.league.settings.last_scored_leg ?? 0);
  const start = season.league.settings.start_week || 1;
  const recentWeeks = season.weeks.filter(row => row.week >= start && row.week <= cutoff);
  const coherent = season.data.teams.length === season.league.total_rosters && recentWeeks.length === Math.max(0, cutoff - start + 1) && recentWeeks.every(row =>
    row.source.data && row.games.filter(game => game.status === "final").length * 2 === season.data.teams.length);
  return coherent ? rankTeams(season.data.teams, resultsByRoster(season.regular)) : [];
}

function ThisWeek({ season, query }: { season: SeasonResults; query: Query }) {
  const weeks = season.weeks.filter(week => week.games.length > 0);
  const active = season.data.state.data;
  const currentWeek = active?.season === season.league.season && active.season_type === "regular" && season.league.status === "in_season" ? active.week : null;
  const selected = weeks.find(week => String(week.week) === query.week)
    ?? weeks.find(week => week.week === currentWeek)
    ?? weeks.find(week => week.games.some(game => game.status === "live"))
    ?? weeks.findLast(week => week.games.some(game => game.status === "final"));
  const before = weeklyStandings(season, (selected?.week ?? 1) - 1);
  const pregame = before.length ? rankTeams(season.data.teams, resultsByRoster(season.regular.filter(game => game.week < (selected?.week ?? 1)))) : [];
  const ranks = new Map(pregame.map((row, index) => [row.team.id, index + 1]));
  return <>
    <p className="section-description">{season.league.season} schedule · {currentWeek ? `NFL Week ${currentWeek}` : "Latest available league results"}</p>
    {weeks.length > 0 && <Filters action="/this-week" fields={[{ name: "week", label: "Week", value: String(selected?.week ?? weeks[0].week), options: weeks.map(week => [String(week.week), `Week ${week.week}`]) }]}/>}
    {selected && <div className="matchup-grid">{selected.games.map(game => {
      const sides = game.sides.map(id => {
        const team = findTeam(season, id);
        const standing = before.find(row => row.team.id === id);
        return { team, name: team?.name ?? `Roster #${id}`, standing, rank: ranks.get(id) };
      });
      const [a, b] = sides;
      const final = finalGame(game) ? game : null;
      const lead = final ? winnerIndex(final) : null;
      const story = final ? recap(season, final, null, [], before) : preview(season, game, before);
      return <article className="panel matchup-card" key={game.id}>
        <header><h2 className="publication-kicker">{story.headline}<span className="sr-only"> · Week {game.week} matchup</span></h2><span className={"badge matchup-status status-" + game.status}>{game.status === "pending" ? "Awaiting final scores" : game.status}</span></header>
        <div className="schedule-pair">
          {sides.map((side, index) => <div className="schedule-side" key={game.sides[index]}>
            <h3><Avatar sources={side.team?.avatars}/><Link href={`/teams/${game.sides[index]}`}>{side.name}</Link></h3>
            <p>{manager(side.team)}</p>
            <p className="schedule-record">{side.standing ? `${side.standing.record} · ${points(side.standing.cents / 100)} PF` : "Regular-season stats unavailable"}</p>
          </div>)}
          <span className="schedule-versus" aria-hidden="true">vs</span>
        </div>
        <div className="schedule-score">
          <strong className={lead === 0 ? "winning" : undefined}><span className="sr-only">{a.name} score </span>{game.status === "upcoming" ? "—" : points(game.scores[0])}</strong>
          <span aria-hidden="true">Score</span>
          <strong className={lead === 1 ? "winning" : undefined}><span className="sr-only">{b.name} score </span>{game.status === "upcoming" ? "—" : points(game.scores[1])}</strong>
        </div>
        <p className="matchup-preview">{story.body}</p>
        {final && <p className="matchup-outcome">{lead === null ? "Final · Tie" : `${sides[lead].name} won by ${points(margin(final))} points.`}</p>}
        {a.rank && b.rank && <p className="matchup-ranks">Power rankings #{a.rank} and #{b.rank}</p>}
      </article>;
    })}</div>}
    {!selected && <Empty>{season.league.status === "in_season" ? "No paired matchups are available for the current week. Choose another published week when available." : "The league is in the offseason or has no verified completed matchups yet."}</Empty>}
    {weeks.length > 0 && <p className="source-note">Team records and points reflect verified regular-season games before the selected week. Weekly matchup projections are unavailable from the public league feed.</p>}
  </>;
}

function Records({ seasons, query }: { seasons: SeasonResults[]; query: Query }) {
  const selected = seasons.find(season => season.league.season === query.season);
  const phase = query.phase === "playoff" || query.phase === "regular" ? query.phase : "all";
  const filtered = selected ? [selected] : seasons;
  const context = new Map(filtered.flatMap(season => season.final.map(game => [game, season] as const)));
  const results = [...context.keys()].filter(game => game.phase !== "unknown" && (phase === "all" || game.phase === phase));
  const categories = ["Highest weekly score", "Lowest weekly score", "Closest game", "Biggest blowout"];
  return <>
    <p className="section-description">Single-week records use completed head-to-head matchups. Tied games count for scoring records. Victory margins require a winner.</p>
    <Filters action="/records" fields={[
      { name: "season", label: "Season", value: selected?.league.season ?? "all", options: [["all", "All Time"], ...seasons.map(({ league }): [string, string] => [league.season, league.season])] },
      { name: "phase", label: "Matchup phase", value: phase, options: [["all", "All matchups"], ["regular", "Regular season"], ["playoff", "Playoffs and consolation"]] },
    ]}/>
    <div className="record-grid">{gameRecords(results).map((rows, index) => <Panel key={categories[index]} title={categories[index]}>
      {rows.length ? <ul className="record-entries">{rows.map(row => {
        const season = context.get(row.game)!;
        return <li key={season.league.league_id + row.game.week + row.game.id + row.id}>
          <strong className="record-value">{points(row.value)} pts</strong>
          <h3>{findTeam(season, row.id)?.name}</h3>
          <p>{attributed(season, row.id)} · {season.league.season} Week {row.game.week}</p>
          <p>vs. {findTeam(season, row.opponent)?.name ?? "Opponent unavailable"} · {margin(row.game) === 0 ? "Tie" : `${points(margin(row.game))}-point ${winnerIndex(row.game) === row.game.sides.indexOf(row.id) ? "win" : "loss"}`}</p>
        </li>;
      })}</ul> : <Empty>No verified result for this category.</Empty>}
    </Panel>)}</div>
    {phase !== "playoff" && <div className="feature-stack"><h2>Seasonal awards</h2>
      <p className="source-note">Comeback of the Year goes to the playoff qualifier with the largest improvement in win percentage from the first half to the second half, among teams below .500 at halfway. Each half needs at least two games. Total regular-season points break ties. The award requires a completed season.</p>
      {filtered.map(season => {
        const qualifiersConfirmed = season.qualifierIds.size > 0 && season.qualifierIds.size === season.league.settings.playoff_teams;
        const awards = seasonAwards(season.league, season.data.teams, season.regular, qualifiersConfirmed ? season.qualifierIds : new Set());
        return <Panel key={season.league.league_id} title={season.league.season + " Awards"}>{awards ? <dl className="awards-list">
          <div><dt>Points For Champion</dt><dd>{awards.points.map(row => `${row.team.name} · ${attributed(season, row.team.id)} · ${points(row.record.cents / 100)} pts`).join(" / ")}</dd></div>
          <div><dt>Regular-Season Manager of the Year</dt><dd>{awards.manager.map(row => `${row.team.name} · ${attributed(season, row.team.id)} · ${recordLabel(row.record)}`).join(" / ")}</dd></div>
          <div><dt>Comeback of the Year</dt><dd>{awards.comeback.length ? awards.comeback.map(row => `${row.team.name} · ${attributed(season, row.team.id)} · ${pct(row.before)} to ${pct(row.after)}`).join(" / ")
            : season.league.status !== "complete" ? "Award pending completion of the playoffs."
              : qualifiersConfirmed ? "No playoff qualifier met the comeback criteria." : "The full playoff field could not be verified."}</dd></div>
        </dl> : <Empty>Awards will appear once the required regular-season results are complete and verified.</Empty>}</Panel>;
      })}
    </div>}
  </>;
}

export async function LeagueStatistics({ section, searchParams }: { section: string; searchParams: Promise<Query> }) {
  const [{ seasons, warning }, query] = await Promise.all([getLeagueResults(), searchParams]);
  const current = seasons[0];
  if (!current) return <Empty>{warning ?? "Verified Sleeper data is temporarily unavailable."}</Empty>;
  return <>
    <DataStatus sources={seasons.flatMap(season => season.sources)}/>
    {warning && <p className="preview-notice">{warning}</p>}
    {seasons.some(season => !validWeek(season.league.settings.playoff_week_start)) && <p className="preview-notice">The regular-season boundary is unavailable for at least one season.</p>}
    {section === "manager-history" && <ManagerHistory seasons={seasons}/>}
    {section === "hall-of-champions" && <Hall seasons={seasons}/>}
    {section === "power-rankings" && <PowerRankings season={current}/>}
    {section === "this-week" && <ThisWeek season={current} query={query}/>}
    {section === "records" && <Records seasons={seasons} query={query}/>}
  </>;
}

