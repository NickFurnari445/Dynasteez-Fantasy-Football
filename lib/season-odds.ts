import { bracketDecided, scoreCents, type BracketGame } from "./league-results";
import { normalScore } from "./odds-math";
import { randomGenerator, scoringStats, simulationCount, simulatePlayoffOdds, type Model } from "./playoff-odds";

export const marketLabels = {
  champion: "Championship Winner", finalist: "Reach the Championship", playoffs: "Make the Playoffs",
  miss: "Miss the Playoffs", bye: "Earn a First-Round Bye", regular: "Regular-Season Winner",
  scoring: "Scoring Champion", draft: "Number-One Overall Draft Pick", punishment: "Last-Place Punishment",
};

export type Market = keyof typeof marketLabels;
type Distribution = Record<number, number>;
export type Futures = { markets: Partial<Record<Market, Distribution>>; seeds: Distribution[]; seedsConfirmed: boolean; draftOrder?: Distribution[]; certified: Partial<Record<Market, Distribution>> };
export type Postseason = {
  start: number; through: number; reseed: boolean; lengths: number[];
  bracket: BracketGame[]; fixedSeeds?: number[]; custom: boolean;
  actual: Record<number, Record<number, number>>;
  customWeeks: number[] | null;
};

export function bracketOrder(size: number): number[] {
  let order = [0, 1];
  while (order.length < size) order = order.flatMap(seed => [seed, order.length * 2 - 1 - seed]);
  return order;
}

export function playoffDimensions(spots: number) {
  const rounds = Math.ceil(Math.log2(spots));
  return { rounds, byes: 2 ** rounds - spots };
}

export function simulateSeason(model: Model, seed: number, postseason: Postseason | null) {
  const ids = model.entries.map(entry => entry.id);
  const { rounds, byes } = playoffDimensions(model.spots);
  const active = !!postseason && postseason.lengths.length === rounds && rounds > 0;
  const custom = active && postseason.custom && ids.length === 10 && model.spots === 6
    && (postseason.through < postseason.start || postseason.customWeeks?.length === 2);
  const counts: Partial<Record<Market, number[]>> = {};
  const keys: Market[] = ["regular", "scoring", "playoffs", "miss"];
  if (active) keys.push("champion", "finalist", "bye");
  if (custom) keys.push("draft", "punishment");
  for (const key of keys) counts[key] = ids.map(() => 0);
  const seedCounts = Array.from({ length: model.spots }, () => ids.map(() => 0));
  const pickCounts = custom ? Array.from({ length: 10 }, () => ids.map(() => 0)) : undefined;
  const pooled = scoringStats(model.entries.flatMap(entry => entry.samples));
  const profiles = model.entries.map(entry => entry.samples.length >= 3 ? scoringStats(entry.samples) : pooled);
  const random = randomGenerator(seed ^ 0x4AB759D1);
  const openingOrder = active ? bracketOrder(2 ** rounds) : [];
  const decided = new Map<string, BracketGame>();
  const published = new Map<number, BracketGame[]>();
  for (const game of postseason?.bracket ?? []) {
    if (game.p == null || game.p === 1) {
      if (bracketDecided(game)) decided.set(`${game.r}/${Math.min(game.w!, game.l!)}/${Math.max(game.w!, game.l!)}`, game);
      if (game.t1 && game.t2) published.set(game.r, [...(published.get(game.r) ?? []), game]);
    }
  }
  const fixedSeeds = postseason?.fixedSeeds?.map(id => ids.indexOf(id));
  const count = (key: Market, index: number) => { counts[key]![index]++; };
  const playoffOdds = simulatePlayoffOdds(model, seed, ({ ranked, seeds, pf }) => {
    seeds = fixedSeeds ?? seeds;
    count("regular", ranked[0]);
    const scoring = Math.max(...pf);
    // The record book recognizes all tied scoring leaders. Split probability credit.
    const leaders = ranked.filter(index => pf[index] === scoring);
    for (const index of leaders) counts.scoring![index] += 1 / leaders.length;
    const qualified = new Set(seeds);
    for (let i = 0; i < ids.length; i++) count(qualified.has(i) ? "playoffs" : "miss", i);
    seeds.forEach((index, position) => seedCounts[position][index]++);
    if (!active) return;

    const weekly = new Map<number, Map<number, number>>();
    const score = (index: number, week: number) => {
      const actual = postseason.actual[week]?.[ids[index]];
      if (actual !== undefined) return actual;
      if (week <= postseason.through) throw new Error("Missing finalized postseason score");
      let scores = weekly.get(week);
      if (!scores) weekly.set(week, scores = new Map());
      if (!scores.has(index)) {
        const { mean, deviation } = profiles[index];
        scores.set(index, scoreCents(Math.max(0, normalScore(mean, deviation, random))));
      }
      return scores.get(index)!;
    };
    const series = (a: number, b: number, weeks: number[]) =>
      weeks.reduce((difference, week) => difference + score(a, week) - score(b, week), 0);
    const play = (a: number, b: number, week: number, n: number, round: number): number => {
      const official = decided.get(`${round}/${Math.min(ids[a], ids[b])}/${Math.max(ids[a], ids[b])}`);
      if (official && week + n - 1 <= postseason.through) return ids.indexOf(official.w!);
      const difference = series(a, b, Array.from({ length: n }, (_, i) => week + i));
      return difference > 0 || (difference === 0 && seeds.indexOf(a) < seeds.indexOf(b)) ? a : b;
    };

    seeds.slice(0, byes).forEach(index => count("bye", index));
    let field = openingOrder.map(position => seeds[position] ?? -1);
    let week = postseason.start;
    const roundLosers: number[][] = [];
    const roundWeeks: number[] = [];
    for (let round = 1; round <= rounds; round++) {
      const live = postseason.through >= week - 1 && fixedSeeds ? published.get(round) : null;
      const players = field.filter(i => i >= 0);
      if (live && live.length * 2 === players.length && live.every(game =>
        players.includes(ids.indexOf(game.t1!)) && players.includes(ids.indexOf(game.t2!)))) {
        field = live.flatMap(game => [ids.indexOf(game.t1!), ids.indexOf(game.t2!)]);
      } else if (round > 1 && postseason.reseed) {
        const sorted = [...field].sort((a, b) => seeds.indexOf(a) - seeds.indexOf(b));
        field = sorted.slice(0, sorted.length / 2).flatMap((a, i) => [a, sorted[sorted.length - 1 - i]]);
      }
      const winners: number[] = [];
      const losers: number[] = [];
      roundWeeks.push(week);
      for (let i = 0; i < field.length; i += 2) {
        const [a, b] = [field[i], field[i + 1]];
        if (round === rounds) { count("finalist", a); count("finalist", b); }
        const winner = a < 0 ? b : b < 0 ? a : play(a, b, week, postseason.lengths[round - 1], round);
        winners.push(winner);
        if (a >= 0 && b >= 0) losers.push(winner === a ? b : a);
      }
      roundLosers.push(losers);
      week += postseason.lengths[round - 1];
      field = winners;
    }
    count("champion", field[0]);
    if (custom) {
      const weeks = postseason.customWeeks ?? [postseason.start, postseason.start + 1];
      // Model-only tie convention. The handbook leaves aggregate-score ties unresolved.
      const order = (a: number, b: number) => {
        const difference = series(a, b, weeks);
        return difference > 0 || (difference === 0 && random() < 0.5) ? [a, b] : [b, a];
      };
      const [first, last] = order(ranked[8], ranked[9]);
      const [third, fourth] = order(ranked[6], ranked[7]);
      count("draft", first);
      count("punishment", last);
      const placement = (place: number, a: number, b: number, round: number) => {
        const official = postseason.bracket.find(game => game.p === place && bracketDecided(game)
          && [game.t1, game.t2].includes(ids[a]) && [game.t1, game.t2].includes(ids[b]));
        const winner = official && roundWeeks[round - 1] + postseason.lengths[round - 1] - 1 <= postseason.through
          ? ids.indexOf(official.w!) : play(a, b, roundWeeks[round - 1], postseason.lengths[round - 1], round);
        return [winner, winner === a ? b : a];
      };
      [...[first, last, third, fourth], ...placement(5, roundLosers[0][0], roundLosers[0][1], 2),
        ...placement(3, roundLosers[1][0], roundLosers[1][1], 3), roundLosers[2][0], field[0]]
        .forEach((index, pick) => pickCounts![pick][index]++);
    }
  });
  const total = (values: number[], expected: number) => {
    if (Math.abs(values.reduce((sum, value) => sum + value, 0) - expected * simulationCount) > 1e-7)
      throw new Error("Futures probability mass mismatch");
  };
  const expected: Record<Market, number> = { champion: 1, finalist: 2, playoffs: model.spots, miss: ids.length - model.spots,
    bye: byes, regular: 1, scoring: 1, draft: 1, punishment: 1 };
  for (const key of keys) total(counts[key]!, expected[key]);
  seedCounts.forEach(row => total(row, 1));
  pickCounts?.forEach(row => total(row, 1));
  for (let i = 0; i < ids.length; i++) {
    const qualification = counts.playoffs![i];
    if (qualification + counts.miss![i] !== simulationCount
      || seedCounts.reduce((sum, row) => sum + row[i], 0) !== qualification
      || (active && (counts.champion![i] > counts.finalist![i] || counts.finalist![i] > qualification || counts.bye![i] > qualification))
      || (pickCounts && pickCounts.reduce((sum, row) => sum + row[i], 0) !== simulationCount)
      || (!fixedSeeds && qualification * 100 / simulationCount !== playoffOdds[ids[i]].percent)) throw new Error("Inconsistent futures outcomes");
  }
  const probabilities = (row: number[]): Distribution => Object.fromEntries(ids.map((id, i) => [id, row[i] / simulationCount]));
  const markets = Object.fromEntries(keys.map(key => [key, probabilities(counts[key]!) ]));
  const certified: Futures["certified"] = {};
  const statuses = Object.fromEntries(ids.flatMap(id => {
    const status = playoffOdds[id].status;
    return status ? [[id, status === "clinched" ? 1 : 0]] : [];
  }));
  certified.playoffs = fixedSeeds ? markets.playoffs : statuses;
  certified.miss = Object.fromEntries(Object.entries(certified.playoffs ?? {}).map(([id, p]) => [id, 1 - p]));
  for (const key of ["champion", "finalist", "bye"] as const) certified[key] =
    Object.fromEntries(Object.entries(certified.playoffs ?? {}).filter(([, p]) => p === 0));
  if (fixedSeeds && active) certified.bye = markets.bye;
  const final = postseason?.bracket.find(game => game.p === 1 && game.r === rounds);
  if (active && fixedSeeds && final?.t1 && final.t2 && postseason.through >=
    postseason.start + postseason.lengths.slice(0, -1).reduce((sum, n) => sum + n, 0) - 1) {
    const finalists = [final.t1, final.t2];
    certified.finalist = Object.fromEntries(ids.map(id => [id, Number(finalists.includes(id))]));
    certified.champion = Object.fromEntries(ids.filter(id => !finalists.includes(id)).map(id => [id, 0]));
    if (bracketDecided(final) && postseason.through >=
      postseason.start + postseason.lengths.reduce((sum, n) => sum + n, 0) - 1) {
      certified.champion = Object.fromEntries(ids.map(id => [id, Number(id === final.w)]));
    }
  }
  if (model.weeks.length === 0) {
    const sorted = [...model.entries].sort((a, b) => b.record - a.record || b.pf - a.pf || b.pa - a.pa);
    if (sorted.length === 1 || sorted[0].record !== sorted[1].record || sorted[0].pf !== sorted[1].pf || sorted[0].pa !== sorted[1].pa)
      certified.regular = markets.regular;
    const best = Math.max(...model.entries.map(entry => entry.pf));
    if (model.entries.filter(entry => entry.pf === best).length === 1) certified.scoring = markets.scoring;
    if (custom && fixedSeeds && sorted.length === 10) {
      const a = sorted[8].id;
      const b = sorted[9].id;
      const weeks = postseason.customWeeks;
      const locked = weeks?.every(week => week <= postseason.through);
      const difference = locked ? weeks!.reduce((sum, week) =>
        sum + postseason.actual[week][a] - postseason.actual[week][b], 0) : 0;
      const excluded = Object.fromEntries(ids.filter(id => id !== a && id !== b).map(id => [id, 0]));
      certified.draft = difference ? markets.draft : excluded;
      certified.punishment = difference ? markets.punishment : excluded;
    }
  }
  for (const key of keys) {
    if (Object.entries(certified[key] ?? {}).some(([id, p]) => markets[key]?.[Number(id)] !== p))
      throw new Error("Certified result disagrees with simulation inputs");
  }
  return { playoffOdds, futures: { markets, certified, seeds: seedCounts.map(probabilities), seedsConfirmed: !!fixedSeeds,
    draftOrder: pickCounts?.map(probabilities) } as Futures };
}
