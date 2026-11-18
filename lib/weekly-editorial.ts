import { addResult, emptyRecord, finalGame, lastScored, margin, recordLabel, scoreCents, validWeek, winnerIndex, type Game, type Result } from "./league-results";
import { points, playerName, numeric } from "./sleeper-model";
import type { League, Matchup, Players, Team } from "./sleeper-types";

export type EditorialSeason = {
  league: League;
  data: { teams: Team[]; uncertain: Set<number> };
  weeks: { week: number; games: Game[]; source: { data: Matchup[] | null } }[];
  final: Result[];
};

export function weeklyStandings(season: EditorialSeason, through: number) {
  const { league, data: { teams } } = season;
  const start = validWeek(league.settings.start_week) ? league.settings.start_week : 1;
  const playoff = league.settings.playoff_week_start;
  if (!validWeek(playoff) || !teams.length || teams.length !== league.total_rosters ||
    league.settings.league_average_match) return [];
  const end = Math.min(through, playoff - 1);
  if (end < start || end > lastScored(league)) return [];
  for (let week = start; week <= end; week++) {
    const games = season.weeks.find(row => row.week === week)?.games ?? [];
    if (games.length * 2 !== teams.length || !games.every(finalGame)) return [];
  }
  return teams.map(team => {
    const games = season.final.filter(game => game.phase === "regular" && game.week <= end && game.sides.includes(team.id))
      .sort((a, b) => a.week - b.week);
    const results = games.map(game => {
      const side = game.sides[0] === team.id ? 0 : 1;
      return { own: scoreCents(game.scores[side]), against: scoreCents(game.scores[1 - side]) };
    });
    const record = results.reduce((record, row) => {
      addResult(record, row.own / 100, row.against / 100);
      return record;
    }, emptyRecord());
    const { wins, losses, ties, cents } = record;
    const against = results.reduce((sum, row) => sum + row.against, 0);
    const run = results.map(row => Math.sign(row.own - row.against)).reverse();
    const endOfRun = run.findIndex(value => value !== run[0]);
    return { team, wins, losses, ties, cents, against, games: games.length, pct: (wins + ties / 2) / games.length,
      streak: run[0] * (endOfRun === -1 ? run.length : endOfRun), record: recordLabel(record) };
  }).sort((a, b) => b.pct - a.pct || b.cents - a.cents || a.team.id - b.team.id).map((row, i, ordered) => ({
    ...row, rank: ordered.findIndex(other => other.pct === ordered[i].pct && other.cents === ordered[i].cents) + 1,
  }));
}

type Standing = ReturnType<typeof weeklyStandings>[number];
export const teamName = (season: EditorialSeason, id: number) => season.data.teams.find(team => team.id === id)?.name ?? `Roster #${id}`;

function cutoff(season: EditorialSeason) {
  const slots = season.league.settings.playoff_teams;
  return Number.isInteger(slots) && slots > 0 && slots < season.data.teams.length ? slots : null;
}

export function playoffContext(season: EditorialSeason, game: Game, a?: Standing, b?: Standing) {
  const slots = cutoff(season);
  if (game.phase !== "regular" || !slots || !a || !b) return false;
  const remaining = season.league.settings.playoff_week_start - game.week;
  return remaining > 0 && remaining <= 5 && [a, b].every(row => Math.abs(row.rank - (slots + 0.5)) <= 1.5);
}

export function preview(season: EditorialSeason, game: Game, standings = weeklyStandings(season, game.week - 1)) {
  const names = game.sides.map(id => teamName(season, id));
  const [a, b] = game.sides.map(id => standings.find(row => row.team.id === id));
  const prior = season.final.filter(row => row.week < game.week && game.sides.every(id => row.sides.includes(id)))
    .sort((first, second) => second.week - first.week)[0];
  if (playoffContext(season, game, a, b)) return { headline: "Pressure at the playoff line",
    body: `With ${cutoff(season)} playoff spots in Sleeper’s settings, No. ${a!.rank} ${names[0]} meets No. ${b!.rank} ${names[1]} near the standings cutoff. This result could reshape the race.` };
  if (prior && margin(prior) <= 10) {
    const winner = winnerIndex(prior);
    return { headline: "A rematch with unfinished business", body: winner === null
      ? `These teams finished level in Week ${prior.week}. Their second meeting gives both sides a chance to settle the score.`
      : `${teamName(season, prior.sides[winner])} took their Week ${prior.week} meeting by ${points(margin(prior))}. The rematch gives ${teamName(season, prior.sides[1 - winner])} another shot.` };
  }
  if (a && b && a.rank <= 3 && b.rank <= 3) return { headline: "Heavyweights share the billing",
    body: `No. ${a.rank} ${names[0]} and No. ${b.rank} ${names[1]} entered the week at ${a.record} and ${b.record}. A win here carries weight at the top of the table.` };
  if (a && b && Math.min(a.rank, b.rank) >= standings.length - 2 && game.phase === "regular") return {
    headline: "A chance to climb out of the cellar", body: `${names[0]} and ${names[1]} meet near the bottom of the standings. Both have a chance to bank a win before the league’s custom consolation and draft-order rules come into play.` };
  const streak = [a, b].filter(row => Math.abs(row?.streak ?? 0) >= 3).sort((x, y) => Math.abs(y!.streak) - Math.abs(x!.streak))[0];
  if (streak) {
    const other = names[streak.team.id === game.sides[0] ? 1 : 0];
    return streak.streak > 0 ? { headline: "The streak gets another test", body: `${streak.team.name} has won ${streak.streak} straight regular-season games. ${other} gets the next shot at ending the run.` }
      : { headline: "Looking for a reset", body: `After ${-streak.streak} straight regular-season losses, ${streak.team.name} gets a chance to turn the page against ${other}.` };
  }
  const scoring = [...standings].sort((x, y) => y.cents - x.cents);
  if (a && b && scoring.slice(0, 2).every(row => game.sides.includes(row.team.id))) return { headline: "The league’s top scorers collide",
    body: `Through the previous week, ${names[0]} and ${names[1]} had piled up ${points(a.cents / 100)} and ${points(b.cents / 100)} regular-season points, the two highest totals in Dynasteez.` };
  const toughSchedule = a && b && [a, b].find(row => row.losses > row.wins && standings.every(other => row.against >= other.against));
  if (toughSchedule) return { headline: "No easy Sundays", body: `${toughSchedule.team.name} has faced a league-high ${points(toughSchedule.against / 100)} points against. The next test comes against ${names[toughSchedule.team.id === game.sides[0] ? 1 : 0]}.` };
  if (prior) return { headline: `A second look at Week ${prior.week}`, body: `Their previous meeting finished ${points(prior.scores[0])}–${points(prior.scores[1])} in ${teamName(season, prior.sides[0])}–${teamName(season, prior.sides[1])} order. This week puts the pairing back on the schedule.` };
  if (a && b) return { headline: "A win to build on", body: `${names[0]} brings a ${a.record} regular-season record into the matchup. ${names[1]} sits at ${b.record}, with ${points(b.cents / 100)} points scored so far.` };
  return { headline: "On the schedule", body: `Sleeper pairs ${names[0]} with ${names[1]} in Week ${game.week}. A complete pregame standings table is unavailable for this matchup.` };
}

function starterScores(rows: Matchup[], ids: readonly number[]) {
  return rows.filter(row => ids.includes(row.roster_id)).flatMap(row => {
    const seen = new Set<string>();
    return (row.starters ?? []).flatMap((id, index) => {
      const score = numeric(row.starters_points?.[index]) ?? numeric(row.players_points?.[id]);
      if (!id || id === "0" || seen.has(id) || score === null) return [];
      seen.add(id);
      return [{ id, roster: row.roster_id, score }];
    });
  });
}

export function recap(season: EditorialSeason, game: Result, players?: Players | null, rows: Matchup[] = [],
  before = weeklyStandings(season, game.week - 1)) {
  const winner = winnerIndex(game);
  const gap = margin(game);
  const [a, b] = game.sides.map(id => teamName(season, id));
  if (winner === null) return { headline: "Even at the final whistle", body: `${a} and ${b} finished level at ${points(game.scores[0])} apiece.` };
  const winnerName = winner === 0 ? a : b;
  const loserName = winner === 0 ? b : a;
  const winRank = before.find(row => row.team.id === game.sides[winner])?.rank;
  const loseRank = before.find(row => row.team.id === game.sides[1 - winner])?.rank;
  const upset = winRank && loseRank && winRank - loseRank >= 3;
  const best = starterScores(rows, [game.sides[winner]]).sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))[0];
  const player = best && players?.[best.id];
  const contribution = player && best.score >= 15 ? ` ${playerName(player, best.id)} contributed ${points(best.score)} points in the winning lineup.` : "";
  const score = `${points(game.scores[winner])}–${points(game.scores[1 - winner])}`;
  if (gap <= 5) return { headline: `${winnerName} survives a nail-biter`, body: `Only ${points(gap)} points separated the teams as ${winnerName} edged ${loserName}, ${score}.${contribution}` };
  if (upset) return { headline: `${winnerName} flips the form guide`, body: `No. ${winRank} ${winnerName} knocked off No. ${loseRank} ${loserName}, ${score}, after entering the week lower in the standings.${contribution}` };
  if (gap >= 40) return { headline: `${winnerName} pulls away`, body: `A ${points(game.scores[winner])}-point outing put ${winnerName} well clear of ${loserName}. The final margin was ${points(gap)}.${contribution}` };
  if (playoffContext(season, game, before.find(row => row.team.id === game.sides[0]), before.find(row => row.team.id === game.sides[1])))
    return { headline: `${winnerName} banks a playoff-race win`, body: `Both teams entered near the standings cutoff. ${winnerName} took the head-to-head result, ${score}, to gain ground on ${loserName}.${contribution}` };
  return { headline: `${winnerName} gets the better of ${loserName}`, body: `The final read ${score} in favor of ${winnerName}, a ${points(gap)}-point win.${contribution}` };
}

function leaders<T>(entries: T[], value: (entry: T) => number) {
  const max = Math.max(...entries.map(value));
  return entries.filter(entry => value(entry) === max);
}

export function buildEdition(season: EditorialSeason, week: number, players?: Players | null) {
  const previous = season.weeks.find(row => row.week === week - 1);
  const upcoming = season.weeks.find(row => row.week === week);
  const games = (previous?.games ?? []).filter(finalGame);
  const rows = previous?.source.data ?? [];
  const before = weeklyStandings(season, week - 2);
  const standings = weeklyStandings(season, week - 1);
  const wins = games.flatMap(game => {
    const winner = winnerIndex(game);
    if (winner === null) return [];
    const loser = 1 - winner;
    const rank = (id: number) => before.find(row => row.team.id === id)?.rank;
    const winnerRank = rank(game.sides[winner]);
    const loserRank = rank(game.sides[loser]);
    return [{ game, winner, loser, upset: winnerRank && loserRank ? winnerRank - loserRank : 0 }];
  });
  const combined = (game: Result) => scoreCents(game.scores[0]) + scoreCents(game.scores[1]);
  const featured = [...games].sort((a, b) => margin(a) - margin(b) || combined(b) - combined(a) ||
    (wins.find(row => row.game === b)?.upset ?? 0) - (wins.find(row => row.game === a)?.upset ?? 0) || a.id.localeCompare(b.id))[0];
  const sides = games.flatMap(game => game.sides.map((id, i) => ({ id, score: game.scores[i] })));
  const scoreText = (entry: typeof sides[number]) => `${teamName(season, entry.id)} · ${points(entry.score)} pts`;
  const gameText = (game: Result) => `${game.sides.map(id => teamName(season, id)).join(" vs. ")} · ${points(margin(game))}-point margin`;
  const bestPlayers = leaders(starterScores(rows, sides.map(side => side.id)), entry => scoreCents(entry.score));
  // League-wide awards require every published pairing to have a verified final.
  const complete = !!previous?.games.length && previous.games.every(finalGame) && rows.length === season.data.teams.length && rows.every(row =>
    row.matchup_id === null || sides.some(side => side.id === row.roster_id));
  const completePlayerScores = complete && rows.filter(row => sides.some(side => side.id === row.roster_id)).every(row =>
    row.starters?.length && starterScores([row], [row.roster_id]).length === row.starters.filter(id => id !== "0").length);
  const awards = complete ? [
    { title: "Team of the Week", entries: leaders(sides, row => scoreCents(row.score)).map(scoreText) },
    { title: "Biggest Blowout", entries: leaders(wins, row => scoreCents(margin(row.game))).map(row => gameText(row.game)) },
    { title: "Nail-Biter", entries: leaders(games, game => -scoreCents(margin(game))).map(gameText) },
    { title: "Tough Luck Award", entries: leaders(wins, row => scoreCents(row.game.scores[row.loser])).map(row => scoreText({
      id: row.game.sides[row.loser], score: row.game.scores[row.loser],
    })) },
    { title: "Biggest Upset", entries: leaders(wins.filter(row => row.upset > 0), row => row.upset)
      .map(row => `${teamName(season, row.game.sides[row.winner])} beat ${teamName(season, row.game.sides[row.loser])} · ${row.upset} spots apart entering the week`) },
    { title: "Player of the Week", entries: completePlayerScores && bestPlayers.every(row => players?.[row.id]) ? bestPlayers
      .map(row => `${playerName(players?.[row.id], row.id)} · ${teamName(season, row.roster)} · ${points(row.score)} starter pts`) : [] },
  ].filter(award => award.entries.length) : [];
  return {
    featured, awards, standings, before, slots: cutoff(season),
    recaps: games.map(game => ({ game, ...recap(season, game, players, rows, before) })),
    previews: (upcoming?.games ?? []).map(game => ({ game, ...preview(season, game, standings) })),
    byes: (upcoming?.source.data ?? []).filter(row => row.matchup_id === null).map(row => teamName(season, row.roster_id)),
  };
}
