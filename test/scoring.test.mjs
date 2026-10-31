// Checks the scores against real matches we know the feel of.
// If you change a formula, these should still pass (or be updated on purpose).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
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
  assert.ok(franceEngland64.score >= 7.5, `4-6 got ${franceEngland64.score}`); // 7.8 since football 20 with equal pillars (Drama nearly full, Tension middling: 4–0 at half-time)
  assert.ok(mexicoEngland23.score >= 6.5); // 6.7 since football 20 (equal pillars)
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
  assert.ok(viking81.score >= 5 && viking81.score < 7, `8-1 got ${viking81.score}`); // 5.2 since football 20 (Drama 25%)
  assert.ok(bayernBodo50.score < 6.5, `5-0 got ${bayernBodo50.score}`); // football 17: the one-sided penalty was halved
  assert.ok(viking81.score > franceSweden30.score, 'nine goals beat a plain 3-0');
  assert.ok(spursVilla23.score >= viking81.score + 2, `even 2-3 got ${spursVilla23.score}`);
  // The same match without odds still punishes the blowout, just less.
  const noOdds = scoreFootball({ ...factsFromSummary(fixture('football/401843437.json')), odds: null });
  assert.ok(noOdds.score < 7.5 && noOdds.score > viking81.score, `8-1 without odds got ${noOdds.score}`);
});

test('football: an upset scores higher than the same result the expected way round', () => {
  const facts = factsFromSummary(fixture('football/760514.json')); // France 0-2 Spain
  const expected = scoreFootball({ ...facts, odds: { home: 0.15, draw: 0.2, away: 0.65 } }).score;
  const upset = scoreFootball({ ...facts, odds: { home: 0.65, draw: 0.2, away: 0.15 } }).score;
  assert.ok(upset >= expected + 1, `upset ${upset}, expected ${expected}`); // 1.2 since football 20 (Drama 25%)
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
    assert.ok(reasons.every(([p, label]) => typeof p === 'number' && typeof label === 'string' && label));
    // Football since football 20: the weighted average of the pillars plus the occasion lines.
    const football = reasons.some((r) => r[2] === 'average');
    const sum = reasons.filter((r) => !football || ['average', 'occasion'].includes(r[2])).reduce((a, [p]) => a + p, 0);
    if (football) assert.equal(reasons.find((r) => r[2] === 'final')[0], score, 'the final line is the score');
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
      const max = name === 'curveFrom' || name === 'typicalMatch' ? 9 : name === 'settleMinutes' ? 90 : 5; // points on the 0–10 scale; minutes of play
      assert.ok(typeof w === 'number' && Number.isFinite(w) && w >= 0 && w <= max, `${sport}.${name} is ${w}: use a number from 0 to ${max}`);
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

test('football 17: end to end, and late goals that change the result', () => {
  const facts = factsFromSummary(fixture('football/401879276.json')); // Bournemouth 0–1 Liverpool
  const even = scoreFootball({ ...facts, shotsBy: { home: 12, away: 12 } });
  const oneWay = scoreFootball({ ...facts, shotsBy: { home: 25, away: 4 } });
  assert.ok(even.score > oneWay.score, `end to end ${even.score} vs one-way ${oneWay.score}`);
  assert.ok(even.reasons.some(([, l]) => /^End to end: 12 shots against 12$/.test(l)));
  assert.ok(!oneWay.reasons.some(([, l]) => /End to end/.test(l)), 'nothing for one-way traffic');
  // A 90th-minute equaliser counts extra; the same goal at 2–0 down doesn't.
  const base = { ...facts, shotsBy: null, goals: [{ min: 30, side: 'home' }] };
  const equaliser = scoreFootball({ ...base, goals: [...base.goals, { min: 89.9, side: 'away' }] });
  const consolation = scoreFootball({ ...base, goals: [{ min: 20, side: 'home' }, ...base.goals, { min: 89.9, side: 'away' }] });
  assert.ok(equaliser.reasons.some(([, l]) => /from 85' that changed the result/.test(l)));
  assert.ok(!consolation.reasons.some(([, l]) => /changed the result/.test(l)));
});

test('football: an underdog winning big is a shock, not a blowout', () => {
  const facts = factsFromSummary(fixture('football/760492.json')); // France 3-0 Sweden
  const expected = scoreFootball({ ...facts, odds: { home: 0.74, draw: 0.17, away: 0.09 } });
  const shock = scoreFootball({ ...facts, odds: { home: 0.09, draw: 0.17, away: 0.74 } });
  assert.ok(!shock.reasons.some(([, l]) => /One-sided/.test(l)), 'no blowout penalty for the underdog');
  assert.ok(shock.score >= expected.score + 0.5, `shock ${shock.score}, expected ${expected.score}`); // 0.8 since football 21 (no extra for the underdog's goals: the swing line counts them)
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

// From 2026/27 FIS shows a "live"/"review" badge by each race and a ski brand column in results.
test('FIS pages: the 2026/27 layout (Soelden, men\'s giant slalom)', () => {
  const f = winter('alpine-soelden-2026-men-giant-slalom');
  for (const html of [f.eventHtml, f.eventHtml.replace(/>review</g, '>live<')]) {
    assert.deepEqual(fis.racesFromEvent(html).map((r) => [r.discipline, r.venue, r.gender, r.official]),
      [['Giant Slalom', null, 'women', true], ['Giant Slalom', null, 'men', true]]);
  }
  const p = fisPage('alpine-soelden-2026-men-giant-slalom');
  assert.deepEqual(p.rows[0], { rank: 1, bib: 4, name: 'PINHEIRO BRAATHEN Lucas', nation: 'BRA', times: [52.4, 52.32, 104.72] });
  assert.equal(p.rows[1].nation, 'SUI');
  assert.equal(p.rows.length, 26);
  assert.ok(p.out.every((o) => /^[A-Z]{3}$/.test(o.nation) && o.run1 > 50), 'unranked rows: nation and run-1 time');
  assert.equal(fis.alpineFacts(p).winnerRun1, 1);
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
  const facts = factsFromSummary(fixture('football/401879276.json')); // Bournemouth 0–1 Liverpool: below the curve, so the bonus shows in full
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

test('stakes: the Championship has a promotion race, the Conference League a 6-match table', () => {
  const champ = [{ name: 'EFL', rows: [80, 60, 58, 57, 56, 55, 54, ...new Array(17).fill(40)].map((p, i) => ({ team: `T${i + 1}`, rank: i + 1, points: p, played: 30 })) }];
  assert.equal(stakesFor(champ, 'T2', 'T3', 'eng.2'), 'promotion');
  assert.equal(stakesFor(champ, 'T5', 'T7', 'eng.2'), 'playoff');
  const ecl = (played) => [{ name: 'League Phase', rows: new Array(36).fill(0).map((_, i) => ({ team: `T${i + 1}`, rank: i + 1, points: 12 - Math.floor(i / 3), played })) }];
  assert.equal(stakesFor(ecl(3), 'T8', 'T9', 'uefa.europa.conf'), 'top8', 'halfway through 6 matches');
  assert.equal(stakesFor(ecl(3), 'T8', 'T9', 'uefa.europa'), null, 'the Europa League plays 8');
});

test('FotMob xG: shots, sides and minutes; team names matched loosely', async () => {
  const fm = await import('../src/sources/fotmob.mjs');
  const xg = fm.xgFromDetails(fixture('football/fotmob-valerenga-fredrikstad.json')); // 1.45 – 0.75 on FotMob
  assert.equal(xg.home, 1.45);
  assert.equal(xg.away, 0.75);
  assert.ok(xg.shots.every((s) => s.min >= 0 && s.min < 90 && ['home', 'away'].includes(s.side)));
  assert.ok(xg.shots.some((s) => s.min === 89.9), 'stoppage time stays inside the second half');
  assert.equal(fm.xgFromDetails({ general: { homeTeam: { id: 1 } }, content: {} }), null, 'no shot map: no xG');
  // Team stats: Greece 0–2 Germany, Nations League 2026 (content.stats.Periods.All).
  const stats = fm.statsFromDetails(fixture('football/fotmob-stats-greece-germany.json'));
  assert.deepEqual(stats, { touchesInBox: { home: 8, away: 43 }, bigChances: { home: 2, away: 1 }, xgot: { home: 0.64, away: 0.57 } });
  assert.equal(fm.statsFromDetails({ general: {}, content: {} }), null, 'no stats section: null, and the score is as without FotMob');
  const oneNil = factsFromSummary(fixture('football/401879276.json')); // Bournemouth 0–1 Liverpool
  const plain = scoreFootball({ ...oneNil, xg: null, stats: null });
  const busy = scoreFootball({ ...oneNil, xg: null, stats: { touchesInBox: { home: 50, away: 40 }, bigChances: { home: 5, away: 4 }, xgot: { home: 2.5, away: 2 } } });
  assert.ok(busy.score > plain.score + 1, `busy ${busy.score} vs plain ${plain.score}`);
  assert.ok(busy.reasons.some(([, l]) => l === '9 big chances') && busy.reasons.some(([, l]) => /xGOT$/.test(l)) && busy.reasons.some(([, l]) => /touches in the opposition box$/.test(l)));
  assert.equal(scoreFootball({ ...oneNil, xg: null, stats: { touchesInBox: null, bigChances: null, xgot: null } }).score, plain.score, 'stats FotMob does not show are left out');
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

test('football with and without xG; higher scores are harder to reach', () => {
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
  // The curve: above curveFrom each point counts a bit less, bending towards 10, with a line saying so.
  const CURVE = 'Higher scores are harder to reach';
  const raw = noXg.reasons.filter((r) => ['average', 'occasion'].includes(r[2]) && r[1] !== CURVE).reduce((a, [p]) => a + p, 0);
  assert.ok(raw <= WEIGHTS.FOOTBALL.curveFrom + 0.3 || noXg.reasons.some(([, l]) => l === CURVE)); // just above: the bend rounds to 0
  const a = WEIGHTS.FOOTBALL.curveFrom;
  const curve = (x) => (x <= a ? x : a + (10 - a) * (1 - Math.exp(-(x - a) / (10 - a))));
  assert.ok(Math.abs(noXg.score - curve(raw)) <= 0.15, `score ${noXg.score} vs curve ${curve(raw)}`);
  assert.ok(curve(30) < 10 && curve(a) === a && curve(9) > 8, 'smooth, and never quite 10');
});

test('big match: the same match scores higher between two strong teams', async () => {
  const W = (await import('../src/scoring/weights.mjs')).FOOTBALL;
  const facts = factsFromSummary(fixture('football/760492.json')); // France 3-0 Sweden
  const strong = scoreFootball({ ...facts, strength: { home: 0.95, away: 0.9 } });
  const average = scoreFootball({ ...facts, strength: { home: 0.6, away: 0.4 } });
  const weak = scoreFootball({ ...facts, strength: { home: 0.1, away: 0.05 } });
  const unknown = scoreFootball({ ...facts, strength: null });
  assert.ok(strong.score > average.score && average.score > weak.score, `${strong.score} > ${average.score} > ${weak.score}`);
  assert.equal(average.score, unknown.score, 'an average pair, or unknown teams: no change');
  assert.ok(!unknown.reasons.some(([, l]) => /×/.test(l)), 'no big-match line without ratings');
  assert.ok(strong.reasons.some(([, l]) => /^Big match: two strong teams \(×1\.13\)$/.test(l)), strong.reasons.join(' | '));
  assert.ok(weak.reasons.some(([, l]) => /^Two weaker teams \(×0\.77\)$/.test(l)), 'a weak pair loses more (smallMatch) than a strong pair gains (bigMatch)');
  const before = W.bigMatch, beforeSmall = W.smallMatch;
  try {
    W.bigMatch = 0; // the off switches
    W.smallMatch = 0;
    assert.equal(scoreFootball({ ...facts, strength: { home: 1, away: 1 } }).score, unknown.score);
    assert.equal(scoreFootball({ ...facts, strength: { home: 0, away: 0 } }).score, unknown.score);
  } finally {
    W.bigMatch = before;
    W.smallMatch = beforeSmall;
  }
});

test('team ratings: parsing, names and each team\'s strength', async () => {
  const { parseClubElo, parseWorldElo, clubElo, nationElo, strengthOf, updateRatings } = await import('../src/sources/ratings.mjs');
  const clubs = parseClubElo('Rank,Club,Country,Level,Elo,From,To\n1,Liverpool,ENG,1,2000.95,2025-01-23,2025-01-23\n5,Man City,ENG,1,1932.33,x,y\nNone,Bodoe Glimt,NOR,1,1582.45,x,y\nNone,Ham-Kam,NOR,1,1309.38,x,y\nNone,Tromso,NOR,1,1372.6,x,y\n');
  assert.deepEqual(clubs, { Liverpool: 2001, 'Man City': 1932, 'Bodoe Glimt': 1582, 'Ham-Kam': 1309, Tromso: 1373 });
  for (const [espn, elo] of [['Manchester City', 1932], ['Bodo/Glimt', 1582], ['Bodø/Glimt', 1582], ['Hamarkameratene', 1309], ['Tromsø', 1373], ['Liverpool', 2001], ['Vålerenga', null]]) {
    assert.equal(clubElo(clubs, espn), elo, espn);
  }
  const nations = parseWorldElo('1\t1\tES\t2287\t2290\n12\t12\tNO\t1900\t1950\n38\t38\tTR\t1800\t1850\n', 'ES\tSpain\nNO\tNorway\tNorge\nTR\tTurkey\tTürkiye\nXX\tNowhere\n');
  assert.deepEqual(nations, { Spain: 2287, Norway: 1900, Norge: 1900, Turkey: 1800, 'Türkiye': 1800 });
  assert.equal(nationElo(nations, 'Türkiye'), 1800);
  // National teams: the world scale, 1400 = 0 to 2100 = 1.
  const n = strengthOf({ nations }, 'uefa.nations', 'Spain', 'Norway');
  assert.equal(n.home, 1);
  assert.ok(Math.abs(n.away - 500 / 700) < 1e-9);
  assert.equal(strengthOf({ nations }, 'uefa.nations', 'Spain', 'Atlantis'), null, 'an unknown team: no big-match line');
  // Clubs: half against their own league, half on the world scale (1450 = 0, 2050 = 1).
  const leagues = { 'nor.1': { 'Bodø/Glimt': 1582, 'SK Brann': 1496, Molde: 1498, Tromso: 1373, Vålerenga: null } };
  const W = WEIGHTS.FOOTBALL;
  const mixed = strengthOf({ leagues }, 'nor.1', 'Bodø/Glimt', 'Vålerenga');
  assert.ok(Math.abs(mixed.home - (0.5 * 1 + 0.5 * (1582 - 1450) / 600)) < 1e-9, `half rank, half world: ${mixed.home}`);
  assert.equal(mixed.away, 0, 'unlisted, under 1450 on the world scale too');
  const pl = strengthOf({ leagues: { 'eng.1': { A: 2040, B: 1900, C: 1800, D: 1700 } } }, 'eng.1', 'C', 'D');
  assert.ok(Math.abs(pl.away - 0.5 * (1700 - 1450) / 600) < 1e-9, `the weakest of a strong league keeps its world half: ${pl.away}`);
  const levelBefore = W.leagueLevel;
  W.leagueLevel = 0; // the rest checks the league rank alone
  const s = strengthOf({ leagues }, 'nor.1', 'Bodø/Glimt', 'Vålerenga');
  assert.equal(s.home, 1, 'the strongest in the league');
  assert.equal(s.away, 0, 'unknown = under the weakest listed club (Tromso)');
  assert.equal(strengthOf({ leagues }, 'nor.1', 'Molde', 'SK Brann').home, 0.75);
  // Two unlisted clubs: the one with more points per game ranks higher, both under every listed club.
  const two = { 'nor.1': { ...leagues['nor.1'], Sandefjord: null } };
  const ppg = { 'nor.1': { Vålerenga: 1.1, Sandefjord: 1.8 } };
  const u = strengthOf({ leagues: two, ppg }, 'nor.1', 'Vålerenga', 'Sandefjord');
  assert.ok(u.home === 0 && u.away === 0.2 && u.away < strengthOf({ leagues: two, ppg }, 'nor.1', 'Tromso', 'Molde').home, JSON.stringify(u));
  W.leagueLevel = levelBefore;
  assert.equal(strengthOf({ leagues }, 'eng.1', 'Molde', 'SK Brann'), null, 'no field for that league');
  // Both sites down: the seeds are used and nothing throws.
  const state = {};
  const tablesFor = async (key) => (key === 'nor.1' ? [{ name: 'Eliteserien', rows: [{ team: 'Bodø/Glimt' }, { team: 'SK Brann' }, { team: 'Viking FK' }, { team: 'Molde' }, { team: 'KFUM Oslo' }] }] : null);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' }); // 404 on purpose: a 5xx is retried after a sleep
  try {
    await updateRatings(state, new Date('2026-10-09T12:00:00Z'), tablesFor);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(state.ratings.clubsDate, undefined, 'no good list yet');
  assert.equal(state.ratings.clubsTried, '2026-10-09', 'so it is tried again tomorrow, not at every build');
  assert.equal(state.ratings.leagues['nor.1']['Bodø/Glimt'], 1779, 'the seed fills the league');
  assert.ok(strengthOf(state.ratings, 'nor.1', 'Bodø/Glimt', 'KFUM Oslo').home > 0.7, 'the best of the league, on the world scale a bit above the middle');
  assert.ok(strengthOf(state.ratings, 'uefa.nations', 'England', 'Spain').home > 0.9, 'the national seed works too');
  // Still down next season: the field follows the new table (a promoted club joins, a relegated one leaves).
  const nextSeason = async () => [{ name: 'Eliteserien', rows: ['Bodø/Glimt', 'SK Brann', 'Viking FK', 'Molde', 'Ham-Kam'].map((team) => ({ team })) }];
  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  try {
    await updateRatings(state, new Date('2027-04-01T12:00:00Z'), nextSeason);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(Object.keys(state.ratings.leagues['nor.1']).sort(), ['Bodø/Glimt', 'Ham-Kam', 'Molde', 'SK Brann', 'Viking FK']);
  assert.equal(state.ratings.leagues['nor.1']['Ham-Kam'], null, 'the newcomer is under the seed\'s 1500 cutoff: unlisted, ranked by points per game');
  assert.equal(state.ratings.leagues['nor.1']['Viking FK'], 1693, 'a listed newcomer gets the seed rating');
  // Saved ratings from an older seed (football 16 used January 2025): replaced by the new seed once, then kept.
  const older = { ratings: { clubsTried: '2026-10-09', nationsTried: '2026-10-09', leagues: { 'nor.1': { 'Bodø/Glimt': 1582, 'SK Brann': 1500, 'Viking FK': 1450, Molde: 1600, 'KFUM Oslo': 1300 } } } };
  globalThis.fetch = async () => ({ ok: false, status: 404, statusText: 'Not Found' });
  try {
    await updateRatings(older, new Date('2026-10-09T13:00:00Z'), tablesFor);
    assert.equal(older.ratings.leagues['nor.1']['Bodø/Glimt'], 1779, 'the newer seed replaces the old numbers');
    assert.equal(older.ratings.clubSeed, '2026-09-27');
    older.ratings.leagues['nor.1']['Bodø/Glimt'] = 1800; // as if a later good list had set it
    await updateRatings(older, new Date('2026-10-09T14:00:00Z'), tablesFor);
    assert.equal(older.ratings.leagues['nor.1']['Bodø/Glimt'], 1800, 'only once');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(parseWorldElo('1\t1\tUS\t1800\n', 'US\tUnited States\tUSA\n').USA, 1800, 'other spellings count too');
  // The page's list: one number per football team, from its league field or the world list.
  const { eloList } = await import('../src/sources/ratings.mjs');
  const list = eloList({ leagues, nations }, [
    { sport: 'football', comp: 'nor.1', teams: ['Bodø/Glimt', 'Vålerenga'] },
    { sport: 'football', comp: 'uefa.nations', teams: ['Spain', 'Atlantis'] },
    { sport: 'tennis', players: ['A', 'B'] },
  ]);
  assert.deepEqual(list, { 'Bodø/Glimt': 1582, Spain: 2287 }, 'unknown ratings are left out');
  // A good list is kept for a week: no requests in between, and a failed site waits a day.
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 404, statusText: 'Not Found' }; };
  try {
    const fresh = { ratings: { clubsDate: '2027-04-01', nationsDate: '2027-04-01', leagues: {} } };
    await updateRatings(fresh, new Date('2027-04-07T12:00:00Z'), async () => null);
    assert.equal(calls, 0, 'six days old: no fetch');
    await updateRatings(fresh, new Date('2027-04-08T12:00:00Z'), async () => null);
    assert.equal(calls, 2, 'a week old: Club Elo and eloratings (its second file is skipped when the first fails)');
    await updateRatings(fresh, new Date('2027-04-08T18:00:00Z'), async () => null);
    assert.equal(calls, 2, 'failed today: not again until tomorrow');
  } finally {
    globalThis.fetch = realFetch;
  }
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

// Custom scoring: the page re-scores football from docs/data/facts.json (trimFacts) with docs/scoring.js.
test('football: the trimmed facts (facts.json) give exactly the same score and reasons', async () => {
  const { trimFacts } = await import('../src/publish.mjs');
  const { readdirSync } = await import('node:fs');
  const extra = { stakes: 'title', xg: { home: 1.73, away: 0.912, shots: [{ min: 12, side: 'home', xg: 0.3 }] },
    stats: { bigChances: { home: 3, away: 2 }, xgot: { home: 1.1, away: 0.7 }, touchesInBox: { home: 30, away: 21 } }, strength: { home: 0.81234, away: 0.4321 } };
  for (const file of readdirSync(new URL('./fixtures/football/', import.meta.url)).filter((f) => /^\d+\.json$/.test(f))) {
    const facts = factsFromSummary(fixture(`football/${file}`));
    for (const f of [facts, { ...facts, ...extra }, { ...facts, ...extra, xg: { ...extra.xg, bangers: [12], bigMisses: [88] } }]) {
      const bot = scoreFootball(f);
      const page = scoreFootball(JSON.parse(JSON.stringify(trimFacts(f)))); // through JSON, like the file
      assert.equal(page.score, bot.score, `${file}: score`);
      assert.deepEqual(page.reasons, bot.reasons, `${file}: reasons`);
    }
  }
});

test('football: the real facts.json re-scores every event exactly as the bot did', { skip: !existsSync(new URL('../docs/data/facts.json', import.meta.url)) }, () => {
  const read = (f) => JSON.parse(readFileSync(new URL(`../docs/data/${f}`, import.meta.url)));
  const { events, footballWeights } = read('events.json');
  const facts = read('facts.json');
  const reasons = read('reasons.json');
  for (const e of events.filter((x) => x.sport === 'football' && facts[x.id] && x.v === SCORING_VERSIONS.football)) {
    const s = scoreFootball(facts[e.id], footballWeights ?? WEIGHTS.FOOTBALL);
    assert.equal(s.score, e.score, `${e.id}: score`);
    assert.deepEqual(s.reasons, reasons[e.id], `${e.id}: reasons`);
  }
});

test('custom scoring: sliders, boosts and the clean-up of saved settings', async () => {
  const { applyTweaks, cleanTweaks, DEFAULT_TWEAKS, TWEAK_GROUPS, TWEAK_FIXED, isStandard } = await import('../docs/scoring.js');
  // Every football weight belongs to exactly one slider, or is deliberately fixed.
  const grouped = Object.values(TWEAK_GROUPS).flatMap((g) => g.keys);
  assert.equal(new Set(grouped).size, grouped.length, 'a weight in two sliders');
  const live = Object.keys(WEIGHTS.FOOTBALL_LIVE);
  assert.deepEqual([...grouped.filter((k) => !live.includes(k)), ...TWEAK_FIXED].sort(), Object.keys(WEIGHTS.FOOTBALL).sort(), 'every weight needs a slider (or TWEAK_FIXED)');
  assert.ok(grouped.every((k) => k in WEIGHTS.FOOTBALL || k in WEIGHTS.FOOTBALL_LIVE));

  const W = WEIGHTS.FOOTBALL;
  const std = cleanTweaks(null);
  assert.deepEqual(std, DEFAULT_TWEAKS);
  assert.ok(isStandard(std));
  assert.deepEqual(applyTweaks(W, std), W, 'standard sliders change nothing');
  const f = factsFromSummary(fixture('football/760516.json')); // France 4-6 England
  assert.equal(scoreFootball(f, applyTweaks(W, std)).score, scoreFootball(f).score);

  const noGoals = cleanTweaks({ v: 4, sliders: { goals: 0 } });
  const s0 = scoreFootball(f, applyTweaks(W, noGoals));
  assert.ok(!s0.reasons.some(([, l]) => /^10 goals$/.test(l)), 'Goals off: no goal line');
  assert.ok(s0.score < scoreFootball(f).score);
  const tw = applyTweaks(W, cleanTweaks({ v: 4, sliders: { late: 2, bigMatch: 3 } }));
  assert.ok(tw.smallMatch <= 1, 'shares stay parts of 1');
  assert.equal(tw.lateGoal, W.lateGoal * 2);
  assert.equal(applyTweaks(W, cleanTweaks({ curveFrom: 6 })).curveFrom, 6);

  // Boost: before the curve, so +1 lifts a top match less than an ordinary one; always 0–10.
  const dull = factsFromSummary(fixture('football/401879276.json')); // Bournemouth 0-1 Liverpool
  const lift = (x, b) => scoreFootball(x, W, { boost: b, boostLabel: 'Premier League' }).score - scoreFootball(x).score;
  assert.ok(lift(dull, 1) > lift(f, 1), 'a boost lifts an ordinary match more than a top one');
  assert.ok(scoreFootball(f, W, { boost: 1, boostLabel: 'World Cup' }).reasons.some(([p, l]) => p === 1 && l === 'World Cup: your boost'));
  assert.ok(scoreFootball(dull, W, { boost: -2 }).score >= 0);

  // Junk in, defaults out; numbers snap to the slider steps.
  assert.deepEqual(cleanTweaks({ v: 4, on: 'yes', sliders: { goals: 70, tight: -1, late: 'x', nope: 1 }, curveFrom: 99, comps: { 'eng.1': 1.3, 'nor.1': 0, bad: 'x' } }),
    { ...DEFAULT_TWEAKS, sliders: { ...DEFAULT_TWEAKS.sliders, goals: 50, tight: 0 }, curveFrom: 9, comps: { 'eng.1': 1.5 } });
  assert.equal(cleanTweaks({ v: 4, sliders: { goals: 1.13456 } }).sliders.goals, 1.135, 'multipliers behind the points, not snapped');
  assert.equal(cleanTweaks({ v: 2, on: true, sliders: { goals: 2 }, comps: { 'eng.1': 1 } }).sliders.goals, 1, 'sliders saved before football 20 go back to standard');
  assert.deepEqual(cleanTweaks({ v: 2, on: true, sliders: { goals: 2 }, comps: { 'eng.1': 1 } }).comps, { 'eng.1': 1 }, 'boosts are kept');

  // The scale: each slider's typical points with the standard weights, from the fixtures.
  const { sliderScale } = await import('../docs/scoring.js');
  const all = ['760516', '401843437', '401879276', '760512'].map((id) => factsFromSummary(fixture(`football/${id}.json`)));
  const scale = sliderScale(all, W);
  assert.ok(scale.goals > scale.endToEnd && scale.goals > 1, `goals ${scale.goals} vs end to end ${scale.endToEnd}`);
  assert.ok(Object.values(scale).every((v) => v > 0));
});

test('football 20: four pillars scored 0–10, a weighted average, then the occasion', async () => {
  const { applyTweaks, cleanTweaks, PILLARS, TWEAK_GROUPS } = await import('../docs/scoring.js');
  const { pillarScore, pillarShares, PILLAR_KEYS } = await import('../docs/live.js');
  const W = WEIGHTS.FOOTBALL;
  for (const [k, g] of Object.entries(TWEAK_GROUPS)) assert.ok(g.pillar in PILLARS || ['bigMatch', 'stakes'].includes(k), k);
  assert.ok(Object.values(PILLARS).every((p) => p.label && p.hint.length > 20), 'each pillar has a description');
  // The standard weights are shares adding up to 1; a soft ceiling: the scale gives 6.3, twice as much 8.6, never 10.
  assert.ok(Math.abs(Object.values(pillarShares(W)).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(pillarScore(W.dramaScale, W.dramaScale) - 6.32) < 0.01 && Math.abs(pillarScore(2 * W.dramaScale, W.dramaScale) - 8.65) < 0.01);
  assert.ok(pillarScore(20, 1) < 10 && pillarScore(-1, 1) === 0);
  // The score is the weighted average of the pillar scores, then the occasion lines.
  const all = ['760516', '401843437', '401879276', '760512'].map((id) => factsFromSummary(fixture(`football/${id}.json`)));
  for (const f of all) {
    const s = scoreFootball(f);
    const avg = PILLAR_KEYS.reduce((a, p) => a + s.shares[p] * s.pillarScores[p], 0);
    const occ = s.reasons.filter((r) => r[2] === 'occasion').reduce((a, [p]) => a + p, 0);
    assert.ok(Math.abs(Math.min(10, avg + occ) - s.score) <= 0.15, `${avg} + ${occ} vs ${s.score}`);
    // Each pillar's lines add up to its score.
    for (const p of PILLAR_KEYS) {
      const head = s.reasons.find((r) => r[2] === 'pillar' && r[1] === p)[0];
      const sum = s.reasons.filter((r) => r[2] === p).reduce((a, [x]) => a + x, 0);
      assert.ok(Math.abs(head - sum) <= 0.25, `${p}: ${head} vs ${sum}`);
    }
  }
  // Pillar weights: percent, any numbers (only the shares count); all four off is the standard mix.
  assert.deepEqual(cleanTweaks({ v: 4, pillars: { chances: 30.4, tempo: 120, tension: -1, drama: 50 } }).pillars, { chances: 30, tempo: 100, tension: 0, drama: 50 });
  assert.equal(cleanTweaks({ v: 4, pillars: { chances: 0, tempo: 0, tension: 0, drama: 0 } }).pillars, null);
  assert.equal(cleanTweaks({ v: 3, pillars: { chances: 2, tempo: 1, tension: 1, drama: 1 } }).pillars, null, 'football 19 sliders go back to standard');
  const doubled = Object.fromEntries(PILLAR_KEYS.map((p) => [p, Math.round(200 * W[`pillar${p[0].toUpperCase()}${p.slice(1)}`])]));
  assert.deepEqual(all.map((f) => scoreFootball(f, applyTweaks(W, cleanTweaks({ v: 4, pillars: doubled }))).score), all.map((f) => scoreFootball(f).score), 'only the shares count');
  assert.ok(scoreFootball(all[0], applyTweaks(W, cleanTweaks({ v: 4, pillars: { chances: 10, tempo: 10, tension: 20, drama: 60 } }))).score !== scoreFootball(all[0]).score);
});

test('football 20: comebacks, live shots per team, the transition', async () => {
  const { comebackOf } = await import('../docs/scoring.js');
  const { liveFacts, scoreLivePace, liveWeightsFrom } = await import('../docs/live.js');
  const seq = (s) => [...s].map((c, i) => ({ min: i * 5 + 1, side: c === 'h' ? 'home' : 'away' }));
  assert.equal(comebackOf(seq('hha')), 2, '2–0 to 2–1');
  assert.equal(comebackOf(seq('hhhhaaaa')), 4, '0–4 to 4–4');
  assert.equal(comebackOf(seq('hhh')), 0);
  assert.equal(comebackOf(seq('hah')), 0, 'never 2 down');
  // ESPN names the team on some competitions' commentary only: shots per team then, or null.
  assert.ok(liveFacts(fixture('football/401843437.json')).shotsBy.home > 0, 'Viking: teams named');
  assert.equal(liveFacts(fixture('football/760516.json')).shotsBy, null, 'France–England: no team names');
  // Without shots per team the live Tempo counts as an ordinary match, not as 0.
  const w = liveWeightsFrom(WEIGHTS.FOOTBALL, WEIGHTS.FOOTBALL_LIVE);
  const f = { ...liveFacts(fixture('football/760516.json')), played: 90 };
  assert.ok(scoreLivePace(f, { w }).pace > scoreLivePace({ ...f, shotsBy: { home: 0, away: 0 } }, { w }).pace);
  // Weights from before football 20 (a cached events.json) can't score: it's refused, not shown as nonsense.
  const old = Object.fromEntries(Object.entries(WEIGHTS.FOOTBALL).filter(([k]) => !/Scale$/.test(k)));
  assert.throws(() => scoreFootball(factsFromSummary(fixture('football/760516.json')), old));
});

test('football 19: suspense, swing, red cards for the team ahead, great goals, stoppage time', async () => {
  const { suspenseOf, ratesFromOdds } = await import('../docs/live.js');
  const W = WEIGHTS.FOOTBALL;
  // The favorite's rate is higher; a 1–0 for a big favorite is less open than a 1–0 for the underdog.
  const fav = { home: 0.75, draw: 0.17, away: 0.08 };
  const [lh, la] = ratesFromOdds(fav);
  assert.ok(lh > la);
  const favLeads = suspenseOf([{ t: 20, side: 'home' }], fav, 90).suspense;
  const dogLeads = suspenseOf([{ t: 20, side: 'away' }], fav, 90).suspense;
  assert.ok(dogLeads > favLeads, `${dogLeads} > ${favLeads}`);
  assert.ok(suspenseOf([], fav, 90).swing === 0);
  // A 0–0 between equals is more open than a favorite's 3–0.
  const even = { home: 0.37, draw: 0.28, away: 0.35 };
  assert.ok(suspenseOf([], even, 90).suspense > suspenseOf([10, 30, 50].map((t) => ({ t, side: 'home' })), fav, 90).suspense);

  const base = { goals: [{ min: 30, side: 'home' }], odds: even, reds: [70], pens: [], disallowed: [], woodwork: [], corners: 8, yellows: 3, shotsOnTarget: 8, totalShots: 24, extraTime: false, shootout: false };
  const ahead = scoreFootball({ ...base, redsBy: [{ min: 70, side: 'home' }] }, W);
  const behind = scoreFootball({ ...base, redsBy: [{ min: 70, side: 'away' }] }, W);
  assert.ok(ahead.score > behind.score, 'a red for the team ahead opens it up');
  assert.ok(behind.score >= scoreFootball(base, W).score, 'a red for the team behind is never a penalty');
  assert.ok(scoreFootball({ ...base, bangers: [30] }, W).score > scoreFootball({ ...base, bangers: [] }, W).score);
  assert.ok(scoreFootball({ ...base, bigMisses: [88] }, W).score > scoreFootball({ ...base, bigMisses: [20] }, W).score, 'a late big chance while close');
  // A winner in the very last minute still swings the win chances.
  assert.ok(suspenseOf([{ t: 95, side: 'home' }], even, 95).swing > 0.5);
  // ESPN's stoppage clocks.
  const { stoppageOf } = await import('../src/sources/espn-football.mjs');
  assert.deepEqual(stoppageOf([{ period: { number: 1 }, clock: { displayValue: "45'+3'" } }, { period: { number: 2 }, clock: { displayValue: "90'+6'" } }, { period: { number: 2 }, clock: { displayValue: "67'" } }]), [3, 6]);
  // Stoppage time counts: a 1–0 at 30' is within one goal for the whole match either way, so the share is 100%.
  assert.ok(scoreFootball({ ...base, stoppage: [3, 6] }, W).reasons.some(([, l]) => l === 'Within one goal for 100% of the match'));
});
