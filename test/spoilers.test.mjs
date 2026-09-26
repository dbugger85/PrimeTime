// The most important test: nothing the website receives may give away a result.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { factsFromSummary } from '../src/sources/espn-football.mjs';
import { matchesFromSlam } from '../src/sources/espn-tennis.mjs';
import { factsFromRace } from '../src/sources/openf1.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1 } from '../src/scoring/f1.mjs';
import { publishFootball, publishTennis, publishF1, upcomingFootball, upcomingTennis, upcomingF1, ADVICE_CODES } from '../src/publish.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));

const ALLOWED = {
  common: ['id', 'sport', 'comp', 'compName', 'start', 'score', 'segments', 'advice', 'services', 'v'],
  football: ['teams'],
  tennis: ['players', 'draw', 'round'],
  f1: ['circuit'],
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
  }
  assert.ok(e.segments.every((s) => Number.isInteger(s) && s >= 0 && s <= 3));
  if (e.sport === 'football') assert.equal(e.segments.length, 6, 'fixed length, so extra time is not revealed');
  if (e.sport === 'tennis') assert.equal(e.segments.length, 0, 'no strip, so the number of sets is not revealed');
  if (e.sport === 'f1') assert.equal(e.segments.length, 10, 'fixed length, so a shortened race is not revealed');
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
