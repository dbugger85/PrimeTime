// Biathlon from open sources: the race list from Wikipedia, the results from IBU's
// PDF result sheets. Fixtures are trimmed real answers (test/fixtures/winter/biathlon-*.json).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { pdfRows } from '../src/pdf.mjs';
import * as ibu from '../src/sources/ibu.mjs';
import * as cal from '../src/sources/biathlon-calendar.mjs';
import { noResult } from '../src/sources/winter.mjs';
import { scoreBiathlon } from '../src/scoring/winter.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/winter/${name}.json`, import.meta.url)));
const factsOf = (name) => { const { race, result, analysis } = fixture(name); return ibu.factsFromRace(race, { result, analysis }); };
const wiki = fixture('biathlon-wikipedia');

// ---- The PDF reader --------------------------------------------------------

// A one-page PDF like IBU's: an Identity-H font with a ToUnicode map, a flipped page
// (y grows downwards), each cell drawn on its own, and the stream length in another object.
function tinyPdf() {
  const content = deflateSync(Buffer.from([
    'q 1 0 0 -1 0 800 cm',
    'BT /F1 -9 Tf 10 100 Td <00010002> Tj ET', // "KA" at the left of row 1
    'BT /F1 -9 Tf 60 100.5 Td <0003> Tj ET', // "B" further right, half a point lower: same row
    'BT /F1 -9 Tf 10 120 Td [<0002> -120 <0001>] TJ ET', // "AK" on row 2
    'Q',
  ].join('\n')));
  const cmap = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap 1 begincodespacerange <0000> <FFFF> endcodespacerange\n'
    + '1 beginbfchar <0001> <004B> endbfchar\n1 beginbfrange <0002> <0003> <0041> endbfrange\nendcmap end end';
  const parts = [
    '%PDF-1.6\n',
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
    '4 0 obj\n<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 6 0 R >>\nendobj\n',
  ];
  return Buffer.concat([
    Buffer.from(parts.join('')),
    Buffer.from('5 0 obj\n<< /Length 7 0 R /Filter /FlateDecode >>\nstream\n'), content, Buffer.from('\nendstream\nendobj\n'),
    Buffer.from(`6 0 obj\n<< /Length ${cmap.length} >>\nstream\n${cmap}\nendstream\nendobj\n`),
    Buffer.from(`7 0 obj\n${content.length}\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`),
  ]);
}

test('PDF reader: text pieces in rows, left to right, top to bottom', () => {
  assert.deepEqual(pdfRows(tinyPdf()), [['KA', 'B'], ['AK']]);
});

// ---- Result sheets -------------------------------------------------------------

test('result sheet: ranks, bibs, misses per shooting and gaps', () => {
  const ms = ibu.resultRows(fixture('biathlon-annecy-2025-women-mass-start').result);
  assert.deepEqual(ms[0], { rank: 1, bib: 5, name: 'KIRKEEIDE Maren', nat: 'NOR', misses: [1, 0, 0, 0], startBehind: null, behind: 0 });
  assert.equal(ms[1].behind, 0.3);
  const pu = ibu.resultRows(fixture('biathlon-annecy-2025-women-pursuit').result);
  assert.equal(pu[0].startBehind, 3, 'pursuit: the start gap is read, not taken for misses');
  assert.deepEqual(pu[0].misses, [0, 0, 0, 1]);
  assert.equal(pu[7].behind, 48.1, 'the "pursuit only" column after the points is not the gap');
  // A lapped athlete (no time) and a tie are handled.
  const rows = [['24', '1', 'A Anna', 'AUT', '0', '1', '1', '20:32.3', '+1:07.4', '17'], ['=24', '51', 'B Bea', 'ITA', '0', '1', '1', '20:32.3', '+1:07.4', '17'], ['80', '9', 'C Cia', 'SWE', '2', '3', '5', 'LAP']];
  assert.deepEqual(ibu.resultRows(rows).map((r) => [r.rank, r.behind]), [[24, 67.4], [24, 67.4]]);
  assert.equal(ibu.seconds('1:07:06.2'), 4026.2);
  assert.equal(ibu.seconds('LAP'), null);
});

test('competition analysis: each athlete\'s place after every loop', () => {
  const places = ibu.analysisPlaces(fixture('biathlon-annecy-2025-women-mass-start').analysis);
  assert.deepEqual(places.get(5), [23, 18, 6, 2, 1], 'the winner: 23rd after the first shooting');
  assert.deepEqual(places.get(1), [3, 9, 2, 4, 2]);
});

test('relay sheets: team order and penalty loops after each leg', () => {
  const teams = ibu.relayTeams(fixture('biathlon-ruhpolding-2026-women-relay').result);
  assert.deepEqual(teams.slice(0, 3).map((t) => [t.nat, t.behind]), [['NOR', 0], ['ITA', 0.9], ['SWE', 3]]);
  assert.deepEqual(teams[0].legs.map((l) => l.after), [8, 5, 4, 1]);
  const smr = ibu.relayTeams(fixture('biathlon-oestersund-2025-single-mixed-relay').result);
  assert.equal(smr[0].legs.length, 4, 'single mixed relay: two athletes, two legs each');
  assert.equal(smr[2].legs[2].loops, 1, 'France\'s third leg had a penalty loop');
});

test('the sheet\'s local start time becomes UTC', () => {
  const start = ibu.sheetStart(fixture('biathlon-annecy-2025-women-mass-start').result);
  assert.deepEqual(start, { day: 21, month: 11, year: 2025, hour: 12, minute: 15 });
  assert.equal(cal.utcFromLocal(start, 'FRA'), '2025-12-21T11:15:00.000Z');
  assert.equal(cal.utcFromLocal({ ...start, month: 10, day: 28 }, 'FIN'), '2025-11-28T10:15:00.000Z', 'Finland is an hour further east');
  assert.equal(cal.utcFromLocal({ year: 2026, month: 2, day: 22, hour: 13, minute: 45 }, 'NOR'), '2026-03-22T12:45:00.000Z', 'before summer time');
  assert.equal(cal.utcFromLocal({ year: 2026, month: 2, day: 29, hour: 13, minute: 45 }, 'NOR'), '2026-03-29T11:45:00.000Z', 'summer time');
});

// ---- Facts and tips ------------------------------------------------------------------

test('pursuit: won from bib 2, led all the way; without the analysis it still scores', () => {
  const f = factsOf('biathlon-annecy-2025-women-pursuit');
  assert.equal(f.winnerStart, 2);
  assert.deepEqual(f.leaders, [2, 2, 2, 2]);
  assert.equal(f.leadChanges, 0);
  const { race, result } = fixture('biathlon-annecy-2025-women-pursuit');
  const bare = ibu.factsFromRace(race, { result, analysis: null });
  assert.deepEqual(bare.leaders, []);
  assert.equal(bare.lastShootingLeaderWon, null, 'unknown, not "the leader didn\'t win"');
  const s = scoreBiathlon(bare);
  assert.equal(s.segments.length, 5);
  assert.ok(!s.reasons.some(([, l]) => /lead changed|didn't win/.test(l)));
});

test('which starters to watch: bibs for sprint and individual, shootings and legs for the rest', () => {
  // Oberhof sprint: the top 3 started 46, 48 and 22. It scored low, so: highlights.
  const sprint = factsOf('biathlon-oberhof-2026-women-sprint');
  assert.deepEqual(sprint.topBibs, [46, 48, 22]);
  assert.deepEqual(scoreBiathlon({ ...sprint, gapP2: 3, within30: 6 }).advice, { code: 'watch', unit: 'bib', ranges: [[21, 30], [41, 50]] });
  // Head-to-head: a skip window only over early shootings, and never the last shooting or the finish.
  const quiet = { ...factsOf('biathlon-annecy-2025-women-pursuit'), gapP2: 2, within10: 4 };
  const tip = scoreBiathlon(quiet).advice;
  assert.ok(tip.code !== 'watch', 'no bib tips in head-to-head races');
  if (tip.code === 'skip') assert.ok(tip.unit === 'stage' && tip.ranges[0][1] <= 3);
  // Relays: never the last leg.
  const relay = scoreBiathlon(factsOf('biathlon-ruhpolding-2026-women-relay')).advice;
  assert.deepEqual(relay, { code: 'skip', unit: 'leg', ranges: [[1, 1]] });
});

test('biathlon tips don\'t depend on who won', () => {
  // The same race whether the leader after the last shooting won or not, and whether the winner
  // came from far back or not: the skip tip only looks at the shootings before the last one.
  const f = { ...factsOf('biathlon-annecy-2025-women-mass-start'), gapP2: 12, gapP3: 20, within10: 1 };
  const variants = [true, false].flatMap((won) => [1, 23].map((worst) => scoreBiathlon({ ...f, lastShootingLeaderWon: won, winnerWorst: worst })));
  assert.ok(variants.every((v) => v.score >= 3 && v.score < 9), 'all in the range where a skip tip is possible');
  for (const v of variants) assert.deepEqual(v.advice, variants[0].advice);
});

// ---- The race list from Wikipedia -------------------------------------------------------

test('Wikipedia season calendar: stages, places, dates and stage pages', () => {
  const s = cal.stagesFromSeason(wiki.season2526, '2526');
  assert.equal(s.length, 10, 'nine World Cup stages and the Olympics');
  const annecy = s.find((x) => x.code === 'CP03');
  assert.equal(annecy.place, 'Annecy–Le Grand-Bornand');
  assert.equal(annecy.country, 'FRA');
  assert.equal(annecy.first.toISOString().slice(0, 10), '2025-12-18');
  assert.equal(annecy.page, '2025–26 Biathlon World Cup – Stage 3');
  assert.equal(s.find((x) => x.code === 'CP04').page, '2025–26 Biathlon World Cup – Stage 4', '&nbsp; in the link');
  assert.deepEqual(s.find((x) => x.code === 'OG__'), { ...s.find((x) => x.code === 'OG__'), series: 'Olympics', page: 'Biathlon at the 2026 Winter Olympics' });
  const next = cal.stagesFromSeason(wiki.season2627, '2627');
  assert.equal(next.find((x) => x.code === 'CH__').page, 'Biathlon World Championships 2027');
  assert.equal(next.find((x) => x.code === 'CP01').page, null, 'no stage page yet');
  assert.equal(next.find((x) => x.code === 'CP04').first.toISOString().slice(0, 10), '2026-12-31', 'across the new year');
  assert.equal(next.find((x) => x.code === 'CP04').last.toISOString().slice(0, 10), '2027-01-03');
});

test('Wikipedia schedules: every race with its IBU code and start', () => {
  const annecy = cal.racesFromSchedule(wiki.stage3, { country: 'FRA' }, '2526');
  assert.deepEqual(annecy.map((r) => r.cat + r.disc), ['SWSP', 'SMSP', 'SWPU', 'SMPU', 'SWMS', 'SMMS']);
  assert.equal(annecy[4].name, "Women's 12.5 km mass start");
  assert.equal(ibu.raceIdOf('2526', 'CP03', annecy[4].cat, annecy[4].disc), 'BT2526SWRLCP03SWMS', 'the same ids as before');
  const oe = cal.racesFromSchedule(wiki.stage1, { country: 'SWE' }, '2526');
  assert.deepEqual(oe.slice(0, 4).map((r) => [r.cat + r.disc, r.name]), [['SWRL', "Women's 4x6 km relay"], ['SMRL', "Men's 4x7.5 km relay"], ['MXSR', 'Single mixed relay'], ['MXRL', 'Mixed relay']]);
  const og = cal.racesFromSchedule(wiki.olympics, { country: 'ITA' }, '2526');
  assert.equal(og.length, 11);
  assert.equal(og.find((r) => r.cat + r.disc === 'SWPU').start, '2026-02-15T13:45:00.000Z', 'a second race on a day (rowspan), local UTC+1');
  const wch = cal.racesFromSchedule(wiki.wch2027, { country: 'EST' }, '2627');
  assert.equal(wch[0].start, '2027-02-10T15:10:00.000Z', 'UTC+2 from the page');
  assert.equal(ibu.sheetUrl(ibu.raceIdOf('2627', 'CH__', 'MX', 'RL'), 'C73C', 1), 'https://ibu.blob.core.windows.net/docs/2627/BT/SWRL/CH__/MXRL/C73C_v1.pdf');
});

// listBiathlon with Wikipedia answered from the fixtures (no network).
const fromFixtures = (pages, asked = []) => async (title) => { asked.push(title); return pages[title] ?? null; };

test('race list: listed, finished by the clock, schedules of old stages cached, gone races dropped', async () => {
  const pages = {
    '2025–26 Biathlon World Cup': wiki.season2526,
    '2026–27 Biathlon World Cup': wiki.season2627,
    '2025–26 Biathlon World Cup – Stage 3': wiki.stage3,
  };
  const state = {};
  const now = new Date('2025-12-21T13:00:00Z'); // during the women's mass start (Wikipedia says 12:15 UTC)
  const opts = { aheadDays: 14, keepDays: 400, raceIdOf: ibu.raceIdOf, log: () => {}, wikitext: fromFixtures(pages) };
  const races = await cal.listBiathlon(now, state, opts);
  const ms = races.find((r) => r.raceId === 'BT2526SWRLCP03SWMS');
  assert.deepEqual([ms.finished, ms.live, ms.series, ms.gender, ms.place], [false, true, 'World Cup', 'women', 'Annecy–Le Grand-Bornand']);
  assert.equal(races.find((r) => r.raceId === 'BT2526SWRLCP03SWSP').finished, true);
  assert.ok(!races.some((r) => r.raceId.includes('CP04')), 'Oberhof is too far ahead and has no page here');
  assert.deepEqual(state.biathlonStages, {}, 'a stage still on is not cached');
  // Weeks later: the stage's schedule is cached, so its page isn't read again.
  const later = new Date('2026-01-02T12:00:00Z');
  await cal.listBiathlon(later, state, opts);
  assert.equal(state.biathlonStages['2025–26 Biathlon World Cup – Stage 3'].races.length, 6);
  const asked = [];
  await cal.listBiathlon(later, state, { ...opts, wikitext: fromFixtures(pages, asked) });
  assert.ok(asked.length && !asked.includes('2025–26 Biathlon World Cup – Stage 3'));
  // A race with no result sheet: still live for two days, then given up on and no longer listed.
  const race = { comp: 'biathlon', start: ms.start, ref: ms };
  assert.equal(noResult(race, state, new Date('2025-12-22T12:00:00Z')), 'live');
  assert.equal(noResult(race, state, new Date('2025-12-24T12:00:00Z')), 'gone');
  const after = await cal.listBiathlon(later, state, opts);
  assert.ok(!after.some((r) => r.raceId === 'BT2526SWRLCP03SWMS'));
});

test('a stage with no schedule on Wikipedia is found from its result sheets once it\'s over', async () => {
  // Oberhof 2026 here has no stage page: its calendar row says sprint, pursuit and relay.
  const season = wiki.season2526.replace('[[2025–26 Biathlon World Cup&nbsp;– Stage 4|\'\'details\'\']]', "''details''");
  const sheets = { BT2526SWRLCP04SWSP: { start: { year: 2026, month: 0, day: 8, hour: 14, minute: 15 }, title: 'WOMEN 7.5km SPRINT' } };
  const looked = [];
  const findRace = async (id) => { looked.push(id); return sheets[id] ?? null; };
  const opts = { aheadDays: 14, keepDays: 400, raceIdOf: ibu.raceIdOf, findRace, log: () => {}, wikitext: fromFixtures({ '2025–26 Biathlon World Cup': season }) };
  const during = await cal.listBiathlon(new Date('2026-01-10T12:00:00Z'), {}, opts);
  assert.ok(!during.some((r) => r.code === 'CP04') && !looked.some((id) => id.includes('CP04')), 'not while the stage is on');
  const state = {};
  const races = await cal.listBiathlon(new Date('2026-01-20T12:00:00Z'), state, opts);
  const sprint = races.find((r) => r.raceId === 'BT2526SWRLCP04SWSP');
  assert.deepEqual([sprint.name, sprint.start, sprint.finished], ["Women's 7.5 km sprint", '2026-01-08T13:15:00.000Z', true]);
  assert.deepEqual(looked.filter((id) => id.includes('CP04')).sort(), ['BT2526SWRLCP04SMPU', 'BT2526SWRLCP04SMRL', 'BT2526SWRLCP04SMSP', 'BT2526SWRLCP04SWPU', 'BT2526SWRLCP04SWRL', 'BT2526SWRLCP04SWSP']);
  looked.length = 0;
  await cal.listBiathlon(new Date('2026-01-21T12:00:00Z'), state, opts);
  assert.ok(!looked.some((id) => id.includes('CP04')), 'each sheet is looked for once');
});

test('a misnamed race on Wikipedia keeps its own id (the distance decides)', () => {
  // Nové Město 2026: the women's race was listed as "Men's 12.5 km Mass Start".
  const page = "== Schedule ==\n{|\n|-\n| rowspan=2| 25 January\n| 12:00 CET\n| Men's 12.5 km Mass Start\n|-\n| 15:00 CET\n| Men's 15 km Mass Start\n|}";
  const races = cal.racesFromSchedule(page, { country: 'CZE' }, '2526');
  assert.deepEqual(races.map((r) => [r.cat + r.disc, r.name]), [['SWMS', "Women's 12.5 km mass start"], ['SMMS', "Men's 15 km mass start"]]);
});
