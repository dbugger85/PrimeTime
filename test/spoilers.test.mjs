// The most important test: nothing the website receives may give away a result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { factsFromSummary, lineupsFromSummary } from '../src/sources/espn-football.mjs';
import { matchesFromSlam } from '../src/sources/espn-tennis.mjs';
import { factsFromRace, factsFromQuali } from '../src/sources/openf1.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1, scoreQuali } from '../src/scoring/f1.mjs';
import { publishFootball, publishTennis, publishF1, publishWinter, upcomingFootball, upcomingTennis, upcomingF1, upcomingWinter, servicesFor, ADVICE_CODES } from '../src/publish.mjs';
import { factsFromRace as biathlonFacts } from '../src/sources/ibu.mjs';
import * as fis from '../src/sources/fis.mjs';
import { scoreBiathlon, scoreAlpine, scoreCrossCountry } from '../src/scoring/winter.mjs';
import { STAKES, FORECASTS, OUTLOOKS } from '../src/prematch.mjs';
import { icsForTeam } from '../src/calendar.mjs';
import { readdirSync } from 'node:fs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));

const ALLOWED = {
  common: ['id', 'sport', 'comp', 'compName', 'start', 'score', 'segments', 'advice', 'services', 'v', 'links'],
  football: ['teams', 'lineups', 'stakes', 'limited'], // and 'forecast', but only on upcoming matches
  tennis: ['players', 'draw', 'round'],
  f1: ['circuit', 'session'],
  winter: ['race', 'place', 'series', 'gender'],
};
const BANNED_WORDS = /\b(won|win|winner|beat|lost|loses?|comeback|equali[sz]|decider|deciding|upset|late|drama|red flag|safety car|penalt|shootout|extra time|retire|walkover|thriller|collapse|goals?)\b/i;

// Line-ups: two teams, each a formation, exactly 11 [shirt, name, position] starters
// and a bench of [shirt, name] sorted by shirt number, nothing else.
function checkLineups(e) {
  if (!('lineups' in e)) return;
  assert.equal(e.sport, 'football');
  assert.equal(e.lineups.length, 2, `${e.id}: two line-ups`);
  for (const t of e.lineups) {
    assert.deepEqual(Object.keys(t).sort(), ['bench', 'formation', 'players'], `${e.id}: line-up fields`);
    assert.ok(t.bench.length <= 15);
    for (const p of t.bench) assert.ok(p.length === 2 && p.every((x) => typeof x === 'string') && /^\d{0,3}$/.test(p[0]), `${e.id}: bench`);
    const shirts = t.bench.map((p) => Number(p[0]) || 999);
    assert.deepEqual(shirts, [...shirts].sort((a, b) => a - b), `${e.id}: bench sorted by shirt number, not ESPN's order`);
    assert.match(t.formation, /^(\d(-\d){1,4})?$/, `${e.id}: formation`);
    assert.equal(t.players.length, 11, `${e.id}: 11 starters`);
    for (const p of t.players) {
      assert.equal(p.length, 3);
      assert.ok(p.every((x) => typeof x === 'string'));
      assert.match(p[0], /^\d{0,3}$/, `${e.id}: shirt number`);
      assert.match(p[2], /^[A-Z]{0,3}(-[LR])?$/, `${e.id}: position ${p[2]}`);
    }
  }
}

// Direct links: only to a known service's own site, never a highlights or clips page.
const LINK_OK = { tv2play: /^https:\/\/play\.tv2\.no\/sport\//, viaplay: /^https:\/\/viaplay\.no\/sport\//, nrk: /^https:\/\/tv\.nrk\.no\/se\?v=/ };
function checkLinks(e) {
  if (!('links' in e)) return;
  for (const [service, url] of Object.entries(e.links)) {
    assert.ok(LINK_OK[service]?.test(url), `${e.id}: ${service} link ${url}`);
    assert.ok(e.services.includes(service), `${e.id}: a link for a service that doesn't show it`);
    assert.doesNotMatch(url, /klipp|h(o|oe|ø)ydepunkt|highlight|sammendrag|goals|maal|mål/i, `${e.id}: links to clips, not the match`);
  }
}

// Pre-match hints: only known codes, never odds or numbers.
function checkHints(e) {
  if ('stakes' in e) assert.ok(e.stakes in STAKES, `${e.id}: stakes ${e.stakes}`);
  if ('forecast' in e) assert.ok(FORECASTS.includes(e.forecast), `${e.id}: forecast ${e.forecast}`);
  if ('outlook' in e) assert.ok(OUTLOOKS.includes(e.outlook), `${e.id}: outlook ${e.outlook}`);
  if ('chances' in e) assert.ok(e.chances.length === 3 && e.chances.every((x) => Number.isInteger(x) && x >= 0 && x <= 100), `${e.id}: chances ${e.chances}`);
  assert.doesNotMatch(JSON.stringify(e), /moneyline|overUnder|odds|%/i, `${e.id}: odds leaked`);
}

export function checkEvent(e) {
  checkLineups(e);
  checkLinks(e);
  checkHints(e);
  assert.ok(!('forecast' in e), `${e.id}: a forecast on a replay could hint at an upset`);
  assert.ok(!('outlook' in e), `${e.id}: an outlook on a replay could hint at an upset`);
  assert.ok(!('chances' in e), `${e.id}: win chances on a replay could hint at an upset`);
  const quali = e.session === 'qualifying' || e.session === 'sprint-qualifying';
  if (quali) { // unrated: no score, strip or tips, since they gave the grid away
    assert.ok(e.score === null && e.advice === null && e.segments.length === 0, `${e.id}: qualifying must be unrated`);
  } else assert.ok(typeof e.score === 'number' && e.score >= 0 && e.score <= 10, `${e.id}: score ${e.score} is not 0–10`);
  if ('limited' in e) assert.equal(e.limited, true, `${e.id}: limited is only ever true`);
  const allowed = [...ALLOWED.common, ...ALLOWED[e.sport]];
  for (const key of Object.keys(e)) assert.ok(allowed.includes(key), `${e.id}: unexpected field "${key}"`);
  if (!quali) {
    assert.ok(ADVICE_CODES.includes(e.advice.code), `${e.id}: advice ${e.advice.code}`);
    assert.deepEqual(Object.keys(e.advice).filter((k) => !['code', 'unit', 'ranges'].includes(k)), []);
  }
  if (e.advice?.code === 'skip') {
    assert.ok(e.advice.ranges.length >= 1 && e.advice.ranges.length <= 3);
    assert.ok(e.advice.ranges.every(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a <= b));
    if (e.advice.unit === 'min') assert.ok(e.advice.ranges.every(([, b]) => b <= 75), `${e.id}: skips the ending`);
    if (e.advice.unit === 'set') assert.ok(e.advice.ranges.every(([, b]) => b <= 2), `${e.id}: skips a set that may not exist`);
    if (e.advice.unit === 'stage') assert.ok(e.advice.ranges.every(([, b]) => b <= e.segments.length - 2), `${e.id}: skips the last shooting or the finish`);
    if (e.advice.unit === 'leg') assert.ok(e.advice.ranges.every(([, b]) => b <= e.segments.length - 1), `${e.id}: skips the last leg`);
    if (e.advice.unit === 'run') assert.deepEqual(e.advice.ranges, [[1, 1]], `${e.id}: only run 1 can be skipped`);
  }
  assert.ok(e.segments.every((s) => Number.isInteger(s) && s >= 0 && s <= 3));
  if (e.sport === 'football') assert.equal(e.segments.length, 6, 'fixed length, so extra time is not revealed');
  if (e.sport === 'tennis') assert.equal(e.segments.length, 0, 'no strip, so the number of sets is not revealed');
  if (e.sport === 'winter') {
    const expected = e.comp === 'biathlon' ? (/relay/i.test(e.race) ? 4 : /sprint/i.test(e.race) ? 3 : 5) : e.comp === 'alpine' && /slalom/i.test(e.race) ? 2 : 0;
    assert.equal(e.segments.length, expected, `${e.id}: the strip length must only depend on the race type`);
    assert.ok(['women', 'men', 'mixed'].includes(e.gender));
  }
  if (e.sport === 'f1' && !quali) assert.equal(e.segments.length, 10, 'fixed length, so a shortened race is not revealed');
  if ('session' in e) assert.ok(['qualifying', 'sprint', 'sprint-qualifying'].includes(e.session), `${e.id}: session ${e.session}`);
  const text = JSON.stringify({ ...e, id: '', start: '', lineups: '', links: '' }); // line-ups and links are checked above
  assert.doesNotMatch(text, /\d+\s*[-–:]\s*\d+/, `${e.id}: looks like a score`);
  assert.doesNotMatch(text, BANNED_WORDS, `${e.id}: spoiler word`);
}

test('published football, tennis and F1 events contain only safe fields', () => {
  const comp = { key: 'fifa.world', name: 'World Cup' };
  const summary = fixture('football/760516.json');
  const match = { espnId: '760516', start: '2026-07-18T19:00Z', home: 'France', away: 'England' };
  checkEvent(publishFootball(comp, match, scoreFootball(factsFromSummary(summary))));

  for (const m of matchesFromSlam(fixture('tennis/usopen2026.json').events[0])) checkEvent(publishTennis(m, scoreTennis(m)));

  const { race, d } = fixture('f1/british-grand-prix-2025.json');
  checkEvent(publishF1(race, scoreF1(factsFromRace(d))));

  for (const name of ['sprint-china-2026', 'sprint-qatar-2025']) {
    const { race: sprint, d: sd } = fixture(`f1/${name}.json`);
    const e = publishF1(sprint, scoreF1(factsFromRace(sd), { sprint: true }));
    checkEvent(e);
    assert.equal(e.session, 'sprint');
  }
  const sq = { sessionKey: 5, name: 'Chinese Grand Prix', circuit: 'Shanghai', start: '2026-03-13T07:30Z', session: 'sprint-qualifying' };
  checkEvent(publishF1(sq, scoreQuali(factsFromQuali(fixture('f1/qualifying-japan-2026.json').d))));
  checkEvent(publishF1({ ...sq, session: 'race' }, scoreF1(factsFromRace(d))));

  for (const name of ['qualifying-hungary-2025', 'qualifying-japan-2026']) {
    const q = { sessionKey: 9924, name: 'Hungarian Grand Prix', circuit: 'Hungaroring', start: '2025-08-02T14:00Z', session: 'qualifying' };
    const e = publishF1(q, scoreQuali(factsFromQuali(fixture(`f1/${name}.json`).d)));
    checkEvent(e);
    assert.equal(e.session, 'qualifying');
  }
});

test('line-ups: only the starters, and only once both teams have 11', () => {
  const summary = fixture('football/lineups-401861093.json');
  const lineups = lineupsFromSummary(summary);
  const comp = { key: 'uefa.nations', name: 'Nations League' };
  const match = { espnId: '401861093', start: '2026-10-01T16:00Z', home: 'Azerbaijan', away: 'Liechtenstein', state: 'pre' };
  const soon = upcomingFootball(comp, match, { lineups });
  checkUpcoming(soon);
  assert.deepEqual(soon.lineups.map((t) => t.formation), ['4-2-3-1', '5-3-2']);
  assert.deepEqual(soon.lineups[0].players[0], ['1', 'Emil Balayev', 'G'], 'goalkeeper first');
  assert.deepEqual(soon.lineups[1].players.slice(1, 6).map((p) => p[2]), ['LB', 'CD-L', 'CD', 'CD-R', 'RB'], 'defence left to right');
  assert.equal(soon.lineups[0].players.at(-1)[2], 'F', 'attack last');
  assert.ok(!JSON.stringify(soon).includes('SUB'), 'no position on the bench');
  assert.equal(soon.lineups[0].bench.length, 12);
  assert.deepEqual(soon.lineups[0].bench[0], ['2', 'Edqar Adilxanov'], 'bench sorted by shirt number');

  // After the match, ESPN marks who came on; none of that gets out, and the bench order stays the same.
  const after = structuredClone(summary);
  for (const r of after.rosters) r.roster.forEach((p, i) => Object.assign(p, { subbedIn: !p.starter && i % 2 === 0, subbedOut: p.starter && i % 3 === 0 }));
  after.rosters[0].roster.reverse();
  assert.deepEqual(upcomingFootball(comp, match, { lineups: lineupsFromSummary(after) }).lineups.map((t) => t.bench), soon.lineups.map((t) => t.bench));

  // A real finished match: the replay shows its line-ups, never who came on.
  const finished = fixture('football/401861083.json');
  const bulgaria = publishFootball(comp, { ...match, espnId: '401861083' }, scoreFootball(factsFromSummary(finished)), { lineups: lineupsFromSummary(finished) });
  checkEvent(bulgaria);
  assert.equal(bulgaria.lineups[0].bench.length, 12);
  assert.doesNotMatch(JSON.stringify(bulgaria), /subbed|replaces| on for /i);

  const replay = publishFootball(comp, match, scoreFootball(factsFromSummary(fixture('football/760516.json'))), { lineups });
  checkEvent(replay);
  assert.deepEqual(replay.lineups, soon.lineups);

  // Not announced yet (empty rosters), or only one team: no line-ups at all.
  assert.equal(lineupsFromSummary({ rosters: summary.rosters.map((r) => ({ ...r, roster: [] })) }), null);
  assert.equal(lineupsFromSummary({ rosters: [summary.rosters[0]] }), null);
  assert.equal(lineupsFromSummary({}), null);
  assert.ok(!('lineups' in upcomingFootball(comp, match, { lineups: null })));
});

test('pre-match hints: codes only; the forecast never reaches a replay', () => {
  const comp = { key: 'nor.1', name: 'Eliteserien' };
  const match = { espnId: '401843455', start: '2026-10-09T17:00Z', home: 'SK Brann', away: 'Viking FK', state: 'pre' };
  const soon = upcomingFootball(comp, match, { stakes: 'title', forecast: 'lively', outlook: 'promising', chances: { home: 0.5, draw: 0.3, away: 0.2 } });
  checkUpcoming(soon);
  assert.deepEqual(soon.chances, [50, 30, 20]);
  assert.equal(soon.outlook, 'promising');
  assert.equal(soon.stakes, 'title');
  assert.equal(soon.forecast, 'lively');
  const odd = upcomingFootball(comp, match, { stakes: 'Title race 2-1', forecast: 0.42 });
  assert.ok(!('stakes' in odd) && !('forecast' in odd), 'unknown values are dropped');
  assert.deepEqual(upcomingFootball(comp, match, { chances: { home: 0.453, draw: 0.268, away: 0.279 } }).chances, [45, 27, 28], 'win chances as whole percentages');
  assert.ok(!('chances' in upcomingFootball(comp, match, { chances: { home: 0.5, draw: null, away: 0.2 } })), 'incomplete chances are dropped');
  const replay = publishFootball(comp, match, scoreFootball({ ...factsFromSummary(fixture('football/760516.json')), stakes: 'title' }), { stakes: 'title', forecast: 'lively', outlook: 'promising', chances: { home: 0.5, draw: 0.3, away: 0.2 } });
  checkEvent(replay);
  assert.ok(!('chances' in replay), 'no win chances on a replay');
  assert.equal(replay.stakes, 'title');
  assert.ok(!('forecast' in replay));
});

test('tennis players are listed alphabetically, not winner-last', () => {
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  const published = matches.map((m) => publishTennis(m, scoreTennis(m)));
  assert.ok(published.every((e) => e.players[0].localeCompare(e.players[1]) <= 0));
});

export function checkUpcoming(e) {
  const allowed = ['id', 'sport', 'comp', 'compName', 'start', 'status', 'services', 'links', ...ALLOWED[e.sport], ...(e.sport === 'football' ? ['forecast', 'outlook', 'chances'] : [])];
  for (const key of Object.keys(e)) assert.ok(allowed.includes(key), `${e.id}: unexpected field "${key}" on an upcoming event`);
  assert.ok(['upcoming', 'live'].includes(e.status));
  checkLineups(e);
  checkLinks(e);
  checkHints(e);
  const text = JSON.stringify({ ...e, id: '', start: '', lineups: '', links: '' });
  assert.doesNotMatch(text, /\d+\s*[-–:]\s*\d+/, `${e.id}: looks like a score`);
}

test('upcoming events carry no score, only when and where', () => {
  const comp = { key: 'eng.1', name: 'Premier League' };
  checkUpcoming(upcomingFootball(comp, { espnId: '1', start: '2026-10-10T14:00Z', home: 'A', away: 'B', state: 'in' }));
  checkUpcoming(upcomingTennis({ espnId: '2', tournament: 'US Open', draw: "Men's Singles", round: 'Final', start: '2026-09-13T20:00Z', players: ['Zed', 'Abe'], live: false }));
  checkUpcoming(upcomingF1({ sessionKey: 3, name: 'Mexico City Grand Prix', circuit: 'Mexico City', start: '2026-11-01T20:00Z', live: false }));
  checkUpcoming(upcomingF1({ sessionKey: 4, name: 'Mexico City Grand Prix', circuit: 'Mexico City', start: '2026-10-31T21:00Z', live: false, session: 'qualifying' }));
  assert.deepEqual(upcomingTennis({ espnId: '2', tournament: 'x', draw: 'x', round: 'x', start: 'x', players: ['Zed', 'Abe'] }).players, ['Abe', 'Zed']);
});

test('the real docs/data/events.json is spoiler-free', { skip: !existsSync(new URL('../docs/data/events.json', import.meta.url)) }, () => {
  const data = JSON.parse(readFileSync(new URL('../docs/data/events.json', import.meta.url)));
  assert.deepEqual(Object.keys(data).filter((k) => k !== 'elo').sort(), ['events', 'generated', 'upcoming']); // elo: since football 16
  // Elo: one whole number per football team on the page, nothing else.
  const teams = new Set([...data.events, ...data.upcoming].flatMap((e) => (e.sport === 'football' ? e.teams : [])));
  for (const [team, elo] of Object.entries(data.elo ?? {})) {
    assert.ok(teams.has(team), `elo for ${team}, who isn't on the page`);
    assert.ok(Number.isInteger(elo) && elo > 500 && elo < 2500, `elo ${team}: ${elo}`);
  }
  for (const e of data.events) checkEvent(e);
  for (const e of data.upcoming) checkUpcoming(e);
  const scored = new Set(data.events.map((e) => e.id));
  assert.ok(data.upcoming.every((e) => !scored.has(e.id)), 'an event is both scored and upcoming');
});

test('winter races: no athlete names, only safe fields, strips of fixed length', () => {
  const race = (comp, name, extra = {}) => ({ id: `x-${name}`, comp, name, place: 'Oberhof', country: 'GER', series: 'World Cup', gender: 'women', start: '2026-01-08T13:30:00Z', ...extra });
  for (const f of ['biathlon-annecy-2025-women-mass-start', 'biathlon-oberhof-2026-women-sprint', 'biathlon-ruhpolding-2026-women-relay']) {
    const { r, d } = fixture(`winter/${f}.json`);
    const e = publishWinter(race('biathlon', r.name), 'Biathlon', scoreBiathlon(biathlonFacts(r, d)));
    checkEvent(e);
    for (const row of d.results.slice(0, 5)) assert.doesNotMatch(JSON.stringify(e), new RegExp(row.Name.split(' ')[0], 'i'), 'no athlete names');
  }
  for (const f of ['alpine-gurgl-2025-men-slalom', 'alpine-levi-2025-women-slalom', 'alpine-val-di-fassa-2026-women-downhill']) {
    const { race: r, html } = fixture(`winter/${f}.json`);
    const page = fis.resultFromPage(html);
    const e = publishWinter(race('alpine', `Women's ${r.discipline.toLowerCase()}`), 'Alpine', scoreAlpine(fis.alpineFacts(page)));
    checkEvent(e);
    assert.doesNotMatch(JSON.stringify(e), new RegExp(page.rows[0].name.split(' ')[0], 'i'));
  }
  const { race: cc, html } = fixture('winter/cross-country-oslo-2026-men-50km.json');
  checkEvent(publishWinter(race('cross-country', "Men's 50 km mass start free"), 'Cross-country', scoreCrossCountry(fis.crossCountryFacts(fis.resultFromPage(html), cc.discipline))));
  checkUpcoming(upcomingWinter({ ...race('biathlon', "Women's 10 km pursuit"), live: false }, 'Biathlon'));
});

test('winter streaming rights depend on the venue, the season and the series', () => {
  assert.deepEqual(servicesFor('alpine', { country: 'NOR', series: 'World Cup', start: '2027-03-06T10:00Z' }), ['nrk']);
  assert.deepEqual(servicesFor('alpine', { country: 'SUI', series: 'World Championships', start: '2027-02-06T10:00Z' }), ['nrk']);
  assert.deepEqual(servicesFor('alpine', { country: 'FRA', series: 'World Cup', start: '2026-12-12T10:00Z' }), ['tv2play', 'viaplay']);
  assert.deepEqual(servicesFor('alpine', { country: 'FRA', series: 'World Cup', start: '2026-01-12T10:00Z' }), ['viaplay'], 'last season: Viaplay');
  assert.deepEqual(servicesFor('cross-country', { country: 'SWE', series: 'World Championships', start: '2027-02-20T10:00Z' }), ['tv2play']);
  assert.deepEqual(servicesFor('biathlon', { country: 'ITA', series: 'Olympics', start: '2026-02-10T10:00Z' }), ['nrk', 'hbomax']);
  assert.deepEqual(servicesFor('biathlon', { country: 'FIN', series: 'World Cup', start: '2026-11-28T10:00Z' }), ['nrk', 'tv2play']);
  assert.deepEqual(servicesFor('eng.1'), ['viaplay'], 'entries without rules work as before');
});

// Calendar feeds: when and where only. A replay's rating, score or result never goes in.
function checkIcs(text, name) {
  const fields = text.replace(/\r\n /g, '').split('\r\n').filter((l) => /^(SUMMARY|DESCRIPTION|LOCATION):/.test(l)).join('\n');
  assert.doesNotMatch(fields, /\d+\s*[-–:]\s*\d+/, `${name}: looks like a score`);
  assert.doesNotMatch(fields, BANNED_WORDS, `${name}: spoiler word`);
  assert.doesNotMatch(fields, /forecast|one-sided|lively|even on paper|promising|quiet|\b\d+\.\d\b/i, `${name}: a forecast or a rating`);
  for (const line of text.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, `${name}: line too long`);
}

test('calendar feeds: kick-off and where to watch, nothing else', () => {
  const comp = { key: 'nor.1', name: 'Eliteserien' };
  const replay = publishFootball(comp, { espnId: '760516', start: '2026-09-20T16:00Z', home: 'Bodo/Glimt', away: 'Brann' },
    scoreFootball(factsFromSummary(fixture('football/760516.json'))), { stakes: 'title' });
  const soon = upcomingFootball(comp, { espnId: '2', start: '2026-10-10T16:00Z', home: 'Bodo/Glimt', away: 'Kristiansund BK', state: 'pre' }, { stakes: 'title', forecast: 'one-sided' });
  const ics = icsForTeam('Bodo/Glimt', [soon, replay]);
  checkIcs(ics, 'test feed');
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART:20261010T160000Z/);
  assert.match(ics, /SUMMARY:Bodo\/Glimt – Kristiansund BK/);
  assert.match(ics, /LOCATION:TV 2 Play/);
  assert.equal(ics, icsForTeam('Bodo/Glimt', [replay, soon]), 'same input, same file (no churn)');
  assert.equal(icsForTeam('Nobody', []).includes('BEGIN:VEVENT'), false);
});

test('the real calendar feeds are spoiler-free', { skip: !existsSync(new URL('../docs/cal/', import.meta.url)) }, () => {
  const dir = new URL('../docs/cal/', import.meta.url);
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ics'))) checkIcs(readFileSync(new URL(f, dir), 'utf8'), f);
});
