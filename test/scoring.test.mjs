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
import { scoreF1, f1Advice } from '../src/scoring/f1.mjs';
import { quietRuns, heat } from '../src/scoring/common.mjs';

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

test('football: team strength from the odds, blowouts score low', () => {
  const viking81 = fb(401843437); // Eliteserien, Viking 79% favorites, 8-1
  const bayernBodo50 = fb(401915443); // Champions League, Bayern 89% favorites, 5-0
  const spursVilla23 = fb(401879269); // evenly matched, 2-3
  assert.ok(viking81.score < 5, `8-1 got ${viking81.score}`);
  assert.ok(bayernBodo50.score < 5, `5-0 got ${bayernBodo50.score}`);
  assert.ok(spursVilla23.score >= 9, `even 2-3 got ${spursVilla23.score}`);
  assert.ok(viking81.reasons.some(([, l]) => /favorite/.test(l)), 'the breakdown mentions the favorite');
  // The same match without odds still punishes the blowout, just less.
  const noOdds = scoreFootball({ ...factsFromSummary(fixture('football/401843437.json')), odds: null });
  assert.ok(noOdds.score < 6 && noOdds.score > viking81.score, `8-1 without odds got ${noOdds.score}`);
});

test('football: an upset scores higher than the same result the expected way round', () => {
  const facts = factsFromSummary(fixture('football/760514.json')); // France 0-2 Spain
  const expected = scoreFootball({ ...facts, odds: { home: 0.15, draw: 0.2, away: 0.65 } }).score;
  const upset = scoreFootball({ ...facts, odds: { home: 0.65, draw: 0.2, away: 0.15 } }).score;
  assert.ok(upset >= expected + 1.5, `upset ${upset}, expected ${expected}`);
});

test('football: odds become win chances that add up to 1', () => {
  const o = factsFromSummary(fixture('football/760492.json')).odds; // France -340, draw +500, Sweden +900
  assert.ok(Math.abs(o.home + o.draw + o.away - 1) < 1e-9);
  assert.ok(o.home > 0.7 && o.away < 0.12, JSON.stringify(o));
  assert.equal(factsFromSummary({ ...fixture('football/760492.json'), pickcenter: undefined }).odds, null);
});

test('football: a 0-0 decided on penalties beats a plain 1-0 but is not a thriller', () => {
  const pens00 = fb(760508).score;
  assert.ok(pens00 < 7, `got ${pens00}`);
});

test('football: scores stay within 0–10 with one decimal', () => {
  for (const id of [401843437, 401879269, 401915443, 401879276, 760489, 760492, 760493, 760505, 760508, 760512, 760514, 760516]) {
    const { score, segments } = fb(id);
    assert.ok(score >= 0 && score <= 10);
    assert.equal(Math.round(score * 10) / 10, score);
    assert.equal(segments.length, 6);
  }
});

test('football advice: skip windows anywhere before 75, never the last 15 minutes', () => {
  const slots = (busy) => Array.from({ length: 18 }, (_, i) => (busy.includes(i) ? 3 : 0));
  assert.deepEqual(footballAdvice(2, slots([])), { code: 'highlights' });
  assert.deepEqual(footballAdvice(9.5, slots([])), { code: 'full' });
  // Action at 30' and 60': skip the start and the quiet start of the second half.
  assert.deepEqual(footballAdvice(5, slots([6, 12])), { code: 'skip', unit: 'min', ranges: [[0, 25], [35, 55]] });
  // Quiet all match: still never skip past 75'.
  assert.deepEqual(footballAdvice(5, slots([])), { code: 'skip', unit: 'min', ranges: [[0, 75]] });
  // Busy throughout: watch it all.
  assert.deepEqual(footballAdvice(5, slots([1, 3, 5, 7, 9, 11, 13])), { code: 'full' });
});

test('football advice on real matches stays before 75 minutes', () => {
  for (const id of [401843437, 401879269, 401915443, 401879276, 760489, 760492, 760493, 760505, 760508, 760512, 760514, 760516]) {
    const { advice } = fb(id);
    if (advice.code === 'skip') assert.ok(advice.ranges.every(([a, b]) => a < b && b <= 75), `${id}`);
  }
});

test('f1 advice keeps the start and the last 15% of the race', () => {
  const perLap = new Array(61).fill(0);
  perLap[2] = 5; perLap[30] = 5;
  const a = f1Advice(5, perLap, 60);
  assert.equal(a.code, 'skip');
  assert.ok(a.ranges.every(([x, y]) => x >= 4 && y <= 51 && x <= y));
  assert.deepEqual(a.ranges[0], [4, 28]); // resume a lap before the action at lap 30
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

test('tennis advice only names sets that are always played, never the last of them', () => {
  assert.deepEqual(tennisAdvice(5, [0.1, 0.1, 0.1], 3), { code: 'skip', unit: 'set', ranges: [[1, 1]] });
  assert.deepEqual(tennisAdvice(5, [0.1, 0.3, 0.1, 1, 1], 5), { code: 'skip', unit: 'set', ranges: [[1, 2]] });
  assert.deepEqual(tennisAdvice(5, [0.8, 0.1, 0.1, 1, 1], 5), { code: 'skip', unit: 'set', ranges: [[2, 2]] });
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

test('helpers: quietRuns and heat', () => {
  assert.deepEqual(quietRuns([0, 0, 0, 0, 5, 0, 0], { quiet: 0, minLen: 3 }), [[0, 3]]); // stops 1 before the action
  assert.deepEqual(quietRuns([0, 0, 0, 5, 0, 0, 0, 0], { quiet: 0, minLen: 3 }), [[4, 8]]);
  assert.deepEqual(quietRuns([0, 0, 0, 0, 0, 0], { quiet: 0, minLen: 2, to: 4 }), [[0, 4]]);
  assert.deepEqual(quietRuns([1, 1, 1], { quiet: 0, minLen: 1 }), []);
  assert.deepEqual(heat([0, 1, 2, 3]), [0, 1, 2, 3]);
});

test('football: near misses lift a goalless match', () => {
  const quiet = { goals: [], reds: [], pens: [], vars: [], disallowed: [], woodwork: [], corners: 4, yellows: 1,
    shotsOn: [], shotsOff: [], totalShots: 12, shotsOnTarget: 5, extraTime: false, shootout: false };
  const nearMisses = { ...quiet, disallowed: [30], woodwork: [55, 80], corners: 13, yellows: 7 };
  assert.ok(scoreFootball(nearMisses).score >= scoreFootball(quiet).score + 1.5);
});

test('every score comes with reasons that add up to it (before the 0–10 cap)', () => {
  const check = ({ score, reasons }) => {
    assert.ok(reasons.length > 0);
    assert.ok(reasons.every(([p, label]) => typeof p === 'number' && p !== 0 && typeof label === 'string' && label));
    const sum = reasons.reduce((a, [p]) => a + p, 0);
    assert.ok(Math.abs(Math.min(10, Math.max(0, sum)) - score) <= 0.3, `sum ${sum} vs ${score}`);
  };
  for (const id of [401879276, 760508, 760512, 760516]) check(fb(id));
  for (const m of matchesFromSlam(fixture('tennis/usopen2026.json').events[0]).slice(0, 40)) check(scoreTennis(m));
  for (const slug of ['british-grand-prix-2025', 'japanese-grand-prix-2025']) check(race(slug));
});

test('result lines (only ever shown behind the second spoiler warning)', () => {
  assert.equal(fb(760516).result.text, 'France 4–6 England');
  assert.equal(fb(760489).result.text, 'Germany 1–1 Paraguay (3–4 on penalties)');
  assert.equal(fb(760512).result.text, 'Norway 1–2 England (after extra time)');
  // Football also lists every goal: minute, running score, scorer, team (shootout kicks are left out).
  assert.deepEqual(fb(760505).result.goals, [
    "36' · 0–1 · Jude Bellingham (England)",
    "38' · 0–2 · Jude Bellingham (England)",
    "42' · 1–2 · Julián Quiñones (Mexico)",
    "60' · 1–3 · Harry Kane (England, pen)",
    "69' · 2–3 · Raúl Jiménez (Mexico, pen)",
  ]);
  assert.deepEqual(fb(760512).result.goals.map((g) => g.split(' · ').slice(0, 2).join(' ')), ["36' 1–0", "45+2' 1–1", "93' 1–2"]);
  assert.equal(fb(760489).result.goals.length, 2);
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  const final = matches.find((m) => m.round === 'Final' && m.draw.startsWith('Men'));
  assert.equal(scoreTennis(final).result, 'Alexander Zverev beat Ben Shelton 6-3 7-6(2) 5-7 6-2');
  assert.match(race('british-grand-prix-2025').result, /^1\. .+, 2\. .+, 3\. .+ \(won by \d+\.\d s\)$/);
});
