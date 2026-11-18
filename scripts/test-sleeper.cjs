const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Compile the framework-independent adapter modules using the project's TypeScript.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynasteez-sleeper-tests-'));
for (const name of ['sleeper-types', 'sleeper-model', 'sleeper-cache', 'league-results', 'league-identity', 'weekly-editorial', 'weekly-lineup', 'nfl-week']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.ts'), 'utf8');
  fs.writeFileSync(path.join(directory, name + '.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
const model = require(path.join(directory, 'sleeper-model.js'));
const results = require(path.join(directory, 'league-results.js'));
const { createSleeperClient } = require(path.join(directory, 'sleeper-cache.js'));
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
  const [high, low, close, blowout] = results.gameRecords(scores);
  assert.equal(high.length, 3);
  assert.equal(low[0].value, 0);
  assert.equal(close[0].value, 0.01);
  assert.equal(blowout[0].id, 2);
  assert.equal(blowout[0].value, 100);
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
const { offensiveProjection, nflGameStatus } = require(path.join(directory, 'nfl-week.js'));

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
