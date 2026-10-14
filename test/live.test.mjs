// Live football: the clock and "Excitement so far" (docs/live.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clockOf, liveClockText, elapsedText, espnDays, liveFacts, scoreLivePace, liveWeightsFrom, LIVE_FROM, curve } from '../docs/live.js';
import * as WEIGHTS from '../src/scoring/weights.mjs';
import { SCORING_VERSIONS, fingerprint } from '../src/scoring/common.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const w = liveWeightsFrom(WEIGHTS.FOOTBALL, WEIGHTS.FOOTBALL_LIVE);
const st = (name, state, extra) => ({ type: { name, state }, ...extra });

test('clockOf reads ESPN statuses', () => {
  assert.deepEqual(clockOf(st('STATUS_FIRST_HALF', 'in', { clock: 2280, displayClock: "38'", period: 1 })), { min: 38, plus: 0, period: 1, paused: false });
  assert.deepEqual(clockOf(st('STATUS_FIRST_HALF', 'in', { clock: 2700, displayClock: "45'+2'", period: 1 })), { min: 45, plus: 2, period: 1, paused: false });
  assert.deepEqual(clockOf(st('STATUS_FIRST_HALF', 'in', { displayClock: "45'+2'", period: 1 })), { min: 45, plus: 2, period: 1, paused: false });
  assert.equal(clockOf(st('STATUS_HALFTIME', 'in', { clock: 2700, displayClock: 'HT', period: 1 })).paused, true);
  assert.deepEqual(clockOf(st('STATUS_SECOND_HALF', 'in', { clock: 3000, displayClock: "50'", period: 2 })), { min: 50, plus: 0, period: 2, paused: false });
  assert.equal(clockOf(st('STATUS_FULL_TIME', 'post', { clock: 5400, displayClock: "90'+6'", period: 2 })), null);
  assert.equal(clockOf(st('STATUS_SCHEDULED', 'pre', { clock: 0, period: 0 })), null);
  assert.equal(clockOf(undefined), null);
});

test('liveClockText counts up between updates, and stops at the end of a half', () => {
  const at = '2026-10-10T15:00:00.000Z';
  const t = (min) => Date.parse(at) + min * 60e3;
  const c = (min, period, extra) => ({ min, plus: 0, period, paused: false, at, ...extra });
  assert.equal(liveClockText(c(38, 1), t(0)), "38'");
  assert.equal(liveClockText(c(38, 1), t(4.5)), "42'");
  assert.equal(liveClockText(c(43, 1), t(1)), "44'");
  assert.equal(liveClockText(c(43, 1), t(2)), "45+'"); // never "45+0'"
  assert.equal(liveClockText(c(44, 1, { plus: 0 }), t(2.5)), "45+'");
  assert.equal(liveClockText(c(30, 1, { paused: true }), t(1)), 'Paused'); // a delay mid-half is not half-time
  assert.equal(liveClockText(c(43, 1), t(5)), "45+'"); // stoppage time unknown: don't guess
  assert.equal(liveClockText(c(45, 1, { plus: 2 }), t(0)), "45+2'");
  assert.equal(liveClockText(c(88, 2), t(8)), "90+'");
  assert.equal(liveClockText(c(45, 1, { paused: true }), t(3)), 'HT');
  assert.equal(liveClockText(c(90, 3, { paused: true }), t(3)), 'Break');
  assert.equal(liveClockText(c(120, 5, { paused: true }), t(3)), 'Pens');
  assert.equal(liveClockText(c(38, 1), t(25)), ''); // too old to trust
  assert.equal(liveClockText(null), '');
});

test('liveFacts: own goals are only flipped when that makes the score match', () => {
  const summary = (score, own) => ({
    header: { competitions: [{ status: { type: { state: 'in' }, period: 2, displayClock: "60'" }, competitors: [
      { homeAway: 'home', score: String(score[0]), team: { id: 'h' } }, { homeAway: 'away', score: String(score[1]), team: { id: 'a' } }] }] },
    keyEvents: [{ scoringPlay: true, team: { id: own }, type: { text: 'Own Goal' }, period: { number: 2 }, clock: { value: 3000 } }],
  });
  assert.equal(liveFacts(summary([1, 0], 'h')).goals[0].side, 'home'); // credited right
  assert.equal(liveFacts(summary([1, 0], 'a')).goals[0].side, 'home'); // credited to the wrong team: flipped
  // The score already shows a second goal that isn't in the events yet: leave the own goal alone.
  assert.equal(liveFacts(summary([1, 1], 'h')).goals[0].side, 'home');
});

test('elapsedText: time since the start for F1 and winter cards', () => {
  const start = '2026-10-10T14:00:00Z';
  assert.equal(elapsedText(start, Date.parse(start) + 23 * 60e3), '23 min');
  assert.equal(elapsedText(start, Date.parse(start) + 83 * 60e3), '1 h 23');
  assert.equal(elapsedText(start, Date.parse(start) + 61 * 60e3), '1 h 01');
  assert.equal(elapsedText(start, Date.parse(start) - 60e3), '');
});

test('espnDays also looks under the day before for early kick-offs (US Eastern days)', () => {
  assert.deepEqual(espnDays('2026-10-10T20:00Z'), ['20261010']);
  assert.deepEqual(espnDays('2026-10-11T01:00Z'), ['20261011', '20261010']);
});

test('excitement so far: none before 15 minutes, rough before 30, always 0–10', () => {
  const facts = (played, goals = [], on = 2, off = 4) => ({ played, goals, reds: 0, pens: 0, disallowed: 0, woodwork: 0, shotsOn: on, shotsOff: off });
  assert.equal(scoreLivePace(facts(LIVE_FROM - 1), { w }), null);
  assert.equal(scoreLivePace(facts(20), { w }).rough, true);
  assert.equal(scoreLivePace(facts(40), { w }).rough, false);
  // A goalless, quiet match sinks as it goes on; early on it stays near a typical match.
  const quiet = [20, 45, 90].map((m) => scoreLivePace(facts(m, [], 1, 3), { w }).pace);
  assert.ok(quiet[0] > quiet[1] && quiet[1] > quiet[2], `quiet: ${quiet}`);
  // The same pace of goals counts for more once there's more of the match to go on.
  const early = scoreLivePace(facts(20, [{ min: 8, side: 'home' }, { min: 16, side: 'away' }], 3, 4), { w }).pace;
  const later = scoreLivePace(facts(60, [{ min: 24, side: 'home' }, { min: 48, side: 'away' }, { min: 50, side: 'home' }, { min: 55, side: 'away' }, { min: 57, side: 'home' }, { min: 59, side: 'away' }], 9, 12), { w }).pace;
  assert.ok(later > early, `${early} vs ${later}`);
  // Big matches count for more, and nothing goes above 10.
  const f = facts(80, Array.from({ length: 9 }, (_, i) => ({ min: 5 + 8 * i, side: i % 2 ? 'away' : 'home' })), 20, 20);
  assert.ok(scoreLivePace(f, { w, factor: 1.2 }).pace <= 10);
  assert.ok(scoreLivePace(facts(60, [], 5, 5), { w, factor: 1.2 }).pace > scoreLivePace(facts(60, [], 5, 5), { w, factor: 0.8 }).pace);
});

test('excitement so far at 90 minutes is close to the replay score for known matches', () => {
  const at90 = (id) => scoreLivePace({ ...liveFacts(fixture(`football/${id}.json`)), played: 90 }, { w }).pace;
  assert.ok(at90(760516) >= 7, 'France 4–6 England'); // a thriller
  assert.ok(at90(401861083) <= 4, 'Bulgaria 0–0 Estonia'); // a dud
  assert.ok(at90(760516) > at90(401879276) + 3, 'France–England well above Bournemouth 0–1 Liverpool');
});

test('excitement so far (football 19): suspense from the odds, a red card for the team ahead, your pillar mix', () => {
  const facts = (goals, redsBy = []) => ({ played: 70, goals, reds: redsBy.length, redsBy, pens: 0, disallowed: 0, woodwork: 0, shotsOn: 4, shotsOff: 6 });
  const fav = { home: 0.75, draw: 0.17, away: 0.08 };
  // 1–0 to the underdog is more open than 1–0 to the favorite.
  const dog = scoreLivePace(facts([{ min: 20, side: 'away' }]), { w, odds: fav }).pace;
  const top = scoreLivePace(facts([{ min: 20, side: 'home' }]), { w, odds: fav }).pace;
  assert.ok(dog > top, `${dog} > ${top}`);
  // A red for the team ahead counts more than one for the team behind.
  const ahead = scoreLivePace(facts([{ min: 20, side: 'home' }], [{ min: 50, side: 'home' }]), { w }).pace;
  const behind = scoreLivePace(facts([{ min: 20, side: 'home' }], [{ min: 50, side: 'away' }]), { w }).pace;
  assert.ok(ahead > behind);
  // The mix from the page (a + k·points) is applied before the stakes and the curve; { a: 0, k: 1 } changes nothing.
  const f = facts([{ min: 20, side: 'home' }]);
  assert.equal(scoreLivePace(f, { w, mix: { a: 0, k: 1 } }).pace, scoreLivePace(f, { w }).pace);
  assert.ok(scoreLivePace(f, { w, mix: { a: 1, k: 1 } }).pace > scoreLivePace(f, { w }).pace);
});

test('the live weights never re-score replays', () => {
  assert.equal(SCORING_VERSIONS.football.split('.')[1], fingerprint(WEIGHTS.FOOTBALL));
  assert.equal(curve(4, 5), 4);
  assert.ok(Math.abs(curve(8, 5) - 7.3) < 0.05);
});
