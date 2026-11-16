// Run against a local production server after `npm run build` and `npm run start`.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const base = process.env.SLEEPER_VERIFY_URL || 'http://127.0.0.1:3127';
const leagueId = '1394584575056822272';
const decode = html => html.replaceAll('&#x27;', "'").replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('<!-- -->', '');
async function snapshot(endpoint) {
  const file = createHash('sha256').update(endpoint).digest('hex') + '.json';
  return JSON.parse(await readFile(path.join(__dirname, '..', '.next', 'cache', 'sleeper', file), 'utf8')).data;
}
async function page(route) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, `${route} must load`);
  const html = decode(await response.text());
  assert.ok(!html.includes('Taking a timeout.'), `${route} must not render error boundary`);
  assert.ok(!html.includes('DEGRADED'), `${route} must have live data during this check`);
  console.log('PASS', route);
  return html;
}
async function main() {
  const home = await page('/');
  const [league, rosters, users] = await Promise.all(['', '/rosters', '/users'].map(suffix => snapshot(`league/${leagueId}${suffix}`)));
  assert.ok(home.includes(league.name));
  assert.ok(home.includes(`WEEK ${league.settings.leg}`));
  assert.equal(rosters.length, 10);
  for (const roster of rosters) {
    const user = users.find(u=>u.user_id===roster.owner_id);
    assert.ok(home.includes(user.metadata?.team_name?.trim() || user.display_name || user.username));
    const settings = roster.settings;
    for (const field of ['fpts','fpts_against']) {
      if (settings[field] != null && settings[field+'_decimal'] != null) {
        const score = (settings[field] + settings[field+'_decimal']/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
        assert.ok(home.includes(score), `Actual ${field} for roster ${roster.roster_id}`);
      }
    }
    const team = await page(`/teams/${roster.roster_id}`);
    assert.ok(team.includes(user.display_name || user.username));
    assert.ok(team.includes('Confirmed available draft picks'));
    assert.ok(!team.includes('name unavailable'), `Player directory resolved roster ${roster.roster_id}`);
  }
  const matchups = await snapshot(`league/${leagueId}/matchups/${league.settings.leg}`);
  for(const matchup of matchups) {
    const score = matchup.custom_points ?? matchup.points;
    if (score != null) assert.ok(home.includes(score.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})), `Actual score for roster ${matchup.roster_id}`);
  }
  await page('/teams'); await page('/records'); await page('/draft');
  const handbook = await page('/handbook');
  assert.ok(handbook.includes('Scoring settings (Sleeper field names)'));
  const history = await page('/history');
  if (!league.previous_league_id) assert.ok(history.includes('Sleeper has not linked a previous league'));
  assert.ok(home.includes('Recent transactions'));
  assert.ok(!home.includes('PLACEHOLDER'));
  console.log(`Verified ${rosters.length} real teams, ${matchups.length} matchup scores, standings, and league sections against cached API responses.`);
}
main().catch(error => { console.error(error); process.exitCode=1; });
