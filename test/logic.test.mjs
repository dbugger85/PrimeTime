import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tierOf, adviceText, filterEvents, namesHidden, titleOf } from '../docs/logic.js';

const now = Date.parse('2026-09-26T12:00:00Z');
const ev = (o) => ({ services: [], segments: [], advice: { code: 'full' }, compName: 'X', ...o });
const events = [
  ev({ id: 'a', sport: 'football', score: 8.5, start: '2026-09-25T18:00Z', services: ['viaplay'], compName: 'Premier League', teams: ['A', 'B'] }),
  ev({ id: 'b', sport: 'football', score: 3.1, start: '2026-09-24T18:00Z', services: ['tv2play'], compName: 'Eliteserien', teams: ['C', 'D'] }),
  ev({ id: 'c', sport: 'tennis', score: 6.2, start: '2026-09-10T18:00Z', services: ['hbomax'], players: ['E', 'F'], draw: "Women's Singles", round: 'Round 1' }),
  ev({ id: 'd', sport: 'f1', score: 9.9, start: '2026-06-10T18:00Z', services: ['viaplay', 'f1tv'], compName: 'British Grand Prix' }),
];
const base = { sport: 'all', services: [], comp: 'all', days: 400, minScore: 0, sort: 'date' };
const ids = (list) => list.map((e) => e.id).join('');

test('tiers', () => {
  assert.equal(tierOf(9).label, 'Must-watch');
  assert.equal(tierOf(6).label, 'Good');
  assert.equal(tierOf(4.5).label, 'Decent');
  assert.equal(tierOf(1).label, 'Skip it');
});

test('advice text', () => {
  assert.equal(adviceText({ code: 'from', min: 45 }), 'Skip the first half');
  assert.equal(adviceText({ code: 'from', min: 60 }), "Start from 60'");
  assert.equal(adviceText({ code: 'fromSet', set: 3 }), 'Start from set 3');
  assert.equal(adviceText({ code: 'startThen', lap: 25 }), 'Watch the start, then skip to lap 25');
});

test('filters: sport, services, period, rating, competition', () => {
  assert.equal(ids(filterEvents(events, base, new Set(), now)), 'abcd');
  assert.equal(ids(filterEvents(events, { ...base, sport: 'football' }, new Set(), now)), 'ab');
  assert.equal(ids(filterEvents(events, { ...base, services: ['viaplay'] }, new Set(), now)), 'ad');
  assert.equal(ids(filterEvents(events, { ...base, days: 7 }, new Set(), now)), 'ab');
  assert.equal(ids(filterEvents(events, { ...base, minScore: 6 }, new Set(), now)), 'acd');
  assert.equal(ids(filterEvents(events, { ...base, comp: 'Eliteserien' }, new Set(), now)), 'b');
  assert.equal(ids(filterEvents(events, { ...base, hideWatched: true }, new Set(['a']), now)), 'bcd');
});

test('filters: tennis rounds and draw, and sorting by score', () => {
  assert.equal(ids(filterEvents(events, { ...base, round: 'qf' }, new Set(), now)), 'abd');
  assert.equal(ids(filterEvents(events, { ...base, draw: 'men' }, new Set(), now)), 'abd');
  assert.equal(ids(filterEvents(events, { ...base, sort: 'score' }, new Set(), now)), 'dacb');
});

test('names: tennis hidden by default, F1 never hidden', () => {
  assert.equal(namesHidden(events[2], 'tennis'), true);
  assert.equal(namesHidden(events[0], 'tennis'), false);
  assert.equal(namesHidden(events[0], 'all'), true);
  assert.equal(namesHidden(events[3], 'all'), false);
  assert.equal(titleOf(events[0]), 'A – B');
});
