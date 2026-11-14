// Golf: reading ESPN, the tournament card's lines (docs/golf.js), and the schedule card the bot
// publishes. The spoiler checks for golf are in test/spoilers.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLeaderboard, roundsOf, currentRound, roundLine, favoriteLines, backNineAt, cleanName } from '../docs/golf.js';
import { golfCard, readyToScore, shownTournament, seriesOf, withSeries, noteGolfers } from '../src/sources/espn-golf.mjs';
import { upcomingGolf, servicesFor } from '../src/publish.mjs';
import { isFavorite, favNames, titleOf } from '../docs/logic.js';

export const golfFixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/golf/${name}.json`, import.meta.url)));
const austin = () => withSeries(parseLeaderboard(golfFixture('leaderboard-austin-2026-round3')));

// Times in UTC for the tests (the page uses Norwegian time).
export const FMT = (now) => ({
  time: (iso) => iso.slice(11, 16),
  day: (iso) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }),
  isToday: (iso) => iso.slice(0, 10) === new Date(now).toISOString().slice(0, 10),
});

test('the leaderboard: tee times in UTC, totals to par so far, cut and withdrawn players', () => {
  const t = austin();
  assert.equal(t.name, 'Austin Championship', 'the sponsor is left out');
  assert.equal(t.state, 'in');
  assert.equal(t.period, 3);
  assert.equal(t.major, false);
  assert.equal(t.series, 'pga');
  const ramey = t.players.find((p) => p.name === 'Chad Ramey');
  assert.equal(ramey.toPar, -13, 'scoreToPar, not ESPN\'s `score` (finished rounds only)');
  assert.equal(ramey.thru, 14);
  assert.equal(ramey.tees[2], '2026-11-14T15:46Z');
  assert.equal(ramey.tees[3], null, 'round 4 tee times only come once round 3 is over');
  assert.ok(t.players.some((p) => p.status === 'cut') && t.players.some((p) => p.status === 'wd'));
  assert.equal(currentRound(t), 3);
});

test('rounds: days at the course, tee windows, and only the day while the times are not out', () => {
  const r = roundsOf(austin());
  assert.deepEqual(r.map((x) => x.day), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.ok(r[2].first < r[2].last);
  assert.ok(!('first' in r[3]), 'round 4: the day only');
  assert.equal(backNineAt({ last: '2026-11-14T16:41Z' }), '2026-11-14T18:51:00.000Z', 'last tee time plus 2 h 10');
  const before = parseLeaderboard(golfFixture('leaderboard-rsm-2026-before'));
  assert.equal(before.state, 'pre');
  assert.deepEqual(before.players, []);
  assert.ok(roundsOf(before).every((x) => x.day && !x.first), 'no field, no tee times yet: days only');
});

test('the card: one per tournament, about today\'s round, field sorted by name and frozen', () => {
  const t = austin();
  const now = new Date('2026-11-14T17:00Z');
  const card = golfCard(t, null, now);
  assert.equal(card.round, 3);
  assert.equal(card.live, true);
  const e = upcomingGolf(t, card);
  assert.equal(e.id, 'gf-401850980');
  assert.equal(e.start, e.rounds[2].first, 'starts at the round\'s first tee time');
  assert.deepEqual(e.field, [...e.field].sort((a, b) => a.localeCompare(b)), 'by name, never by position');
  assert.ok(e.field.includes('Nick Hardy') || e.field.length === t.players.length, 'cut players stay in the field');
  assert.ok(Object.values(e.tees).every((x) => x.length === 2), 'only the round 1–2 tee times');
  // Between rounds: the next round, not live.
  const between = { ...t, state: 'between', period: 3 };
  assert.deepEqual([golfCard(between, e, now).round, golfCard(between, e, now).live], [4, false]);
  // Over: stays a live round-4 card for some hours, then goes to the full build for scoring.
  const done = { ...t, state: 'final', period: 4, players: t.players.map((p) => ({ ...p, tees: [p.tees[0], p.tees[1], p.tees[2], '2026-11-15T17:40Z'] })) };
  assert.deepEqual([golfCard(done, e, now).round, golfCard(done, e, now).live], [4, true]);
  assert.equal(readyToScore(done, new Date('2026-11-15T22:00Z')), false, 'a playoff would still be on');
  assert.equal(readyToScore(done, new Date('2026-11-16T00:00Z')), true);
  assert.equal(readyToScore(t, new Date('2026-12-01T00:00Z')), false, 'only STATUS_FINAL is over');
});

test('the field is identical before and after the cut', () => {
  const after = austin();
  // The same tournament on Friday, before the cut (nobody is out yet).
  const before = { ...after, period: 2, players: after.players.map((p) => ({ ...p, status: 'active', thru: 9, tees: [p.tees[0], p.tees[1], null, null] })) };
  const fri = upcomingGolf(before, golfCard(before, null, new Date('2026-11-13T18:00Z')));
  const sat = upcomingGolf(after, golfCard(after, fri, new Date('2026-11-14T17:00Z')));
  assert.deepEqual(sat.field, fri.field);
  assert.deepEqual(sat.tees, fri.tees);
  // Even if ESPN dropped the cut players, the frozen field keeps them.
  const dropped = { ...after, players: after.players.filter((p) => p.status !== 'cut' && p.status !== 'wd') };
  assert.ok(dropped.players.length < after.players.length);
  assert.deepEqual(upcomingGolf(dropped, golfCard(dropped, fri, new Date('2026-11-14T17:00Z'))).field, fri.field);
  // ESPN keeps cut players on its leaderboard, so a first look after the cut gives the same field.
  assert.deepEqual(upcomingGolf(after, golfCard(after, null, new Date('2026-11-14T17:00Z'))).field, fri.field);
});

test('card lines at level 0: rounds, tee windows and the back nine', () => {
  const t = austin();
  const e = upcomingGolf(t, golfCard(t, null, new Date('2026-11-14T17:00Z')));
  const at = (iso) => roundLine(e, FMT(iso), Date.parse(iso));
  assert.equal(at('2026-11-14T17:00Z'), 'Round 3 · started 14:40');
  assert.equal(at('2026-11-14T19:00Z'), 'Round 3 · the last group is on the back nine');
  const r4 = { ...e, status: 'upcoming', round: 4 };
  assert.equal(roundLine(r4, FMT('2026-11-14T22:00Z'), Date.parse('2026-11-14T22:00Z')), 'Round 4 · Sun · tee times not out yet');
  const known = { ...r4, rounds: e.rounds.map((r) => (r.n === 4 ? { ...r, first: '2026-11-15T13:00Z', last: '2026-11-15T19:40Z' } : r)) };
  assert.equal(roundLine(known, FMT('2026-11-15T08:00Z'), Date.parse('2026-11-15T08:00Z')), 'Round 4 · today · last group tees off 19:40 · back nine from about 21:50');
  assert.equal(roundLine(known, FMT('2026-11-14T22:00Z'), Date.parse('2026-11-14T22:00Z')), 'Round 4 · Sun 13:00–19:40');
});

test('favorite golfers: round 1–2 tee times at every level, never a weekend tee time', () => {
  const t = austin();
  const e = upcomingGolf(t, golfCard(t, null, new Date('2026-11-14T17:00Z')));
  const name = e.field.find((n) => e.tees[n]);
  const r1 = { ...e, status: 'upcoming', round: 1 };
  const [line] = favoriteLines(r1, [name], FMT('2026-11-12T06:00Z'), Date.parse('2026-11-12T06:00Z'));
  assert.equal(line.text, `tees off ${e.tees[name][0].slice(11, 16)}`);
  assert.equal(favoriteLines(e, [name], FMT('2026-11-14T06:00Z'), Date.parse('2026-11-14T06:00Z'))[0].text, 'in the field', 'round 3: no tee time');
  assert.deepEqual(favoriteLines(e, ['Somebody Else'], FMT('2026-11-14T06:00Z')), []);
  assert.ok(isFavorite(e, { teams: [], players: [name] }, 'upcoming'));
  assert.ok(!isFavorite(e, { teams: [], players: [name] }, 'replays'));
  assert.ok(favNames([[], [e]]).some((n) => n.kind === 'players' && n.name === name), 'golfers can be found in the search');
  assert.equal(titleOf(e), 'Austin Championship');
});

test('golfers for the search box: the last 60 days of fields', () => {
  const state = { golfers: { 'Old Timer': '2026-08-01' } };
  noteGolfers(state, austin(), new Date('2026-11-14T12:00Z'));
  assert.ok(!('Old Timer' in state.golfers));
  assert.equal(state.golfers['Chad Ramey'], '2026-11-14');
});

test('scope: PGA Tour stroke play and the majors; no team events, Q-School or unofficial events', () => {
  const cal = golfFixture('calendar-2026').leagues[0].calendar.map((c) => cleanName(c.label));
  const shown = cal.filter(shownTournament);
  for (const out of ['Presidents Cup', 'Zurich Classic of New Orleans', 'Hero World Challenge', 'PGA TOUR Q-School']) assert.ok(!shown.includes(out), out);
  for (const keep of ['Masters Tournament', 'The Open', 'Travelers Championship', 'The RSM Classic', 'Arnold Palmer Invitational']) assert.ok(shown.includes(keep), keep);
  assert.equal(seriesOf('Masters Tournament', true), 'masters');
  assert.equal(seriesOf('U.S. Open', true), 'us-open');
  assert.equal(seriesOf('PGA Championship', true), 'pga-championship');
  assert.equal(seriesOf('The Open', true), 'the-open');
  assert.equal(seriesOf('U.S. Open', false), 'pga');
});

test('golf streaming rights: HBO Max, the Masters and US Open on Viaplay, both for the other two majors', () => {
  assert.deepEqual(servicesFor('golf', { series: 'pga' }), ['hbomax']);
  assert.deepEqual(servicesFor('golf', { series: 'masters' }), ['viaplay']);
  assert.deepEqual(servicesFor('golf', { series: 'us-open' }), ['viaplay']);
  assert.deepEqual(servicesFor('golf', { series: 'pga-championship' }), ['hbomax', 'viaplay']);
  assert.deepEqual(servicesFor('golf', { series: 'the-open' }), ['hbomax', 'viaplay']);
});
