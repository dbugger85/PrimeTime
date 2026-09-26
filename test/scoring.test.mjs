// Checks the scores against real matches we know the feel of.
// If you change a formula, these should still pass (or be updated on purpose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factsFromSummary } from '../src/sources/espn-football.mjs';
import { matchesFromSlam } from '../src/sources/espn-tennis.mjs';
import { factsFromRace } from '../src/sources/openf1.mjs';
import { scoreFootball, footballAdvice } from '../src/scoring/football.mjs';
import { scoreTennis, tennisAdvice } from '../src/scoring/tennis.mjs';
import { scoreF1 } from '../src/scoring/f1.mjs';
import { firstWorthWatching, heat } from '../src/scoring/common.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const fb = (id) => scoreFootball(factsFromSummary(fixture(`football/${id}.json`)));
const race = (slug) => scoreF1(factsFromRace(fixture(`f1/${slug}.json`).d));

test('football: thrillers score high, routine wins score low', () => {
  const franceEngland64 = fb(760516); // WC 2026, 4-6 with goals at 87', 90', 90'
  const mexicoEngland23 = fb(760505); // five goals, lead changes
  const norwayEnglandAet = fb(760512); // extra-time winner
  const bournemouthLiverpool01 = fb(401879276);
  const franceSweden30 = fb(760492);
  assert.ok(franceEngland64.score >= 9, `4-6 got ${franceEngland64.score}`);
  assert.ok(mexicoEngland23.score >= 8);
  assert.ok(norwayEnglandAet.score >= 8);
  assert.ok(bournemouthLiverpool01.score < 5);
  assert.ok(franceSweden30.score < 6);
  assert.ok(franceSweden30.score < mexicoEngland23.score);
});

test('football: a 0-0 decided on penalties beats a plain 1-0 but is not a thriller', () => {
  const pens00 = fb(760508).score;
  assert.ok(pens00 < 7, `got ${pens00}`);
});

test('football: scores stay within 0–10 with one decimal', () => {
  for (const id of [401879276, 760489, 760492, 760493, 760505, 760508, 760512, 760514, 760516]) {
    const { score, segments } = fb(id);
    assert.ok(score >= 0 && score <= 10);
    assert.equal(Math.round(score * 10) / 10, score);
    assert.equal(segments.length, 6);
  }
});

test('football advice: never later than 75, full for great matches, highlights for dull', () => {
  assert.deepEqual(footballAdvice(2, [0, 0, 0, 0, 0, 5]), { code: 'highlights' });
  assert.deepEqual(footballAdvice(9, [0, 0, 0, 0, 0, 5]), { code: 'full' });
  assert.deepEqual(footballAdvice(5, [0, 0, 0, 0, 0, 5]), { code: 'from', min: 75 });
  assert.deepEqual(footballAdvice(5, [0.1, 0.1, 0.1, 3, 2, 2]), { code: 'from', min: 45 });
  assert.deepEqual(footballAdvice(5, [3, 1, 1, 1, 1, 1]), { code: 'full' });
});

test('tennis: five-setters with tiebreaks beat straight-set routs', () => {
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  assert.ok(matches.length > 200);
  const find = (a, b) => matches.find((m) => m.players.includes(a) && m.players.includes(b));
  const rublev = scoreTennis(find('Andrey Rublev', 'Otto Virtanen')); // 6-7 6-7 6-0 6-2 7-6
  const rout = scoreTennis(find('Eva Lys', 'Mirra Andreeva')); // 0-6 2-6
  const retired = scoreTennis(find('Corentin Moutet', 'Dane Sweeny'));
  assert.ok(rublev.score >= 9);
  assert.ok(rout.score <= 2);
  assert.equal(retired.score, 1);
  assert.deepEqual(rublev.segments, []); // no strip: it would reveal the number of sets
});

test('tennis: qualifying and walkovers are left out', () => {
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  assert.ok(matches.every((m) => !/qualifying/i.test(m.round) && m.sets.length > 0));
});

test('tennis advice never points past a set that is always played', () => {
  assert.deepEqual(tennisAdvice(5, [0.1, 0.1, 0.1], 3), { code: 'fromSet', set: 2 });
  assert.deepEqual(tennisAdvice(5, [0.1, 0.1, 0.1, 1, 1], 5), { code: 'fromSet', set: 3 });
  assert.deepEqual(tennisAdvice(5, [0.6, 0.1, 0.1], 3), { code: 'full' });
  assert.deepEqual(tennisAdvice(2, [0.1, 0.1], 3), { code: 'highlights' });
});

test('f1: chaotic wet races beat processions', () => {
  const britain25 = race('british-grand-prix-2025'); // rain, safety cars
  const japan25 = race('japanese-grand-prix-2025'); // lights to flag from pole
  const monaco25 = race('monaco-grand-prix-2025');
  assert.ok(britain25.score >= 8, `Britain got ${britain25.score}`);
  assert.ok(japan25.score <= 3.5, `Japan got ${japan25.score}`);
  assert.ok(monaco25.score <= 5, `Monaco got ${monaco25.score}`);
  assert.equal(britain25.segments.length, 10);
});

test('f1: pit-stop shuffles do not count as overtakes', () => {
  const { d } = fixture('f1/japanese-grand-prix-2025.json');
  const facts = factsFromRace(d);
  assert.ok(facts.overtakes.length < d.overtakes.length / 3);
});

test('helpers: firstWorthWatching and heat', () => {
  assert.equal(firstWorthWatching([0, 0, 1, 1, 1, 1]), 2);
  assert.equal(firstWorthWatching([5, 0, 0]), 0);
  assert.equal(firstWorthWatching([0, 0, 0]), 0);
  assert.deepEqual(heat([0, 1, 2, 3]), [0, 1, 2, 3]);
});
