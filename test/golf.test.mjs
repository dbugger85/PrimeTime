// Golf: reading ESPN, the tournament card's lines (docs/golf.js), and the schedule card the bot
// publishes. The spoiler checks for golf are in test/spoilers.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLeaderboard, roundsOf, currentRound, roundLine, favoriteLines, backNineAt, cleanName, heatOf, holdHeat, outlookOf, OUTLOOKS, playerState, favoriteWords, positionText, leaderboardRows, cutLine } from '../docs/golf.js';
import { GOLF_LIVE } from '../src/scoring/weights.mjs';
import { golfCard, readyToScore, shownTournament, seriesOf, withSeries, noteGolfers, holesFromScoreboard, golfFileEntry } from '../src/sources/espn-golf.mjs';
import { upcomingGolf, servicesFor } from '../src/publish.mjs';
import { isFavorite, favNames, titleOf, adviceText } from '../docs/logic.js';
import { scoreGolf, golfFacts, blockValues, golfAdvice } from '../src/scoring/golf.mjs';

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

// ── Piece 2: how tense it is (level 1) ─────────────────────────────────────────
// A real final round replayed in time: each player's holes from the scoreboard, tee times from the
// leaderboard, about 14.5 minutes a hole. Returns [{ t, players, leaderThru }] every 5 minutes.
export function replayFinalRound(name, { pace = 14.5 } = {}) {
  const holes = holesFromScoreboard(golfFixture(`holes-${name}`).events[0]);
  const lb = parseLeaderboard(golfFixture(`leaderboard-${name}`));
  const ps = holes.map((p) => ({ ...p, tee: Date.parse(lb.players.find((x) => x.name === p.name)?.tees[3]) }))
    .filter((p) => Number.isFinite(p.tee) && p.rounds.slice(0, 3).every((r) => r != null) && p.holes.every((h) => h != null));
  const t0 = Math.min(...ps.map((p) => p.tee)), t1 = Math.max(...ps.map((p) => p.tee)) + 18 * pace * 60e3;
  const out = [];
  for (let t = t0; t <= t1 + 10 * 60e3; t += 5 * 60e3) {
    const players = ps.map((p) => {
      const thru = Math.max(0, Math.min(18, Math.floor((t - p.tee) / (pace * 60e3))));
      return { name: p.name, status: 'active', thru, toPar: p.rounds[0] + p.rounds[1] + p.rounds[2] + p.holes.slice(0, thru).reduce((a, b) => a + b, 0) };
    });
    const best = Math.min(...players.map((p) => p.toPar));
    const leaderThru = Math.min(...players.filter((p) => p.toPar === best).map((p) => p.thru));
    out.push({ t, players, leaderThru });
  }
  return out;
}
// The published heat over a replay (held for 15 minutes before it drops), with the leaders' hole.
const heatLine = (name, round = 4) => {
  let held = null;
  return replayFinalRound(name).map(({ t, players, leaderThru }) => {
    held = holdHeat(held, heatOf(players, round, GOLF_LIVE), t);
    return { t, heat: held.heat, leaderThru };
  });
};

test('heat on real final rounds: the Masters 2025 and the Travelers 2026 get red hot, The Open 2025 stays quiet', () => {
  const masters = heatLine('masters-2025');
  assert.equal(Math.max(...masters.map((x) => x.heat)), 3, 'Masters: McIlroy and Rose on the back nine');
  assert.ok(masters.filter((x) => x.leaderThru >= 15).every((x) => x.heat >= 2), 'Masters: the last holes are at least heating up');
  assert.ok(masters.filter((x) => x.leaderThru >= 6 && x.leaderThru <= 11).every((x) => x.heat <= 1), 'Masters: McIlroy 4 clear around the turn is calm');
  const travelers = heatLine('travelers-2026');
  assert.ok(travelers.filter((x) => x.leaderThru >= 12).every((x) => x.heat === 3), 'Travelers: Hovland and Scheffler level to the end, Morikawa\'s 61');
  const open = heatLine('open-2025');
  assert.ok(open.every((x) => x.heat <= 1), 'The Open: Scheffler ran away with it');
  assert.ok(open.filter((x) => x.leaderThru >= 4).every((x) => x.heat === 0));
  const pga = heatLine('pga-2025');
  assert.ok(pga.some((x) => x.heat >= 2), 'PGA 2025: Rahm got close around the turn…');
  assert.ok(pga.filter((x) => x.leaderThru >= 15).every((x) => x.heat === 0), '…then Scheffler ran away');
});

test('the heat never drops within 15 minutes, and rounds 1–3 are capped', () => {
  for (const name of ['masters-2025', 'travelers-2026', 'pga-2025']) {
    const line = heatLine(name);
    let since = line[0].t;
    for (let i = 1; i < line.length; i++) {
      if (line[i].heat > line[i - 1].heat) since = line[i].t;
      if (line[i].heat < line[i - 1].heat) assert.ok(line[i].t - since >= 15 * 60e3, `${name}: dropped within 15 minutes`);
    }
  }
  assert.deepEqual(holdHeat({ heat: 3, at: 0 }, 1, 10 * 60e3), { heat: 3, at: 0 }, 'held');
  assert.deepEqual(holdHeat({ heat: 3, at: 0 }, 1, 16 * 60e3), { heat: 1, at: 16 * 60e3 }, 'dropped after 15 minutes');
  assert.deepEqual(holdHeat({ heat: 1, at: 0 }, 3, 60e3), { heat: 3, at: 60e3 }, 'rises at once');
  const tense = replayFinalRound('travelers-2026').at(-1).players;
  assert.equal(heatOf(tense, 4, GOLF_LIVE), 3);
  assert.equal(heatOf(tense, 3, GOLF_LIVE), 2, 'round 3: at most heating up');
  assert.equal(heatOf(tense, 2, GOLF_LIVE), 1, 'round 2: at most something brewing (the cut, not the title)');
  assert.equal(heatOf(tense, 1, GOLF_LIVE), 1);
});

test('the outlook before rounds 3 and 4, from the leaderboard after the round before', () => {
  const after3 = (name) => replayFinalRound(name)[0].players.map((p) => ({ ...p, thru: 0 }));
  assert.equal(outlookOf(after3('open-2025'), 4), 'clear', 'Scheffler 4 clear');
  assert.equal(outlookOf(after3('travelers-2026'), 4), 'tight', 'Hovland 1 ahead of Scheffler');
  assert.equal(outlookOf(after3('masters-2025'), 4), 'few', 'McIlroy 2 ahead of DeChambeau');
  assert.equal(outlookOf(after3('masters-2025'), 2), null, 'nothing to say after round 1');
});

test('level 1 lines: the codes replace the schedule words, never a name', () => {
  const t = austin();
  const e = upcomingGolf(t, { ...golfCard(t, null, new Date('2026-11-14T17:00Z')), heat: 0 });
  assert.equal(e.heat, 0);
  const at = Date.parse('2026-11-14T17:00Z');
  assert.equal(roundLine(e, FMT(at), at, 1), 'Round 3 · Quiet so far');
  assert.equal(roundLine(e, FMT(at), at, 0), 'Round 3 · started 14:40', 'level 0: no codes');
  assert.equal(roundLine({ ...e, heat: 2 }, FMT(at), at, 1), 'Round 3 · Heating up now: several players still in it');
  const r4 = { ...e, status: 'upcoming', round: 4, outlook: 'tight', rounds: e.rounds.map((r) => (r.n === 4 ? { ...r, first: '2026-11-15T13:00Z', last: '2026-11-15T19:40Z' } : r)) };
  const sun = Date.parse('2026-11-15T08:00Z');
  assert.equal(roundLine(r4, FMT(sun), sun, 1), 'Round 4 · today · Tight at the top: tune in for the back nine, about 21:50');
  assert.equal(roundLine({ ...r4, outlook: 'clear' }, FMT(sun), sun, 1), 'Round 4 · today · One player well clear: highlights may do');
  const sat = Date.parse('2026-11-14T22:00Z');
  assert.equal(roundLine({ ...r4, rounds: e.rounds }, FMT(sat), sat, 1), 'Round 4 · Sun · Tight at the top: tune in for the back nine');
  // Published only where it belongs: heat on a live card, the outlook between rounds.
  assert.ok(!('outlook' in upcomingGolf(t, { ...golfCard(t, null, new Date('2026-11-14T17:00Z')), outlook: 'tight' })));
  const between = { ...t, state: 'between', period: 3 };
  const card = golfCard(between, e, new Date('2026-11-14T23:00Z'));
  assert.equal(card.live, false);
  assert.ok(OUTLOOKS.includes(card.outlook));
  assert.ok(!('heat' in upcomingGolf(between, { ...card, heat: 2 })));
});

// ── Piece 3: favorites in words (level 2) and positions (level 3) ──────────────
test('level 2: favorites in plain words, never a position', () => {
  const t = austin();
  const now = Date.parse('2026-11-14T17:00Z');
  const fmt = FMT(now);
  const words = (name, live = true) => favoriteWords(playerState(t, name, 3), fmt, now, live);
  assert.equal(words('Chad Ramey'), 'is in contention: watch now', 'tied for the lead');
  assert.equal(words('Zac Blair'), 'is in contention', '2 back, finished for the day');
  assert.equal(words('Hayden Springer'), 'is in contention', '3 back counts');
  const weekend = t.players.find((p) => p.status === 'active' && playerState(t, p.name, 3).status === 'weekend');
  assert.equal(words(weekend.name), 'is playing the weekend');
  assert.equal(words(t.players.find((p) => p.status === 'cut').name), 'missed the cut');
  assert.equal(words(t.players.find((p) => p.status === 'wd').name), 'is out of the tournament');
  assert.equal(favoriteWords(null, fmt), 'in the field', 'not on the leaderboard (yet)');
  // A weekend tee time is level 2: before they tee off, with the back nine about 2 h 10 later.
  const early = Date.parse('2026-11-14T13:00Z');
  const before = { ...t, players: t.players.map((p) => ({ ...p, thru: 0 })) };
  assert.equal(favoriteWords(playerState(before, 'Chad Ramey', 3), FMT(early), early, false), 'tees off 15:46 · back nine about 17:56');
  // No position or number of shots at level 2, for anyone.
  for (const p of t.players) assert.doesNotMatch(words(p.name), /\d|back|lead|T\d/, `${p.name}: ${words(p.name)}`);
});

test('level 2: near the cut line on Friday, on his last holes', () => {
  const t = austin();
  // Friday afternoon: nobody is cut yet, the projected cut is the 65th place's score.
  const friday = { ...t, period: 2, players: t.players.map((p) => ({ ...p, status: 'active', thru: 15 })) };
  const fake = { ...friday, players: [...friday.players, ...Array.from({ length: 60 }, (_, i) => ({ name: `Filler ${i}`, toPar: -8 + Math.floor(i / 6), thru: 15, status: 'active', pos: '', sort: 200 + i, tees: [] }))] };
  const cut = cutLine(fake);
  assert.ok(Number.isFinite(cut));
  const near = fake.players.find((p) => p.toPar === cut && !p.name.startsWith('Filler'));
  if (near) assert.equal(favoriteWords(playerState(fake, near.name, 2), FMT(0), 0, true), 'is near the cut line, on his last holes');
  assert.equal(cutLine(t), null, 'the cut is made: no line');
  assert.equal(cutLine({ ...friday, cutRound: 0 }), null, 'no cut at all (signature events)');
});

test('level 3: positions, shots back and the leaderboard', () => {
  const t = austin();
  const now = Date.parse('2026-11-14T17:00Z');
  const pos = (name) => positionText(playerState(t, name, 3), FMT(now), now);
  assert.equal(pos('Chad Ramey'), 'T1, tied for the lead, through 14');
  assert.equal(pos('Zac Blair'), 'T7, 2 shots back, finished');
  const solo = { ...t, players: t.players.map((p) => (p.name === 'Trace Crowe' ? { ...p, toPar: -15, pos: '1' } : p.name === 'Chad Ramey' ? { ...p, pos: '2' } : p)) };
  assert.equal(positionText(playerState(solo, 'Trace Crowe', 3), FMT(now), now), 'leads by 2 shots, through 10');
  assert.equal(positionText(playerState(solo, 'Chad Ramey', 3), FMT(now), now), '2nd, 2 shots back, through 14');
  const rows = leaderboardRows(t, ['Zac Blair', t.players.at(-1).name], { fmt: FMT(now) });
  assert.equal(rows.length, 11, 'the top 10 plus a favorite outside it (one inside it isn\'t repeated)');
  assert.deepEqual(rows[0], { pos: 'T1', name: 'Chad Ramey', toPar: '-13', thru: '14', fav: false });
  assert.ok(rows.find((r) => r.name === 'Zac Blair').fav);
  assert.equal(rows.at(-1).pos, 'WD');
  assert.deepEqual(leaderboardRows(null), []);
});

// ── Piece 4: the final round's replay rating ──────────────────────────────────
export function finalRoundFacts(name, change = (p) => p) {
  const holes = holesFromScoreboard(golfFixture(`holes-${name}`).events[0]).map(change);
  const lb = parseLeaderboard(golfFixture(`leaderboard-${name}`));
  return golfFacts(holes, { winner: lb.players.find((p) => p.pos === '1')?.name, major: lb.major, purse: lb.purse });
}

test('replay rating: playoffs score high, a runaway low', () => {
  const masters = scoreGolf(finalRoundFacts('masters-2025'));
  const travelers = scoreGolf(finalRoundFacts('travelers-2026'));
  const pga = scoreGolf(finalRoundFacts('pga-2025'));
  const open = scoreGolf(finalRoundFacts('open-2025'));
  assert.ok(masters.score >= 8.5, `Masters 2025 (McIlroy–Rose playoff): ${masters.score}`);
  assert.ok(travelers.score >= 7.5, `Travelers 2026 (Hovland–Scheffler playoff): ${travelers.score}`);
  assert.ok(open.score <= 3.5, `The Open 2025 (Scheffler by 4): ${open.score}`);
  assert.ok(pga.score < 6 && pga.score < travelers.score, `PGA Championship 2025 (Scheffler by 5 after a brief chase): ${pga.score}`);
  assert.ok(masters.score < 10 && travelers.score < 10, 'a 10 stays out of reach');
  assert.equal(open.advice.code, 'highlights');
  // The margin comes from the 72 holes, never ESPN's `score` (which counts the playoff holes too).
  assert.match(travelers.result, /^Viktor Hovland won at -21, beating Scottie Scheffler in a playoff\. Next: Collin Morikawa -20/);
  assert.match(open.result, /^Scottie Scheffler won at -17, by 4 shots/);
  assert.ok(masters.reasons.some(([, label]) => /playoff/.test(label)));
  assert.ok(masters.reasons.some(([, label]) => /Justin Rose started the day 7 shots back/.test(label)), 'a comeback by someone level at the end');
});

test('the strip: always 6 blocks, the same with or without the playoff; the tip the same whoever won', () => {
  for (const name of ['masters-2025', 'travelers-2026', 'pga-2025', 'open-2025']) {
    const s = scoreGolf(finalRoundFacts(name));
    assert.equal(s.segments.length, 6, name);
    assert.ok(s.segments.every((x) => [0, 1, 2, 3].includes(x)));
    // Without the playoff holes (or with a different playoff winner) nothing on the card moves but the score.
    const noPlayoff = scoreGolf(finalRoundFacts(name, (p) => ({ ...p, playoff: [] })));
    assert.deepEqual([noPlayoff.segments, noPlayoff.advice], [s.segments, s.advice], `${name}: the playoff shows on the strip or tip`);
    const facts = finalRoundFacts(name);
    const other = scoreGolf({ ...facts, winner: facts.players.find((p) => p.name !== facts.winner).name });
    assert.deepEqual([other.segments, other.advice], [s.segments, s.advice], `${name}: the strip or tip depends on who won`);
  }
});

test('skip tips: only "start at hole 7, 10 or 13", from holes 1–12 alone', () => {
  const pars = (upTo) => (p) => ({ ...p, holes: p.holes.map((h, i) => (i < upTo ? 0 : h)), rounds: [...p.rounds.slice(0, 3), p.holes.reduce((a, h, i) => a + (i < upTo ? 0 : h), 0)] });
  const quiet6 = scoreGolf(finalRoundFacts('masters-2025', pars(6)));
  assert.deepEqual(quiet6.advice, { code: 'skip', unit: 'hole', ranges: [[1, 9]] }, 'holes 1–6 all pars, and 7–9 quiet too in the real round');
  assert.equal(adviceText(quiet6.advice), 'Start at hole 10');
  const busy7 = scoreGolf(finalRoundFacts('masters-2025', (p, i) => {
    const q = pars(6)(p);
    const holes = q.holes.map((h, k) => (k >= 6 && k < 9 && i < 4 ? (k % 2 ? -1 : 1) : h)); // birdies and bogeys at the top on 7–9
    return { ...q, holes, rounds: [...q.rounds.slice(0, 3), holes.reduce((x, y) => x + y, 0)] };
  }));
  assert.equal(adviceText(busy7.advice), 'Start at hole 7');
  const quiet12 = scoreGolf(finalRoundFacts('masters-2025', pars(15)));
  assert.deepEqual(quiet12.advice.ranges, [[1, 12]], 'never later than hole 13, however quiet');
  assert.equal(adviceText(quiet12.advice), 'Start at hole 13');
  // Whatever happens on the last six holes (here: everyone's scores there shuffled), the tip stays: it
  // only looks at holes 1–12. (Only "Highlights are enough" follows the score, like every sport.)
  const base = finalRoundFacts('masters-2025', pars(6));
  const shuffled = finalRoundFacts('masters-2025', (p, i) => {
    const q = pars(6)(p);
    const holes = q.holes.map((h, k) => (k >= 12 ? [-1, 1, 0, 2, -2, 0][(k + i) % 6] : h));
    return { ...q, holes, rounds: [...q.rounds.slice(0, 3), holes.reduce((a, b) => a + b, 0)] };
  });
  assert.deepEqual(blockValues(shuffled).slice(0, 4), blockValues(base).slice(0, 4));
  assert.deepEqual(golfAdvice(6, blockValues(shuffled)), golfAdvice(6, blockValues(base)), 'the tip depends on the last six holes');
});

test('limited: no hole-by-hole scores, rated from the round totals, no strip', () => {
  const f = finalRoundFacts('open-2025', (p) => ({ ...p, holes: p.holes.map((h, i) => (i === 15 ? h : null)) }));
  assert.equal(f.limited, true);
  const s = scoreGolf(f);
  assert.equal(s.limited, true);
  assert.deepEqual(s.segments, []);
  assert.ok(['full', 'highlights'].includes(s.advice.code));
  assert.match(s.result, /^Scottie Scheffler won at -17, by 4 shots/);
});

// ── Piece 5: docs/data/golf.json ──────────────────────────────────────────────
test('golf.json: the field\'s leaderboard, rewritten only when a status changes or every 15 minutes', () => {
  const t = austin();
  const now = new Date('2026-11-14T17:00Z');
  const card = upcomingGolf(t, golfCard(t, null, now));
  const entry = golfFileEntry(t, card, null, now);
  assert.equal(entry.round, 3);
  assert.equal(entry.t.players.length, card.field.length);
  assert.equal(playerState(entry.t, 'Chad Ramey', 3).status, 'contention', 'the page and the helper can work the words out from it');
  // A few minutes later, someone has played another hole but nobody's status changed: the old entry stays.
  const later = { ...t, players: t.players.map((p) => (p.name === 'Zac Blair' ? p : { ...p, thru: Math.min(18, p.thru + 1) })) };
  assert.equal(golfFileEntry(later, card, entry, new Date('2026-11-14T17:05Z')), entry, 'no rewrite (and no deploy) for a hole played');
  assert.notEqual(golfFileEntry(later, card, entry, new Date('2026-11-14T17:16Z')), entry, 'rewritten after 15 minutes');
  // Someone drops out of contention: rewritten at once.
  const dropped = { ...t, players: t.players.map((p) => (p.name === 'Hayden Springer' ? { ...p, toPar: p.toPar + 3 } : p)) };
  assert.notEqual(golfFileEntry(dropped, card, entry, new Date('2026-11-14T17:05Z')), entry);
  assert.equal(golfFileEntry({ ...t, state: 'pre', players: t.players.map((p) => ({ ...p, thru: 0 })) }, card, null, now), null, 'nothing before the first tee shot');
});
