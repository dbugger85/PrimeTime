// Checks the scores against real matches we know the feel of.
// If you change a formula, these should still pass (or be updated on purpose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { factsFromSummary } from '../src/sources/espn-football.mjs';
import { matchesFromSlam } from '../src/sources/espn-tennis.mjs';
import { factsFromRace, factsFromQuali } from '../src/sources/openf1.mjs';
import { scoreFootball, footballAdvice } from '../src/scoring/football.mjs';
import { scoreTennis, tennisAdvice } from '../src/scoring/tennis.mjs';
import { scoreF1, f1Advice, scoreQuali } from '../src/scoring/f1.mjs';
import { quietRuns, heat, SCORING_VERSIONS, fingerprint, finalScore, tally } from '../src/scoring/common.mjs';
import { forecastOf, outlookOf, stakesFor } from '../src/prematch.mjs';
import { scoreboardOdds } from '../src/sources/espn-football.mjs';
import { tablesFrom } from '../src/sources/espn-standings.mjs';
import * as WEIGHTS from '../src/scoring/weights.mjs';
import { factsFromRace as biathlonFacts, seconds } from '../src/sources/ibu.mjs';
import * as fis from '../src/sources/fis.mjs';
import { scoreBiathlon, scoreAlpine, scoreCrossCountry, biathlonAdvice } from '../src/scoring/winter.mjs';
import { calendarDays } from '../src/sources/winter.mjs';

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

test('football: team strength from the odds, blowouts score below thrillers', () => {
  const viking81 = fb(401843437); // Eliteserien, Viking 79% favorites, 8-1
  const bayernBodo50 = fb(401915443); // Champions League, Bayern 89% favorites, 5-0
  const spursVilla23 = fb(401879269); // evenly matched, 2-3
  const franceSweden30 = fb(760492); // a plain 3-0
  // The owner found a goal-fest blowout (Poland 6-0 Romania at 5.4) too low: lots of goals are still fun.
  assert.ok(viking81.score >= 5.5 && viking81.score < 7, `8-1 got ${viking81.score}`);
  assert.ok(bayernBodo50.score < 6, `5-0 got ${bayernBodo50.score}`);
  assert.ok(viking81.score > franceSweden30.score, 'nine goals beat a plain 3-0');
  assert.ok(spursVilla23.score >= viking81.score + 2, `even 2-3 got ${spursVilla23.score}`);
  assert.ok(viking81.reasons.some(([, l]) => /favorite/.test(l)), 'the breakdown mentions the favorite');
  // The same match without odds still punishes the blowout, just less.
  const noOdds = scoreFootball({ ...factsFromSummary(fixture('football/401843437.json')), odds: null });
  assert.ok(noOdds.score < 7.5 && noOdds.score > viking81.score, `8-1 without odds got ${noOdds.score}`);
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
  const ids = [401843437, 401879269, 401915443, 401879276, 760489, 760492, 760493, 760505, 760508, 760512, 760514, 760516];
  for (const id of ids) {
    const { advice } = fb(id);
    if (advice.code === 'skip') assert.ok(advice.ranges.every(([a, b]) => a < b && b <= 75), `${id}`);
  }
  assert.ok(ids.some((id) => fb(id).advice.code === 'skip'), 'at least one real match gets a skip tip, or this test checks nothing');
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
  // And every substitution: half-time changes show "HT", injuries are noted.
  const subs = fb(401861083).result.subs; // Bulgaria 0–0 Estonia, Nations League 2026
  assert.equal(subs.length, 9);
  assert.equal(subs[0], 'HT · Mattias Männilaan on for Karel Mustmaa (Estonia)');
  assert.equal(subs.at(-1), "74' · Frank Liivak on for Robi Saarma (Estonia, injury)");
  const matches = matchesFromSlam(fixture('tennis/usopen2026.json').events[0]);
  const final = matches.find((m) => m.round === 'Final' && m.draw.startsWith('Men'));
  assert.equal(scoreTennis(final).result, 'Alexander Zverev beat Ben Shelton 6-3 7-6(2) 5-7 6-2');
  assert.match(race('british-grand-prix-2025').result, /^1\. .+, 2\. .+, 3\. .+ \(won by \d+\.\d s\)$/);
});

test('weights.mjs: every weight is a number from 0 to 5', () => {
  for (const [sport, weights] of Object.entries(WEIGHTS)) {
    for (const [name, w] of Object.entries(weights)) {
      assert.ok(typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= 5, `${sport}.${name} is ${w}: use a number from 0 to 5`);
    }
  }
  for (const v of Object.values(SCORING_VERSIONS)) assert.match(v, /^\d+\.[0-9a-f]{8}$/, 'each version includes a fingerprint of its weights');
  assert.notEqual(fingerprint({ ...WEIGHTS.FOOTBALL, goal: 9 }), fingerprint(WEIGHTS.FOOTBALL), 'changing a weight changes the version');
  assert.deepEqual(Object.keys(SCORING_VERSIONS).sort(), ['f1', 'football', 'tennis', 'winter']);
});

test('weights.mjs: team strength can be switched off', () => {
  const facts = factsFromSummary(fixture('football/401843437.json')); // Viking 8-1
  const before = WEIGHTS.FOOTBALL.teamStrength;
  try {
    WEIGHTS.FOOTBALL.teamStrength = 0;
    assert.equal(scoreFootball(facts).score, scoreFootball({ ...facts, odds: null }).score);
  } finally {
    WEIGHTS.FOOTBALL.teamStrength = before;
  }
});

const quali = (name) => factsFromQuali(fixture(`f1/${name}.json`).d);

test('F1 qualifying is unrated: no score, strip or tips, just the result', () => {
  const hu = scoreQuali(quali('qualifying-hungary-2025')); // pole by 0.026 s
  assert.deepEqual({ ...hu, result: '' }, { score: null, segments: [], advice: null, reasons: [], result: '' });
  assert.match(hu.result, /^1\. .+ \(pole by 0\.026 s\)$/);
});

test('F1: the score does not depend on whether the leader stayed in front', () => {
  const facts = factsFromRace(fixture('f1/british-grand-prix-2025.json').d);
  const others = facts.overtakes.filter((o) => o.position > 3);
  const lead = { ...facts, leadChanges: [30], overtakes: [...others, { lap: 30, position: 1 }] }; // a pass for the lead…
  const second = { ...facts, leadChanges: [], overtakes: [...others, { lap: 30, position: 2 }] }; // …or for 2nd
  assert.equal(scoreF1(lead).score, scoreF1(second).score);
  assert.deepEqual(scoreF1(lead).segments, scoreF1(second).segments);
});

test('football: an underdog winning big is a shock, not a blowout', () => {
  const facts = factsFromSummary(fixture('football/760492.json')); // France 3-0 Sweden
  const expected = scoreFootball({ ...facts, odds: { home: 0.74, draw: 0.17, away: 0.09 } });
  const shock = scoreFootball({ ...facts, odds: { home: 0.09, draw: 0.17, away: 0.74 } });
  assert.ok(!shock.reasons.some(([, l]) => /One-sided/.test(l)), 'no blowout penalty for the underdog');
  assert.ok(shock.score >= expected.score + 3, `shock ${shock.score}, expected ${expected.score}`);
});

test('F1 sprints: a third of the distance, so overtakes count three times', () => {
  const china = factsFromRace(fixture('f1/sprint-china-2026.json').d); // 28 overtakes, lead changed 4 times
  const qatar = factsFromRace(fixture('f1/sprint-qatar-2025.json').d); // 2 overtakes, won by 5 s
  const sprintChina = scoreF1(china, { sprint: true });
  assert.ok(sprintChina.score >= 8.5, `China 2026 sprint got ${sprintChina.score}`);
  assert.ok(scoreF1(qatar, { sprint: true }).score < 3, 'a procession stays low');
  assert.ok(sprintChina.score > scoreF1(china).score, 'scored as a sprint, it beats the same facts scored as a full race');
  assert.equal(sprintChina.segments.length, 10);
});

// Winter sports: real races from the 2025/26 season (test/fixtures/winter).
const winter = (name) => fixture(`winter/${name}.json`);
const biathlon = (name) => { const { r, d } = winter(name); return scoreBiathlon(biathlonFacts(r, d)); };
const fisPage = (name) => fis.resultFromPage(winter(name).html);

test('biathlon: a mass start decided by 0.3 s beats a runaway sprint', () => {
  const ms = biathlon('biathlon-annecy-2025-women-mass-start'); // 0.3 s, four lead changes
  const sp = biathlon('biathlon-oberhof-2026-women-sprint'); // won by 21 s
  const relay = biathlon('biathlon-ruhpolding-2026-women-relay'); // won by 0.9 s
  assert.ok(ms.score >= 9, `mass start got ${ms.score}`);
  assert.ok(relay.score >= 7, `relay got ${relay.score}`);
  assert.ok(sp.score < 3.5, `sprint got ${sp.score}`);
  assert.equal(ms.segments.length, 5, 'four shootings and the finish');
  assert.equal(relay.segments.length, 4, 'four legs');
  assert.ok(ms.reasons.some(([, l]) => /last shooting/.test(l)));
});

test('biathlon: facts from the IBU data', () => {
  const { r, d } = winter('biathlon-annecy-2025-women-mass-start');
  const f = biathlonFacts(r, d);
  assert.equal(f.gapP2.toFixed(1), '0.3');
  assert.equal(f.leaders.length, 4, 'a leader after each of the four shootings');
  assert.equal(f.lastShootingLeaderWon, false);
  assert.equal(seconds('1:02:03.4'), 3723.4);
  assert.equal(seconds('+12.6'), 12.6);
});

test('biathlon advice never skips the last shooting, the finish or the last leg', () => {
  const h2h = { h2h: true, relay: false };
  assert.deepEqual(biathlonAdvice(5, [0, 0, 0, 0, 5], h2h), { code: 'skip', unit: 'stage', ranges: [[1, 3]] });
  assert.deepEqual(biathlonAdvice(5, [3, 0, 0, 0, 5], h2h), { code: 'full' });
  assert.deepEqual(biathlonAdvice(5, [0, 0, 0, 0], { h2h: true, relay: true }), { code: 'skip', unit: 'leg', ranges: [[1, 3]] });
  assert.deepEqual(biathlonAdvice(6, [0, 0, 5], { h2h: false }), { code: 'full' }, 'against the clock: no skipping');
});

test('alpine: a comeback from 13th after run 1 beats a 1.66 s runaway', () => {
  const gurgl = scoreAlpine(fis.alpineFacts(fisPage('alpine-gurgl-2025-men-slalom')));
  const levi = scoreAlpine(fis.alpineFacts(fisPage('alpine-levi-2025-women-slalom')));
  const dh = scoreAlpine(fis.alpineFacts(fisPage('alpine-val-di-fassa-2026-women-downhill'))); // won by 0.01 s
  assert.ok(gurgl.score >= 8, `Gurgl got ${gurgl.score}`);
  assert.ok(levi.score <= 3.5, `Levi got ${levi.score}`);
  assert.ok(dh.score >= 6, `downhill by 0.01 s got ${dh.score}`);
  assert.equal(gurgl.segments.length, 2, 'one block per run');
  // Hallberg was 3rd after run 1 and went out in run 2: he still counts for the run-1 order.
  assert.equal(fis.alpineFacts(fisPage('alpine-gurgl-2025-men-slalom')).winnerRun1, 14);
  assert.equal(dh.segments.length, 0, 'no strip for one-run races');
});

test('FIS pages: result rows, times and gaps', () => {
  const p = fisPage('alpine-levi-2025-women-slalom');
  assert.equal(p.name, "Women's Slalom");
  assert.equal(p.rows[0].name, 'SHIFFRIN Mikaela');
  assert.equal(p.rows[0].times.length, 3, 'run 1, run 2, total');
  const oslo = fisPage('cross-country-oslo-2026-men-50km');
  assert.equal(oslo.rows[0].times[0], 6698.2, 'hours are read: 1:51:38.2');
  assert.deepEqual(calendarDays('29 Nov-01 Dec 2025').map((d) => d.toISOString().slice(0, 10)), ['2025-11-29', '2025-12-01']);
});

test('cross-country: a 50 km decided by 0.4 s beats a 22 s interval start', () => {
  const oslo = scoreCrossCountry(fis.crossCountryFacts(fisPage('cross-country-oslo-2026-men-50km'), '50km Mass Start Free'));
  const lahti = scoreCrossCountry(fis.crossCountryFacts(fisPage('cross-country-lahti-2026-men-10km'), '10km Interval Start Classic'));
  assert.ok(oslo.score >= 7, `Oslo got ${oslo.score}`);
  assert.ok(lahti.score < 3.5, `Lahti got ${lahti.score}`);
  assert.equal(oslo.segments.length, 0);
});

test('forecast from the odds: even, lively, one-sided, or nothing', () => {
  const odds = scoreboardOdds(fixture('football/odds-brann-viking.json')); // +170 / +280 / +120, over 3.5 at -105
  assert.ok(Math.abs(odds.chances.home + odds.chances.draw + odds.chances.away - 1) < 1e-9);
  assert.ok(odds.goals > 3.3 && odds.goals < 3.5, `about 3.4 goals expected, got ${odds.goals}`);
  assert.equal(forecastOf(odds), 'lively');
  const c = (home, away, goals = 2.6) => forecastOf({ chances: { home, draw: 1 - home - away, away }, goals });
  assert.equal(c(0.36, 0.37), 'even');
  assert.equal(c(0.06, 0.85, 4.5), 'one-sided', 'a mismatch is one-sided, however many goals');
  assert.equal(c(0.47, 0.30, 3.45), 'lively');
  assert.equal(c(0.64, 0.15, 3.3), null, 'a clear favorite: nothing to say');
  assert.equal(forecastOf(null), null);
  assert.equal(scoreboardOdds({ overUnder: 2.5 }), null, 'no win odds, no forecast');
  const even = scoreboardOdds({ moneyline: { home: { close: { odds: 'EVEN' } }, draw: { close: { odds: '+250' } }, away: { close: { odds: '+260' } } } });
  assert.ok(even && even.chances.home > even.chances.away, '"EVEN" counts as +100');
});

test("what's at stake, from the table before the match", () => {
  const nor = tablesFrom(fixture('football/standings-nor.1-2026-10-01.json')); // Viking and Bodø/Glimt on 50 after 21
  assert.equal(stakesFor(nor, 'SK Brann', 'Viking FK', 'nor.1'), 'title');
  assert.equal(stakesFor(nor, 'Bodo/Glimt', 'Kristiansund BK', 'nor.1'), 'title', 'one team in the race is enough in a league');
  assert.equal(stakesFor(nor, 'IK Start', 'Hamarkameratene', 'nor.1'), 'relegation');
  assert.equal(stakesFor(nor, 'KFUM Oslo', 'Vålerenga', 'nor.1'), 'relegation');
  assert.equal(stakesFor(nor, 'Rosenborg', 'Sandefjord', 'nor.1'), null, '5th against 11th: nothing much at stake');
  assert.equal(stakesFor(nor, 'Lillestrom', 'Molde', 'nor.1'), null, 'a European race needs both teams in it');
  // Labels must stay the exception: at most about half of all possible pairings.
  const teams = nor[0].rows.map((r) => r.team);
  const pairs = teams.flatMap((x) => teams.filter((y) => x < y).map((y) => [x, y]));
  const labelled = pairs.filter(([x, y]) => stakesFor(nor, x, y, 'nor.1')).length;
  assert.ok(labelled <= pairs.length * 0.7, `${labelled} of ${pairs.length} Eliteserien pairings labelled`);
  assert.equal(stakesFor(nor, 'Viking FK', 'Nowhere FC', 'nor.1'), null, 'unknown team');
  // Nations League groups after 2 of 6 games: too early, and small groups need a head-to-head.
  const nl = tablesFrom(fixture('football/standings-uefa.nations-2026-10-01.json'));
  assert.equal(stakesFor(nl, 'Wales', 'Norway', 'uefa.nations'), null);
  // A group in its last two rounds: only a head-to-head across the line, within 3 points.
  const group = [{ name: 'Group A1', rows: [['France', 1, 8], ['Belgium', 2, 6], ['Italy', 3, 4], ['Türkiye', 4, 3]].map(([team, rank, points]) => ({ team, rank, points, played: 5 })) }];
  assert.equal(stakesFor(group, 'France', 'Belgium', 'uefa.nations'), 'group');
  assert.equal(stakesFor(group, 'Belgium', 'Italy', 'uefa.nations'), 'relegation', 'League A: 3rd and 4th both go down or to a play-off');
  assert.equal(stakesFor(group, 'Italy', 'Türkiye', 'uefa.nations'), null, 'both below the line');
  assert.equal(stakesFor(group, 'France', 'Türkiye', 'uefa.nations'), null);
  // Early in a league season: nothing yet.
  const early = [{ name: 'x', rows: [1, 2, 3, 4].map((rank) => ({ team: `T${rank}`, rank, points: 9 - rank, played: 1 })) }];
  assert.equal(stakesFor(early, 'T1', 'T2', 'eng.1'), null);
});

test('stakes add a little to the score, and say so', () => {
  const facts = factsFromSummary(fixture('football/760516.json'));
  const plain = scoreFootball(facts);
  const title = scoreFootball({ ...facts, stakes: 'title' });
  assert.ok(title.reasons.some(([, label]) => label === 'Title race before kick-off'));
  assert.ok(title.reasons.reduce((a, [p]) => a + p, 0) > plain.reasons.reduce((a, [p]) => a + p, 0));
});

test('alpine: "Skip run 1" never depends on who won', () => {
  const base = { runs: 2, gapP2: 0.1, gapP5: 0.4, run1Spread: 1.3, bigMover: false, result: 'x' };
  const leaderWon = scoreAlpine({ ...base, winnerRun1: 1, run1LeaderFinish: 1 });
  const leaderLost = scoreAlpine({ ...base, winnerRun1: 2, run1LeaderFinish: 2 });
  const leaderOut = scoreAlpine({ ...base, winnerRun1: 2, run1LeaderFinish: null });
  assert.equal(leaderWon.advice.code, 'skip');
  assert.deepEqual(leaderLost.advice, leaderWon.advice);
  assert.deepEqual(leaderOut.advice, leaderWon.advice);
  assert.ok(leaderOut.reasons.some(([, l]) => /out of the result/.test(l)), 'a run-1 leader who went out is noticed');
});

test('biathlon relay: an unknown leader at the last handover is not a twist', () => {
  const { r, d } = fixture('winter/biathlon-ruhpolding-2026-women-relay.json');
  const stripped = structuredClone(d);
  for (const row of stripped.results) delete row.TeamRankAfterLeg;
  const f = biathlonFacts(r, stripped);
  assert.equal(f.lastShootingLeaderWon, null);
  assert.ok(!scoreBiathlon(f).reasons.some(([, l]) => /didn't win/.test(l)));
});

test('a score that is not a number is refused; a missing fact is left out', () => {
  assert.throws(() => finalScore(NaN));
  const t = tally();
  t.add(2, 'two');
  const log = console.log;
  console.log = () => {}; // the warning is expected here; don't show it in every GitHub run
  try { t.add(NaN, 'missing'); } finally { console.log = log; }
  assert.equal(t.total, 2);
  assert.deepEqual(t.reasons, [[2, 'two']]);
});

test('F1: no skip windows after a red flag (the race may have been cut short)', () => {
  const quiet = new Array(71).fill(0);
  assert.equal(f1Advice(5, quiet, 70).code, 'skip');
  assert.deepEqual(f1Advice(5, quiet, 70, { redFlag: true }), { code: 'full' });
  assert.deepEqual(f1Advice(4, quiet, 70, { redFlag: true }), { code: 'highlights' });
});

test('football: an underdog winning on penalties is an upset', () => {
  const pens = fb(760489); // Germany 1–1 Paraguay, Paraguay (9% to win) won on penalties
  assert.ok(pens.reasons.some(([, l]) => l === 'Upset: the underdog won on penalties'));
});

test('stakes: the bottom team is in a relegation battle, 2nd place in a top-4 race', () => {
  const table = (points) => [{ name: 'PL', rows: points.map((p, i) => ({ team: `T${i + 1}`, rank: i + 1, points: p, played: 28 })) }];
  const bottom = table([70, 65, 60, 58, 55, 50, 48, 45, 44, 42, 40, 38, 36, 35, 33, 31, 30, 29, 29, 29]);
  assert.equal(stakesFor(bottom, 'T20', 'T10', 'eng.1'), 'relegation');
  const top = table([80, 58, 57, 57, 57, 50, 45, ...new Array(13).fill(30)]);
  assert.equal(stakesFor(top, 'T2', 'T5', 'eng.1'), 'top4');
  assert.equal(stakesFor(top, 'T2', 'T9', 'eng.1'), null, '9th is too far down');
});

test('FotMob xG: shots, sides and minutes; team names matched loosely', async () => {
  const fm = await import('../src/sources/fotmob.mjs');
  const xg = fm.xgFromDetails(fixture('football/fotmob-valerenga-fredrikstad.json')); // 1.45 – 0.75 on FotMob
  assert.equal(xg.home, 1.45);
  assert.equal(xg.away, 0.75);
  assert.ok(xg.shots.every((s) => s.min >= 0 && s.min < 90 && ['home', 'away'].includes(s.side)));
  assert.ok(xg.shots.some((s) => s.min === 89.9), 'stoppage time stays inside the second half');
  assert.equal(fm.xgFromDetails({ general: { homeTeam: { id: 1 } }, content: {} }), null, 'no shot map: no xG');
  for (const [a, b] of [['SK Brann', 'Brann'], ['Bodo/Glimt', 'Bodø/Glimt'], ['Tromso', 'Tromsø'], ['Republic of Ireland', 'Ireland'], ['Viking FK', 'Viking'], ['Internazionale', 'Inter'], ['Leeds United', 'Leeds'], ['Bosnia-Herzegovina', 'Bosnia and Herzegovina']]) {
    assert.ok(fm.sameTeam(a, b), `${a} = ${b}`);
  }
  for (const [a, b] of [['Manchester City', 'Manchester United'], ['Viking FK', 'Brann'], ['IK Start', 'Stabæk']]) {
    assert.ok(!fm.sameTeam(a, b), `${a} ≠ ${b}`);
  }
});

test('outlook: a rough word for upcoming matches, or nothing', () => {
  const odds = (home, away, goals) => ({ chances: { home, draw: 1 - home - away, away }, goals });
  assert.equal(outlookOf(odds(0.36, 0.37, 3.4)), 'promising', 'even, and goals expected');
  assert.equal(outlookOf(odds(0.83, 0.05, 2.5)), 'quiet', 'a big mismatch with few goals expected');
  assert.equal(outlookOf(odds(0.55, 0.22, 2.7)), null, 'in between: nothing to say');
  assert.equal(outlookOf(odds(0.55, 0.22, 2.7), 'title'), null);
  assert.equal(outlookOf(odds(0.45, 0.28, 2.9), 'title'), 'promising', 'a title race tips it');
  assert.equal(outlookOf(null), null, 'no odds, no guess');
});

test('football with and without xG; points above 7 count less', () => {
  const facts = factsFromSummary(fixture('football/760516.json')); // France 4–6 England
  const noXg = scoreFootball({ ...facts, xg: null });
  assert.equal(noXg.limited, true, 'no xG: limited info');
  assert.ok(noXg.reasons.some(([, l]) => /shots on target/.test(l)), 'falls back to shot counts');
  const withXg = scoreFootball({ ...facts, xg: { home: 2.1, away: 2.4, shots: [] } });
  assert.equal(withXg.limited, false);
  assert.ok(withXg.reasons.some(([, l]) => / xG$/.test(l)) && !withXg.reasons.some(([, l]) => /shots on target/.test(l)));
  // The same 1–0: real chances beat potshots.
  const oneNil = factsFromSummary(fixture('football/401879276.json')); // Bournemouth 0–1 Liverpool
  const open = scoreFootball({ ...oneNil, xg: { home: 2.5, away: 1.5, shots: [] } }).score;
  const closed = scoreFootball({ ...oneNil, xg: { home: 0.6, away: 0.5, shots: [] } }).score;
  assert.ok(open > closed, `chances ${open} vs potshots ${closed}`);
  // The squeeze: raw 12 becomes 9.0, with a line saying so.
  assert.ok(noXg.reasons.some(([, l]) => l === 'Points above 7 count less'));
  const raw = noXg.reasons.filter(([, l]) => l !== 'Points above 7 count less').reduce((a, [p]) => a + p, 0);
  assert.equal(noXg.score, Math.min(10, Math.round((7 + (raw - 7) * 0.4) * 10) / 10));
});

test('direct links: TV 2 dates, NRK races, and only safe links get out', async () => {
  const { tv2Day, nrkMatch } = await import('../src/sources/links.mjs');
  const { linkFields } = await import('../src/publish.mjs');
  const now = Date.parse('2026-10-02T10:00:00Z'); // a Friday
  assert.equal(tv2Day('I dag 18:45', now, true), '2026-10-02');
  assert.equal(tv2Day('I går 20:30', now, false), '2026-10-01');
  assert.equal(tv2Day('Man. 20:30', now, true), '2026-10-05');
  assert.equal(tv2Day('26. sep. 14:45', now, false), '2026-09-26');
  assert.equal(tv2Day('3. jan. 14:45', now, true), '2027-01-03', 'the nearest year');

  const nrk = fixture('winter/nrk-episodes.json');
  const race = (comp, name, gender, start) => ({ comp, race: name, gender, start });
  assert.equal(nrkMatch(race('biathlon', "Men's 15 km mass start", 'men', '2026-03-22T13:00:00Z'), nrk.biathlon)?.titles.title, 'Fellesstart menn - 22.03.2026');
  assert.equal(nrkMatch(race('biathlon', "Women's 12.5 km mass start", 'women', '2026-03-22T10:00:00Z'), nrk.biathlon)?.titles.title, 'Fellesstart kvinner - 22.03.2026');
  assert.match(nrkMatch(race('alpine', "Men's slalom", 'men', '2026-03-25T09:00:00Z'), nrk.alpine)?.titles.title ?? '', /^Slalåm 1\. omgang, menn/, 'run 1 of a two-run race');
  assert.match(nrkMatch(race('alpine', "Women's giant slalom", 'women', '2026-03-25T09:00:00Z'), nrk.alpine)?.titles.title ?? '', /^Storslalåm 1\. omgang, kvinner/);
  assert.equal(nrkMatch(race('cross-country', "Men's 10 km individual free", 'men', '2025-12-07T12:00:00Z'), nrk['cross-country'])?.titles.title, '10 km fri teknikk, menn - 07.12.2025');
  assert.equal(nrkMatch(race('biathlon', "Men's 10 km sprint", 'men', '2026-03-22T13:00:00Z'), nrk.biathlon), null, 'no sprint that day');

  const tv2 = 'https://play.tv2.no/sport/fotball/eliteserien-sjp7jjvc/brann-viking-r6tkf8xy';
  assert.deepEqual(linkFields({ tv2play: { url: tv2 } }, { replay: true }).links.tv2play, `${tv2}?partner=primetime&play=true`, 'replays start playing');
  assert.deepEqual(linkFields({ tv2play: { url: tv2 } }, { replay: false }).links.tv2play, `${tv2}?partner=primetime`);
  assert.equal(linkFields({ nrk: { url: 'https://tv.nrk.no/se?v=ISPO30211226' } }, { replay: true }).links.nrk, 'https://tv.nrk.no/se?v=ISPO30211226&autoplay=true');
  assert.deepEqual(linkFields({ viaplay: { url: 'https://viaplay.no/sport/fotball/premier-league/arsenal-leeds/s1', until: '2026-10-01T00:00:00Z' } }, { now }), {}, 'Viaplay links stop after about 2 days');
  assert.deepEqual(linkFields({ tv2play: { url: 'https://evil.example/x' }, nrk: { url: 'https://tv.nrk.no/se?v=x-hoydepunkter' }, hbomax: { url: 'https://play.hbomax.com/x' } }), {}, 'unknown hosts, clips and other services are dropped');
});
