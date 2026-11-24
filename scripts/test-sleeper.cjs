const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Compile the framework-independent adapter modules using the project's TypeScript.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynasteez-sleeper-tests-'));
for (const name of ['sleeper-types', 'sleeper-model', 'sleeper-cache', 'league-results', 'league-identity', 'weekly-editorial', 'weekly-lineup', 'nfl-week', 'playoff-odds', 'odds-math', 'season-odds', 'weekly-odds', 'odds-history']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.ts'), 'utf8');
  fs.writeFileSync(path.join(directory, name + '.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
const model = require(path.join(directory, 'sleeper-model.js'));
const results = require(path.join(directory, 'league-results.js'));
const { createSleeperClient } = require(path.join(directory, 'sleeper-cache.js'));
const oddsMath = require(path.join(directory, 'odds-math.js'));
const existingPlayoff = require(path.join(directory, 'playoff-odds.js'));
const seasonOdds = require(path.join(directory, 'season-odds.js'));
const weeklyOdds = require(path.join(directory, 'weekly-odds.js'));

test('fair American odds round at the correct threshold and handle endpoints', () => {
  const { americanOdds, probabilityLabel, pointSpreads } = oddsMath;
  for (const [raw, displayed] of [[131.48, '+130'], [248.43, '+250'], [478.03, '+480'], [-115.98, '−115'],
    [-158.40, '−160'], [-262.32, '−260'], [4247.83, '+4250']]) {
    const p = raw > 0 ? 100 / (100 + raw) : -raw / (100 - raw);
    assert.equal(americanOdds(p), displayed);
  }
  assert.equal(americanOdds(0.5), '+100');
  assert.equal(americanOdds(0), null);
  assert.equal(americanOdds(1), null);
  assert.equal(probabilityLabel(0), '<0.015%');
  assert.equal(probabilityLabel(1, 20000, true), '100.0%');
  assert.deepEqual(pointSpreads(152.4, 138.7), ['−13.5', '+13.5']);
  assert.deepEqual(pointSpreads(138.7, 152.4), ['+13.5', '−13.5']);
  assert.deepEqual(pointSpreads(100, 100), ['PK', 'PK']);
});

test('lineup totals require all verified starter slots and preserve zero', () => {
  const projections = new Map([['A', 0], ['B', 11.25], ['BENCH', 20]]);
  assert.equal(weeklyOdds.lineupTotal(['A', 'B'], 2, projections), 11.25);
  assert.equal(weeklyOdds.lineupTotal(['A'], 1, projections), 0);
  for (const starters of [['A'], ['A', 'A'], ['A', '0'], ['A', 'missing']])
    assert.equal(weeklyOdds.lineupTotal(starters, 2, projections), null);
  assert.equal(weeklyOdds.starterProjection({ stats: { pts_ppr: 0 } }, 'K', { xpm: 1 }), 0);
  assert.equal(weeklyOdds.starterProjection(undefined, 'K', { xpm: 1 }), null);
  assert.equal(weeklyOdds.starterProjection({ stats: { pts_ppr: 8, fgm: 1, fgm_50p: 1, xpm: 2 } },
    'K', { fgm_50_59: 5, fgm_60p: 6, xpm: 1 }), null);
  assert.equal(weeklyOdds.starterProjection({ stats: { pts_ppr: 9, fgm: 1, fgm_30_39: 1, xpm: 2 } },
    'K', { fgm_30_39: 3, xpm: 1 }), 5);
  assert.equal(weeklyOdds.starterProjection({ stats: { pts_ppr: 7, pts_allow: 18, pts_allow_14_20: 1, sack: 2.25 } },
    'DEF', { pts_allow_14_20: 1, sack: 1 }), 3.25);
});

const totalOdds = row => Object.values(row).reduce((sum, p) => sum + p, 0);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} ≠ ${expected}`);
function seasonFixture() {
  return { weeks: [], spots: 6, median: false, divisions: false,
    entries: Array.from({ length: 10 }, (_, i) => ({ id: i + 1, record: 22 - i * 2, pf: 120000 - i * 1000,
      pa: 110000, division: 0, samples: [120 - i, 90 - i, 110 - i] })) };
}
const bracketFixture = () => ({ start: 15, through: 14, lengths: [1,1,1], reseed: true,
  bracket: [], actual: {}, customWeeks: null, custom: true, fixedSeeds: [1,2,3,4,5,6] });

test('shared futures conserve probability, preserve playoff results and produce a complete draft order', () => {
  const input = seasonFixture();
  input.weeks = [[[0, 9], [1, 8], [2, 7], [3, 6], [4, 5]]];
  const options = bracketFixture();
  options.through = 13;
  delete options.fixedSeeds;
  const first = seasonOdds.simulateSeason(input, 1234, options);
  assert.deepEqual(first, seasonOdds.simulateSeason(input, 1234, options));
  assert.deepEqual(first.playoffOdds, existingPlayoff.simulatePlayoffOdds(input, 1234));
  const { markets, seeds, draftOrder } = first.futures;
  for (const [market, sum] of Object.entries({ champion: 1, finalist: 2, playoffs: 6, miss: 4, bye: 2, regular: 1, scoring: 1, draft: 1, punishment: 1 }))
    near(totalOdds(markets[market]), sum);
  for (const row of [...seeds, ...draftOrder]) near(totalOdds(row), 1);
  for (const { id } of input.entries) {
    near(seeds.reduce((sum, row) => sum + row[id], markets.miss[id]), 1);
    near(draftOrder.reduce((sum, row) => sum + row[id], 0), 1);
    assert.equal(markets.draft[id], draftOrder[0][id]);
    assert.equal(markets.punishment[id], draftOrder[1][id]);
    assert.ok(markets.champion[id] <= markets.finalist[id] && markets.finalist[id] <= markets.playoffs[id]);
  }
});

test('postseason keeps finalized legs and honors seeds, reseeding, and the two-week consolation aggregate', () => {
  const input = seasonFixture();
  const options = { ...bracketFixture(), through: 17, customWeeks: [15,16], actual: {
    15: { 3: 100, 6: 120, 4: 120, 5: 100, 7: 150, 8: 120, 9: 200, 10: 120 },
    16: { 1: 100, 2: 150, 4: 155, 5: 110, 6: 120, 3: 120, 7: 100, 8: 150, 9: 100, 10: 140 },
    17: { 1: 100, 2: 170, 4: 150, 6: 170 },
  }};
  const { futures } = seasonOdds.simulateSeason(input, 5, options);
  assert.equal(futures.markets.bye[1], 1);
  assert.equal(futures.markets.bye[2], 1);
  assert.equal(futures.markets.champion[6], 1);
  assert.equal(futures.markets.finalist[6], 1);
  assert.equal(futures.markets.draft[9], 1);
  assert.equal(futures.markets.punishment[10], 1);
  assert.equal(futures.draftOrder[2][8], 1);
  assert.equal(futures.draftOrder[4][3], 1);
  const unseeded = seasonOdds.simulateSeason(input, 5, { ...options, reseed: false }).futures;
  assert.equal(unseeded.markets.finalist[4], 1);
  assert.equal(unseeded.markets.finalist[2], 1);
  assert.equal(seasonOdds.simulateSeason(input, 5, { ...options, customWeeks: null }).futures.markets.draft, undefined);
  const official = seasonOdds.simulateSeason(input, 5, { ...options, bracket: [
    { r: 3, m: 6, p: 1, t1: 4, t2: 6, w: 4, l: 6 },
  ] }).futures;
  assert.equal(official.markets.champion[4], 1);
  assert.equal(official.certified.champion[4], 1);
});

test('a multi-week playoff round preserves each finalized scoring leg', () => {
  const model = { ...seasonFixture(), spots: 2, entries: seasonFixture().entries.slice(0,2) };
  const options = { ...bracketFixture(), fixedSeeds: [1,2], through: 16, lengths: [2],
    actual: { 15: {1: 98, 2: 140}, 16: {1: 142, 2: 130} } };
  assert.equal(seasonOdds.simulateSeason(model, 6, options).futures.markets.champion[2], 1);
});

test('weekly game probabilities reconcile, share scores with specials, and omit unverified lines', () => {
  const games = [
    { id: 'A', status: 'upcoming', sides: [1,2] },
    { id: 'B', status: 'upcoming', sides: [3,4] },
  ];
  const profiles = { 1: { mean: 160, deviation: 12 }, 2: { mean: 150, deviation: 12 },
    3: { mean: 110, deviation: 25 }, 4: { mean: 100, deviation: 25 } };
  const first = weeklyOdds.simulateWeekly(games, profiles, 200, [{ id: 'X', mean: 12, deviation: 4 }, { id: 'Y', mean: 13, deviation: 9 }], true, 7);
  for (const line of Object.values(first.lines)) {
    near(line.sides[0].win + line.sides[1].win + line.tie, 1);
    near(line.sides[0].moneyline + line.sides[1].moneyline, 1);
  }
  assert.equal(first.lines.A.sides[0].spread, first.lines.B.sides[0].spread);
  assert.ok(first.lines.A.sides[0].win > first.lines.B.sides[0].win);
  for (const row of Object.values(first.specials)) near(totalOdds(row), 1);
  const incomplete = weeklyOdds.simulateWeekly([{ ...games[0], status: 'final' }, { ...games[1], status: 'live' }],
    profiles, null, null, true, 7);
  assert.deepEqual(incomplete, { lines: {}, specials: {} });
  assert.deepEqual(weeklyOdds.simulateWeekly(games, {}, null, null, false, 7), incomplete);
});

test('weekly history is durable, versioned and race-safe', async () => {
  const { snapshotStore } = require(path.join(directory, 'odds-history.js'));
  const root = path.join(directory, 'snapshots');
  const snapshot = { league: '12345', season: '2026', week: 10, version: '1', at: '2026-11-20T00:00:00.000Z',
    futures: { markets: { champion: { 1: 0.125123 } }, seeds: [], seedsConfirmed: false, certified: {} } };
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => snapshotStore(root).save(snapshot)));
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.deepEqual(await snapshotStore(root).list('12345','2026','1'), [snapshot]);
  assert.deepEqual(await snapshotStore(root).list('12345','2026','2'), []);
  assert.equal(await snapshotStore().save(snapshot), false);
  const pregame = { league: snapshot.league, season: snapshot.season, week: 11, version: snapshot.version, at: snapshot.at,
    lines: { A: { rosterIds: [1, 2], sides: [], tie: null, decisions: 0 } } };
  assert.equal(await snapshotStore(root).savePregame(pregame), true);
  assert.equal(await snapshotStore(root).savePregame(pregame), false);
  assert.deepEqual(await snapshotStore(root).getPregame('12345', '2026', '1', 11), pregame);
  assert.deepEqual(await snapshotStore(root).list('12345', '2026', '1'), [snapshot]);
});
after(() => fs.rmSync(directory, { recursive: true, force: true }));
const isPayload = value => value && typeof value.count === 'number';

test('records preserve missing values, real zeroes, and hundredths', () => {
  assert.equal(model.totalPoints({ fpts: 1269, fpts_decimal: 80 }, 'fpts'), 1269.8);
  assert.equal(model.totalPoints({ fpts: 0, fpts_decimal: 0 }, 'fpts'), 0);
  assert.equal(model.totalPoints({}, 'fpts'), null);
  assert.equal(model.totalPoints({ fpts: 10 }, 'fpts'), null);
  assert.equal(model.points(null), '—');
  const teams = model.makeTeams([{ roster_id: 1, owner_id: 'missing', settings: {} }], []);
  assert.equal(teams[0].manager, null);
  assert.equal(teams[0].wins, null);
  assert.match(teams[0].name, /name unavailable/);
});
test('standings use percentage with ties then PF and retain manager fallback', () => {
  const teams = model.makeTeams([
    { roster_id: 1, owner_id: 'a', settings: { wins: 2, losses: 0, ties: 0, fpts: 10, fpts_decimal: 0 } },
    { roster_id: 2, owner_id: 'b', settings: { wins: 2, losses: 0, ties: 0, fpts: 11, fpts_decimal: 0 } },
    { roster_id: 3, owner_id: 'c', settings: { wins: 2, losses: 1, ties: 1, fpts: 99, fpts_decimal: 0 } },
  ], [{user_id:'a',display_name:'Actual manager',metadata:{team_name:'   '}}]);
  assert.deepEqual(teams.map(t=>t.id), [2,1,3]);
  assert.equal(teams[1].name, 'Actual manager');
});
test('league leg overrides NFL clock; unrelated seasons cannot supply a week', () => {
  assert.equal(model.currentWeek({season:'2026',settings:{leg:10}}, {season:'2026',week:11,season_type:'regular'}), 10);
  assert.equal(model.currentWeek({season:'2025',settings:{}}, {season:'2026',week:10,season_type:'regular'}), null);
  assert.equal(model.currentWeek({season:'2026',settings:{}}, {season:'2026',week:10,season_type:'regular'}), 10);
  assert.equal(model.currentWeek({season:'2026',settings:{leg:0}}, {season:'2026',week:1,season_type:'pre'}), null);
});
test('matchups pair by matchup ID, keep byes separate, and honor zero overrides', () => {
  const groups = model.groupMatchups([{roster_id:1,matchup_id:5},{roster_id:2,matchup_id:null},{roster_id:3,matchup_id:5},{roster_id:4,matchup_id:null}]);
  assert.deepEqual(groups.map(([,entries])=>entries.length), [2,1,1]);
  assert.equal(model.matchupScore({points:100,custom_points:0}), 0);
  assert.equal(model.matchupScore({points:100,custom_points:null}), 100);
  assert.equal(model.matchupScore({}), null);
});
test('picks overlay ownership, exclude completed drafts, and never project startup rounds', () => {
  const rosters = [{roster_id:1},{roster_id:2}];
  const drafts = [{season:'2026',status:'complete',settings:{rounds:22}},{season:'2027',status:'pre_draft',settings:{rounds:3}}];
  const picks = model.availablePicks(rosters,drafts,[{season:'2027',round:1,roster_id:1,owner_id:2},{season:'2026',round:1,roster_id:1,owner_id:2},{season:'2028',round:3,roster_id:2,owner_id:1}]);
  assert.equal(picks.length,7);
  assert.equal(picks.find(p=>p.season==='2027'&&p.round===1&&p.originalRosterId===1).ownerId,2);
  assert.equal(picks.filter(p=>p.season==='2028').length,1);
  assert.equal(model.availablePicks(rosters,[drafts[0]],[]).length,0);
});
test('recent activity excludes pending/failed transactions, deduplicates, and sorts by completion', () => {
  const trade = {transaction_id:'trade',type:'trade',status:'complete',created:5,status_updated:20};
  const waiver = {transaction_id:'waiver',type:'waiver',status:'complete',created:10};
  const pending = {transaction_id:'pending',type:'trade',status:'pending',created:30};
  const failed = {transaction_id:'failed',type:'waiver',status:'failed',created:40};
  assert.deepEqual(model.recentTransactions([waiver,trade,pending,failed,trade]).map(t=>t.transaction_id), ['trade','waiver']);
});
test('cache deduplicates, expires, survives restart, rejects malformed refresh, and recovers', async () => {
  let clock=Date.UTC(2026,10,16), calls=0, fail=false, malformed=false;
  const cacheDirectory=path.join(directory,'cache');
  const fetcher=async () => { calls++; if(fail) throw new Error('simulated outage'); return Response.json(malformed ? {unexpected:true} : {count:calls}); };
  const options={directory:cacheDirectory,fetcher,now:()=>clock};
  const client=createSleeperClient(options);
  const [a,b]=await Promise.all([client.get('test',isPayload,60),client.get('test',isPayload,60)]);
  assert.equal(calls,1); assert.deepEqual(a,b); assert.equal(a.data.count,1);
  await client.get('test',isPayload,60); assert.equal(calls,1);
  clock+=61000; fail=true;
  const outage=await client.get('test',isPayload,60);
  assert.equal(outage.stale,true); assert.equal(outage.data.count,1); assert.equal(outage.fetchedAt,a.fetchedAt);
  await client.get('test',isPayload,60); assert.equal(calls,2);
  const restarted=createSleeperClient(options);
  const restored=await restarted.get('test',isPayload,60);
  assert.equal(restored.data.count,1); assert.equal(restored.stale,true);
  clock+=31000; fail=false; malformed=true;
  assert.equal((await client.get('test',isPayload,60)).data.count,1);
  clock+=31000; malformed=false;
  const recovered=await client.get('test',isPayload,60);
  assert.equal(recovered.stale,false); assert.equal(recovered.error,null); assert.ok(recovered.data.count>1);
});
test('cold outage returns unavailable, never fabricated empty statistics', async () => {
  const client=createSleeperClient({directory:path.join(directory,'cold'),fetcher:async()=>new Response('down',{status:503})});
  const result=await client.get('cold',isPayload);
  assert.equal(result.data,null); assert.equal(result.fetchedAt,null); assert.equal(result.stale,false); assert.ok(result.error);
});
test('timeouts and malformed JSON degrade without destroying the page', async () => {
  const client=createSleeperClient({directory:path.join(directory,'timeout'),timeoutMs:10,fetcher:async(_url,init)=>new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(init.signal.reason));setTimeout(()=>resolve(Response.json({count:1})),30);})});
  assert.equal((await client.get('timeout',isPayload)).data,null);
  const malformed=createSleeperClient({directory:path.join(directory,'malformed'),fetcher:async()=>new Response('{bad json')});
  assert.equal((await malformed.get('json',isPayload)).data,null);
});

const season = (settings = {}, status = 'in_season') => ({
  season: '2026', status, total_rosters: 2,
  settings: { start_week: 1, last_scored_leg: 4, playoff_week_start: 5, playoff_round_type: 0, ...settings },
});
const pair = (a, b) => [{ matchup_id: 1, roster_id: 1, points: a }, { matchup_id: 1, roster_id: 2, points: b }];
const games = (league, week, matchups, state = null) => results.seasonGames(league, state, week, matchups, new Set([1, 2]));
const final = (week, a, b) => games(season(), week, pair(a, b))[0];
const testTeams = [{ id: 1 }, { id: 2 }];

test('scores distinguish placeholders, missing results, live games, and overrides', () => {
  assert.equal(games(season(), 6, pair(0, 0))[0].status, 'upcoming');
  assert.equal(games(season(), 4, pair(0, 0))[0].status, 'pending');
  assert.equal(games(season(), 4, pair(null, 100))[0].status, 'pending');
  const active = { season: '2026', season_type: 'regular', week: 5 };
  assert.equal(games(season(), 5, pair(18, 0), active)[0].status, 'live');
  assert.equal(games(season(), 5, pair(18, 0), active)[0].phase, 'playoff');
  const override = pair(18, 0);
  override[0].custom_points = 0;
  assert.deepEqual(games(season(), 4, override)[0].scores, [0, 0]);
  assert.equal(games(season(), 4, override)[0].status, 'final');
  assert.equal(games(season(), 4, [...pair(100, 99), { ...pair(100, 99)[0] }]).length, 0);
});

test('power formula weights tie-adjusted win rate and normalized PPG', () => {
  const byRoster = results.resultsByRoster([final(1, 120, 100), final(2, 90, 90), final(3, 85, 130)]);
  const ranks = results.rankTeams(testTeams, byRoster);
  assert.equal(ranks[0].team.id, 2);
  assert.ok(Math.abs(ranks[0].score - (45 * 0.5 + 40) * 100 / 85) < 1e-9);
  assert.ok(Math.abs(ranks[1].score - (45 * 0.5) * 100 / 85) < 1e-9);
  const even = results.rankTeams(testTeams, results.resultsByRoster([final(1, 100, 100)]));
  assert.equal(even[0].score, 50);
  assert.deepEqual(results.rankTeams(testTeams, new Map()), []);
  const uneven = new Map([[1, { wins: 1, losses: 0, ties: 0, games: 1, cents: 15000 }],
    [2, { wins: 1, losses: 1, ties: 0, games: 2, cents: 24000 }]]);
  assert.equal(results.rankTeams(testTeams, uneven)[0].score, 100);
});

test('single-game records preserve real zeroes, cents, and co-record holders', () => {
  const scores = [final(1, 120.03, 120.02), final(2, 0, 100), final(3, 120.03, 120.03)];
  assert.equal(results.margin(scores[0]), 0.01);
  const [high, low, close, blowout, defeat] = results.gameRecords(scores);
  assert.equal(high.length, 3);
  assert.equal(low[0].value, 0);
  assert.equal(close[0].value, 0.01);
  assert.equal(blowout[0].id, 2);
  assert.equal(blowout[0].value, 100);
  assert.equal(defeat[0].id, 1);
  assert.equal(defeat[0].opponent, 2);
  assert.equal(defeat[0].game, blowout[0].game);
  assert.deepEqual(defeat[0].game.scores, [0, 100]);
});

test('season awards wait for complete coverage and comeback waits for the season to finish', () => {
  const regular = [final(1, 90, 120), final(2, 90, 110), final(3, 120, 110), final(4, 140, 100)];
  assert.equal(results.seasonAwards(season(), testTeams, regular.slice(0, 3), new Set([1])), null);
  const preliminary = results.seasonAwards(season(), testTeams, regular, new Set([1]));
  assert.equal(preliminary.points[0].team.id, 1);
  assert.equal(preliminary.manager[0].team.id, 1);
  assert.equal(preliminary.comeback.length, 0);
  assert.equal(results.seasonAwards(season({}, 'complete'), testTeams, regular, new Set([1])).comeback[0].gain, 1);
});

test('championship requires a completed league and a decided title bracket', () => {
  const league = season({ last_scored_leg: 5 }, 'complete');
  const postseason = games(league, 5, pair(91, 110));
  const bracket = [{ m: 1, r: 1, p: 1, t1: 1, t2: 2, w: 2, l: 1 }];
  assert.equal(results.championship(season(), bracket, postseason), null);
  assert.equal(results.championship(league, [{ ...bracket[0], w: null, l: null }], postseason), null);
  assert.equal(results.championship(league, [{ ...bracket[0], p: 3 }], postseason), null);
  assert.equal(results.championship(league, [{ ...bracket[0], l: 9 }], postseason), null);
  assert.deepEqual(results.championship(league, bracket, postseason), { champion: 2, runnerUp: 1, scores: [110, 91], week: 5 });
});

const { managerIdentity, teamAvatars } = require(path.join(directory, 'league-identity.js'));
const { buildEdition, preview, weeklyStandings } = require(path.join(directory, 'weekly-editorial.js'));
const { lineupGroups } = require(path.join(directory, 'weekly-lineup.js'));
const { offensiveProjection, lineupProjection, nflGameStatus, weekByeTeams } = require(path.join(directory, 'nfl-week.js'));
const { identityAvatars } = require(path.join(directory, 'league-identity.js'));

test('known IDs, casing, and team names preserve identity independently', () => {
  assert.equal(managerIdentity({user_id:'739566917194530816', display_name:'New handle'}).name, 'Blake Dempsey');
  assert.equal(managerIdentity({username:'jAcKbRuNi'}).name, 'Jack Bruni');
  assert.equal(managerIdentity({user_id:'unknown', display_name:'JackBruni'}).name, 'JackBruni');
  const [team] = model.makeTeams([{roster_id:1, owner_id:'739563947254013952'}], [
    {user_id:'739563947254013952', display_name:'NickFurnari15', metadata:{team_name:'Brice Spice'}},
  ]);
  assert.equal(team.name, 'Brice Spice');
  assert.equal(team.manager, 'Nick Furnari');
  assert.equal(team.username, 'NickFurnari15');
});

test('team avatar wins over manager avatar, and generic or unsafe avatars are omitted', () => {
  const user = {avatar:'4f4090e5e9c3941414db40a871e3e909', metadata:{avatar:'https://sleepercdn.com/images/avatar_default_blue.webp'}};
  assert.deepEqual(teamAvatars({metadata:{avatar:'https://sleepercdn.com/uploads/team.png'}}, user), [
    'https://sleepercdn.com/uploads/team.png', 'https://sleepercdn.com/avatars/thumbs/' + user.avatar,
  ]);
  assert.deepEqual(teamAvatars({metadata:{avatar:'javascript:alert(1)'}}), []);
});

function editorialFixture() {
  const teams = model.makeTeams(Array.from({length:4}, (_, i) => ({roster_id:i+1, owner_id:String(i)})),
    ['North', 'South', 'East', 'West'].map((name, i) => ({user_id:String(i), metadata:{team_name:name}})));
  const league = {season:'2026', status:'in_season', total_rosters:4,
    settings:{start_week:1, last_scored_leg:1, playoff_week_start:4, playoff_teams:2}};
  const pairings = [[1, 2, 105, 101], [3, 4, 105, 80]];
  const week = (week, status) => ({
    week,
    games: pairings.map(([a,b,x,y], i) => ({id:String(i), phase:'regular', week, status, sides:[a,b], scores:[x,y]})),
    source: {data: pairings.flatMap(([a,b], i) => [a,b].map(roster_id => ({roster_id, matchup_id:i+1})))},
  });
  const weeks = [week(1, 'final'), week(2, 'live')];
  return {league, data:{teams, uncertain:new Set()}, weeks, final:weeks[0].games};
}

test('newsletter recaps finals only, recognizes tied awards, and keeps historical previews as-of', () => {
  const season = editorialFixture();
  const edition = buildEdition(season, 2);
  assert.equal(edition.recaps.length, 2);
  assert.equal(edition.featured.id, '0');
  assert.equal(edition.awards.find(a => a.title === 'Team of the Week').entries.length, 2);
  assert.equal(edition.awards.find(a => a.title === 'Player of the Week'), undefined);
  assert.equal(edition.previews.length, 2);
  assert.equal(buildEdition(season, 3).recaps.length, 0);
  assert.match(preview(season, season.weeks[0].games[0]).headline, /schedule/i);
  assert.equal(preview(season, season.weeks[1].games[0]).headline, "Pressure at the playoff line");
  season.league.settings.playoff_teams = 0;
  assert.equal(preview(season, season.weeks[1].games[0]).headline, "A rematch with unfinished business");
  assert.equal(weeklyStandings(season, 2).length, 0);
  season.league.settings.league_average_match = 1;
  assert.equal(weeklyStandings(season, 1).length, 0);
});

test('historical lineup uses ordered slots, missing scores, and archived players only', () => {
  const groups = lineupGroups(['QB','SUPER_FLEX','BN'], {players:['current'], reserve:['current']}, {
    starters:['123','0'], players:['123','456'], starters_points:[0,0], players_points:{456:6.25},
  }, null, false, true);
  assert.deepEqual(groups[0].rows.map(row => [row.slot,row.id,row.score]), [['QB','123',0],['SUPERFLEX',null,null]]);
  assert.deepEqual(groups[1].rows.map(row => [row.id,row.score]), [['456',6.25]]);
  assert.equal(groups[2].available, false);
});

test('offensive estimates use league weights and require supported weekly projections', () => {
  const entry = {game_id:'game', stats:{pts_ppr:99, pass_yd:250, pass_td:2, pass_int:1}};
  assert.equal(offensiveProjection('QB', entry, {pass_yd:0.04, pass_td:4, pass_int:-2}), 16);
  assert.equal(offensiveProjection('QB', entry, {pass_yd:0.04, bonus_pass_yd_300:2}), null);
  assert.equal(offensiveProjection('K', entry, {xpm:1}), null);
  assert.equal(offensiveProjection('WR', {stats:{adp_dd_ppr:500}}, {rec:1}), null);
  assert.equal(nflGameStatus('complete'), 'Final');
  assert.equal(nflGameStatus('in_game'), 'Live');
  assert.equal(nflGameStatus('pre_game'), 'Upcoming');
});

test('published lineup projections take precedence over bye and injury, including K, D/ST, and zero', () => {
  for (const [position, score, bye, injury] of [
    ['WR', 12.25, false, 'Questionable'], ['RB', 4, true, 'Out'], ['QB', 0, true, 'Doubtful'],
    ['K', 8.5, false, 'Out'], ['DEF', 6.25, false, null],
  ]) {
    const entry = {game_id: bye ? null : 'game', stats:{pts_ppr:score}};
    assert.equal(lineupProjection(entry, position, {}, bye, injury).score, score);
    assert.equal(lineupProjection(entry, position, {}, bye, injury).status, null);
  }
  assert.equal(lineupProjection(undefined, 'WR', {}, true, 'Out').status, 'BYE');
  assert.equal(lineupProjection(undefined, 'WR', {}, false, 'Questionable').status, 'QUESTIONABLE');
  assert.equal(lineupProjection(undefined, 'WR', {}, false, null).status, '—');
});

test('bye detection requires a published week and a complete schedule for the NFL club', () => {
  const schedule = Array.from({length: 18}, (_, i) => ({week: i + 1, home: i === 9 ? 'SEA' : 'LA', away:'ARI'}));
  assert.deepEqual([...weekByeTeams(schedule, 10, '2026')], ['LAR']);
  assert.equal(weekByeTeams(schedule.slice(0, 16), 10, '2026').size, 0);
  assert.equal(weekByeTeams(schedule.filter(game => game.week !== 10), 10, '2026').size, 0);
});

test('team logos from owner-matched seasons precede personal avatars', () => {
  const personal = 'a'.repeat(32);
  const logo = 'https://sleepercdn.com/uploads/team.jpg';
  assert.deepEqual(identityAvatars([
    { roster:{roster_id: 3}, user:{user_id:'manager', avatar:personal} },
    { roster:{roster_id: 8, metadata:{team_avatar:logo}}, user:{user_id:'manager'} },
  ]), [logo, `https://sleepercdn.com/avatars/thumbs/${personal}`]);
});

const { preparePlayoffModel, simulatePlayoffOdds, confirmedPlayoffOdds } = require(path.join(directory, 'playoff-odds.js'));

test('playoff model uses finalized samples, ignores live scoring and requires the full schedule', () => {
  const league = { status: 'in_season', total_rosters: 2, settings: { start_week: 2, last_scored_leg: 2, playoff_week_start: 5, playoff_teams: 1 } };
  const teams = [
    { id: 1, wins: 1, losses: 0, ties: 0, pointsFor: 130, pointsAgainst: 110, roster: {} },
    { id: 2, wins: 0, losses: 1, ties: 0, pointsFor: 110, pointsAgainst: 130, roster: {} },
  ];
  const pair = (a, b) => [{ roster_id: 1, matchup_id: 1, points: a }, { roster_id: 2, matchup_id: 1, points: b }];
  const weeks = [pair(130, 110), pair(75, 119), pair(0, 0)];
  const input = preparePlayoffModel(league, teams, weeks);
  assert.ok(input);
  assert.deepEqual(input.entries.map(entry => entry.samples), [[130], [110]]);
  assert.equal(input.weeks.length, 2);
  const differentLiveScores = [weeks[0], pair(125, 99), weeks[2]];
  assert.deepEqual(input, preparePlayoffModel(league, teams, differentLiveScores));
  assert.equal(preparePlayoffModel(league, teams, weeks.slice(0, -1)), null);
  assert.equal(preparePlayoffModel(league, teams, [weeks[0], weeks[1], []]), null);
  assert.equal(preparePlayoffModel(league, teams, [pair(0, 0), weeks[1], weeks[2]]), null);
  assert.equal(preparePlayoffModel(league, [{ ...teams[0], wins: 2 }, teams[1]], weeks), null);
  const odds = simulatePlayoffOdds(input, 42);
  assert.deepEqual(odds, simulatePlayoffOdds(input, 42));
  assert.equal(odds[1].percent + odds[2].percent, 100);
  assert.ok(odds[1].percent > odds[2].percent);
});

function playoffEntry(id, record, pf, pa, division = 0, samples = [100, 100, 100]) {
  return { id, record, pf, pa, division, samples };
}

test('qualifiers use record, cumulative PF, then higher PA, and bounds certify only guaranteed outcomes', () => {
  const entries = [
    playoffEntry(1, 20, 0, 0), playoffEntry(2, 8, 100, 200),
    playoffEntry(3, 8, 100, 199), playoffEntry(4, 8, 99, 300),
    playoffEntry(5, 0, 900, 900), playoffEntry(6, 4, 1, 1),
  ];
  const odds = simulatePlayoffOdds({ entries, spots: 2, median: false, divisions: false, weeks: [[[0, 1], [2, 3], [4, 5]]] }, 10);
  assert.deepEqual(odds[1], { percent: 100, status: 'clinched' });
  assert.deepEqual(odds[2], { percent: 100, status: undefined });
  assert.deepEqual(odds[3], { percent: 0, status: undefined });
  assert.equal(odds[4].percent, 0);
  assert.deepEqual(odds[5], { percent: 0, status: 'eliminated' });
});

test('division winners earn automatic bids and the median is an additional result using the same score', () => {
  const entries = [
    playoffEntry(1, 10, 400, 0, 1, [140, 140, 140]),
    playoffEntry(2, 10, 300, 0, 1, [120, 120, 120]),
    playoffEntry(3, 9, 200, 0, 2, [130, 130, 130]),
    playoffEntry(4, 10, 100, 0, 2, [110, 110, 110]),
  ];
  const weeks = [[[0, 2], [1, 3]]];
  const noMedian = simulatePlayoffOdds({ entries, weeks, spots: 2, median: false, divisions: true }, 42);
  assert.equal(noMedian[4].percent, 100);
  const median = simulatePlayoffOdds({ entries, weeks, spots: 2, median: true, divisions: true }, 42);
  assert.equal(median[3].percent, 100);
  assert.equal(median[1].percent, 100);
});

test('completed season uses actual published bracket and rejects incomplete or unknown participants', () => {
  const fixed = [1, 2, 3, 4].map(id => ({ id }));
  assert.deepEqual(confirmedPlayoffOdds(fixed, 2, [1, 4, 1]), {
    1: { percent: 100, status: 'qualified' }, 2: { percent: 0, status: 'missed' },
    3: { percent: 0, status: 'missed' }, 4: { percent: 100, status: 'qualified' },
  });
  assert.equal(confirmedPlayoffOdds(fixed, 2, [1]), null);
  assert.equal(confirmedPlayoffOdds(fixed, 2, [1, 5]), null);
});
