const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Compile the framework-independent adapter modules using the project's TypeScript.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dynasteez-sleeper-tests-'));
for (const name of ['sleeper-types', 'sleeper-model', 'sleeper-cache']) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'lib', name + '.ts'), 'utf8');
  fs.writeFileSync(path.join(directory, name + '.js'), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
}
const model = require(path.join(directory, 'sleeper-model.js'));
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
