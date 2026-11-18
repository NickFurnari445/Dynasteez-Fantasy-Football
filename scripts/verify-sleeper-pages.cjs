// Run against a local production server after `npm run build` and `npm run start`.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const base = process.env.SLEEPER_VERIFY_URL || 'http://127.0.0.1:3127';
const leagueId = '1394584575056822272';
const decode = html => html.replaceAll('&#x27;', "'").replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('<!-- -->', '');
const format = score => score.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
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
  for (const route of ['/standings', '/weekly-newsletter', '/manager-history', '/hall-of-champions', '/power-rankings', '/this-week', '/records', '/handbook', '/teams', '/draft', '/history']) {
    assert.ok(home.includes(`href="${route}"`), `Navigation links to ${route}`);
  }
  const [league, rosters, users] = await Promise.all(['', '/rosters', '/users'].map(suffix => snapshot(`league/${leagueId}${suffix}`)));
  assert.ok(home.includes(league.name));
  assert.ok(home.includes(`WEEK ${league.settings.leg}`));
  assert.equal(rosters.length, 10);
  const managerNames = {
    antbennett10:'Anthony Bennett', bdempseynh:'Blake Dempsey', bobthebuilderdoes69:"Jack O'Neill",
    jackbruni:'Jack Bruni', jakefink36:'Jake Fink', jcardinal1:'John Cardinal', joshydee:'Josh Denison',
    ltypel2:'Nico Depalle', lukelynn:'Luke Lynn', nickfurnari15:'Nick Furnari',
  };
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
    const name = managerNames[(user.username || user.display_name).toLowerCase()];
    assert.ok(name && home.includes(name) && team.includes(name), 'Verified manager ' + name);
    assert.ok(team.includes('Starting lineup') && team.includes('Taxi Squad'));
    assert.ok(home.includes(user.metadata?.avatar?.includes('/uploads/') ? user.metadata.avatar : user.avatar));
    assert.ok(team.includes('Confirmed available draft picks'));
    assert.ok(!team.includes('name unavailable'), `Player directory resolved roster ${roster.roster_id}`);
  }
  const matchups = await snapshot(`league/${leagueId}/matchups/${league.settings.leg}`);
  for(const matchup of matchups) {
    const score = matchup.custom_points ?? matchup.points;
    if (score != null) assert.ok(home.includes(score.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})), `Actual score for roster ${matchup.roster_id}`);
  }
  await page('/teams'); await page('/draft'); await page('/standings');
  const managers = await page('/manager-history');
  assert.ok(managers.includes('Regular-season head-to-head'));
  assert.ok(managers.includes('Playoff history'));
  assert.equal((managers.match(/class="panel profile-card"/g) ?? []).length, rosters.length);
  for (const user of users.filter(user => user.metadata?.avatar?.includes('/uploads/'))) {
    assert.ok(managers.includes(`src="${user.metadata.avatar}"`), `Manager History uses the custom logo for ${user.display_name}`);
  }
  const hall = await page('/hall-of-champions');
  if (league.status !== 'complete' && !league.previous_league_id) assert.ok(hall.includes('The first chapter is being written'));
  const power = await page('/power-rankings');
  assert.ok(power.includes('52.9%') && power.includes('47.1%'));
  assert.equal((power.match(/class="ranking-explanation"/g) ?? []).length, rosters.length);
  const schedule = await page('/this-week');
  const state = await snapshot('state/nfl');
  if (state.season_type === 'regular' && state.week < league.settings.playoff_week_start) {
    assert.ok(schedule.includes(`Week ${state.week} matchup`));
    assert.equal((schedule.match(/class="panel matchup-card"/g) ?? []).length, rosters.length / 2);
  }
  const prior = await page(`/this-week?week=${league.settings.last_scored_leg}`);
  assert.ok(prior.includes('won by'));
  const records = await page(`/records?season=${league.season}&phase=regular`);
  for (const label of ['Highest weekly score', 'Lowest weekly score', 'Closest game', 'Biggest blowout', 'Largest margin of defeat', 'Seasonal awards']) {
    assert.ok(records.includes(label), `Record book includes ${label}`);
  }
  const pairedScores = new Map();
  const holderName = id => {
    const roster = rosters.find(entry => entry.roster_id === id);
    const user = users.find(entry => entry.user_id === roster?.owner_id);
    return user?.metadata?.team_name?.trim() || user?.display_name || user?.username;
  };
  for (let week = league.settings.start_week || 1; week <= Math.min(league.settings.last_scored_leg, league.settings.playoff_week_start - 1); week++) {
    const entries = await snapshot(`league/${leagueId}/matchups/${week}`);
    pairedScores.set(week, entries.flatMap(row => {
      const score = row.custom_points ?? row.points;
      const pair = entries.filter(entry => row.matchup_id != null && entry.matchup_id === row.matchup_id);
      const opponent = pair.find(entry => entry.roster_id !== row.roster_id);
      const opposingScore = opponent?.custom_points ?? opponent?.points;
      return pair.length === 2 && opponent && score != null && opposingScore != null
        ? [`${holderName(row.roster_id)} ${format(score)} – ${holderName(opponent.roster_id)} ${format(opposingScore)}`] : [];
    }));
  }
  const recordScores = [...records.matchAll(/<p>[^<]+ · (\d{4}) Week (\d+)<\/p><p>Final score: ([^<]+)<\/p>/g)];
  assert.ok(recordScores.length >= 5, 'Each single-matchup record category displays a final score');
  for (const [, year, week, score] of recordScores) {
    assert.equal(year, league.season);
    assert.ok(pairedScores.get(+week)?.includes(score), `Week ${week} final score matches the Sleeper pairing: ${score}`);
  }
  const handbook = await page('/handbook');
  for (const rule of ['maximum of 3 quarterbacks', 'Effective Fall 2027', 'Pick #10', 'Acquisition Budget', 'Five votes in favor']) {
    assert.ok(handbook.includes(rule), `Handbook contains ${rule}`);
  }
  const history = await page('/history');
  if (!league.previous_league_id) assert.ok(history.includes('Sleeper has not linked a previous league'));
  assert.ok(!home.includes('Recent transactions'));
  const newsletter = await page('/weekly-newsletter');
  assert.ok(newsletter.includes('Dynasteez Weekly') && newsletter.includes('Copy Newsletter'));
  if (league.settings.last_scored_leg > 0) {
    assert.ok(newsletter.includes('Matchup of the Week') && newsletter.includes('Weekly superlatives'));
    const finalWeek = league.settings.last_scored_leg;
    assert.ok(newsletter.includes('Week ' + finalWeek + ' recap'));
    const finalRows = await snapshot('league/' + leagueId + '/matchups/' + finalWeek);
    const paired = finalRows.filter(row => row.matchup_id != null);
    if (finalWeek < league.settings.playoff_week_start) {
      const recap = newsletter.split('<h2>Week ' + finalWeek + ' recap</h2>')[1]?.split('</section>')[0];
      assert.equal((recap?.match(/class="edition-result"/g) ?? []).length, paired.length / 2);
    }
    const row = paired.find(entry => entry.starters_points?.some(score => score > 0));
    if (row) {
      const archived = await page('/teams/' + row.roster_id + '?week=' + finalWeek);
      assert.ok(archived.includes('Final team total') && archived.includes(format(row.custom_points ?? row.points)));
      for (const score of row.starters_points) if (score > 0) assert.ok(archived.includes(format(score)));
    }
  }
  assert.ok(!home.includes('PLACEHOLDER'));
  console.log(`Verified ${rosters.length} real teams, ${matchups.length} matchup scores, standings, and league sections against cached API responses.`);
}
main().catch(error => { console.error(error); process.exitCode=1; });
