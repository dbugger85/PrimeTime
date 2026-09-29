// The most important test: nothing the website receives may give away a result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { factsFromSummary } from '../src/sources/espn-football.mjs';
import { matchesFromSlam } from '../src/sources/espn-tennis.mjs';
import { factsFromRace, factsFromQuali } from '../src/sources/openf1.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1, scoreQuali } from '../src/scoring/f1.mjs';
import { publishFootball, publishTennis, publishF1, publishWinter, upcomingFootball, upcomingTennis, upcomingF1, upcomingWinter, servicesFor, ADVICE_CODES } from '../src/publish.mjs';
import { factsFromRace as biathlonFacts } from '../src/sources/ibu.mjs';
import * as fis from '../src/sources/fis.mjs';
import { scoreBiathlon, scoreAlpine, scoreCrossCountry } from '../src/scoring/winter.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));

const ALLOWED = {
  common: ['id', 'sport', 'comp', 'compName', 'start', 'score', 'segments', 'advice', 'services', 'v'],
  football: ['teams'],
  tennis: ['players', 'draw', 'round'],
  f1: ['circuit', 'session'],
  winter: ['race', 'place', 'series', 'gender'],
};
const BANNED_WORDS = /\b(won|win|winner|beat|lost|loses?|comeback|equali[sz]|decider|deciding|upset|late|drama|red flag|safety car|penalt|shootout|extra time|retire|walkover|thriller|collapse|goals?)\b/i;

export function checkEvent(e) {
  const allowed = [...ALLOWED.common, ...ALLOWED[e.sport]];
  for (const key of Object.keys(e)) assert.ok(allowed.includes(key), `${e.id}: unexpected field "${key}"`);
  assert.ok(ADVICE_CODES.includes(e.advice.code), `${e.id}: advice ${e.advice.code}`);
  assert.deepEqual(Object.keys(e.advice).filter((k) => !['code', 'unit', 'ranges'].includes(k)), []);
  if (e.advice.code === 'skip') {
    assert.ok(e.advice.ranges.length >= 1 && e.advice.ranges.length <= 3);
    assert.ok(e.advice.ranges.every(([a, b]) => Number.isInteger(a) && Number.isInteger(b) && a <= b));
    if (e.advice.unit === 'min') assert.ok(e.advice.ranges.every(([, b]) => b <= 75), `${e.id}: skips the ending`);
    if (e.advice.unit === 'set') assert.ok(e.advice.ranges.every(([, b]) => b <= 2), `${e.id}: skips a set that may not exist`);
    if (e.advice.unit === 'stage') assert.ok(e.advice.ranges.every(([, b]) => b <= e.segments.length - 2), `${e.id}: skips the last shooting or the finish`);
    if (e.advice.unit === 'leg') assert.ok(e.advice.ranges.every(([, b]) => b <= e.segments.length - 1), `${e.id}: skips the last leg`);
    if (e.advice.unit === 'run') assert.deepEqual(e.advice.ranges, [[1, 1]], `${e.id}: only run 1 can be skipped`);
    if (e.advice.unit === 'part') assert.ok(e.sport === 'f1' && e.advice.ranges.every(([, b]) => b <= 2), `${e.id}: skips Q3, where pole is decided`);
  }
  assert.ok(e.segments.every((s) => Number.isInteger(s) && s >= 0 && s <= 3));
  if (e.sport === 'football') assert.equal(e.segments.length, 6, 'fixed length, so extra time is not revealed');
  if (e.sport === 'tennis') assert.equal(e.segments.length, 0, 'no strip, so the number of sets is not revealed');
  if (e.sport === 'winter') {
    const expected = e.comp === 'biathlon' ? (/relay/i.test(e.race) ? 4 : /sprint/i.test(e.race) ? 3 : 5) : e.comp === 'alpine' && /slalom/i.test(e.race) ? 2 : 0;
    assert.equal(e.segments.length, expected, `${e.id}: the strip length must only depend on the race type`);
    assert.ok(['women', 'men', 'mixed'].includes(e.gender));
  }
  const quali = e.session === 'qualifying' || e.session === 'sprint-qualifying';
  if (e.sport === 'f1' && !quali) assert.equal(e.segments.length, 10, 'fixed length, so a shortened race is not revealed');
  if (quali) assert.equal(e.segments.length, 3, 'Q1, Q2, Q3');
  if ('session' in e) assert.ok(['qualifying', 'sprint', 'sprint-qualifying'].includes(e.session), `${e.id}: session ${e.session}`);
  const text = JSON.stringify({ ...e, id: '', start: '' });
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

test('tennis players are listed alphabetically, not winner-last', () => {
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  const published = matches.map((m) => publishTennis(m, scoreTennis(m)));
  assert.ok(published.every((e) => e.players[0].localeCompare(e.players[1]) <= 0));
});

export function checkUpcoming(e) {
  const allowed = ['id', 'sport', 'comp', 'compName', 'start', 'status', 'services', ...ALLOWED[e.sport]];
  for (const key of Object.keys(e)) assert.ok(allowed.includes(key), `${e.id}: unexpected field "${key}" on an upcoming event`);
  assert.ok(['upcoming', 'live'].includes(e.status));
  const text = JSON.stringify({ ...e, id: '', start: '' });
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
  assert.deepEqual(Object.keys(data).sort(), ['events', 'generated', 'upcoming']);
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
