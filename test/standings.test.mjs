// The Team view's league tables: what gets published (docs/data/standings.json is a spoiler
// file, loaded only after a warning) and when the live check refreshes them (src/standings.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { tablesFrom } from '../src/sources/espn-standings.mjs';
import { publishStandings, STANDING_FIELDS } from '../src/publish.mjs';
import { TABLE_COMPS, noteFinished, refreshStandings, rowOf } from '../src/standings.mjs';
import { STAKES_COMPS } from '../src/prematch.mjs';

const fixture = (path) => JSON.parse(readFileSync(new URL(`./fixtures/${path}`, import.meta.url)));
const nor = () => ({ season: '2026 Norwegian Eliteserien', groups: tablesFrom(fixture('football/standings-nor.1-2026-10-01.json')) });
const pl = () => ({ season: '2026-27 English Premier League', groups: tablesFrom(fixture('football/standings-eng.1-2026-11-10.json')) });
const nl = () => ({ season: '2026-27 UEFA Nations League', groups: tablesFrom(fixture('football/standings-uefa.nations-2026-10-01.json')) });

// Exactly the whitelisted fields; whole numbers; ranks 1..n once each per group.
function checkStandings(file) {
  for (const [comp, s] of Object.entries(file)) {
    assert.ok(TABLE_COMPS.has(comp), `${comp} has no table`);
    assert.deepEqual(Object.keys(s).sort(), ['groups', 'season', 'updated']);
    assert.equal(typeof s.season, 'string');
    assert.ok(!Number.isNaN(Date.parse(s.updated)));
    for (const g of s.groups) {
      assert.deepEqual(Object.keys(g).sort(), ['name', 'rows']);
      assert.deepEqual(g.rows.map((r) => r.rank).sort((a, b) => a - b), g.rows.map((_, i) => i + 1), `${comp} ${g.name} ranks`);
      for (const r of g.rows) {
        assert.deepEqual(Object.keys(r).sort(), [...STANDING_FIELDS].sort(), `${comp} row fields`);
        for (const k of ['rank', 'played', 'won', 'drawn', 'lost', 'gf', 'ga']) assert.ok(Number.isInteger(r[k]) && r[k] >= 0, `${comp} ${r.team} ${k}`);
        assert.ok(Number.isInteger(r.gd) && Number.isInteger(r.points));
        assert.ok(typeof r.team === 'string' && r.team && typeof r.note === 'string' && r.note.length <= 60);
      }
    }
    assert.doesNotMatch(JSON.stringify(s), /https?:|logo|overall|rankChange|odds|"\d+-\d+-\d+"/, `${comp}: nothing but the table`);
  }
}

test('the table competitions are the "what\'s at stake" ones', () => {
  assert.deepEqual([...TABLE_COMPS].sort(), [...STAKES_COMPS].sort());
});

test('publishStandings keeps only the table: numbers, names and the places\' meaning', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const n = publishStandings(nor(), now);
  checkStandings({ 'nor.1': n });
  assert.equal(n.groups.length, 1);
  assert.equal(n.groups[0].rows.length, 16);
  assert.equal(n.groups[0].rows.find((r) => r.team === 'Viking FK').points, 50);
  const p = publishStandings(pl(), now);
  checkStandings({ 'eng.1': p });
  const arsenal = p.groups[0].rows[0];
  assert.deepEqual(arsenal, { team: 'Arsenal', rank: 1, played: 10, won: 9, drawn: 0, lost: 1, gf: 15, ga: 5, gd: 10, points: 27, note: 'Champions League' });
  for (const r of p.groups[0].rows) assert.equal(r.won + r.drawn + r.lost, r.played);
  const g = publishStandings(nl(), now);
  checkStandings({ 'uefa.nations': g });
  assert.equal(g.groups.length, 14);
  assert.ok(g.groups.every((x) => /^Group/.test(x.name)));
  // Anything odd from ESPN is dropped or zeroed, never passed on.
  const odd = publishStandings({ season: 3, groups: [{ name: 'G', rows: [
    { team: 'A', rank: 1, played: 1, won: 1, drawn: 0, lost: 0, gf: 2, ga: 0, gd: 2, points: 3, note: 'x', overall: '1-0-0', logo: 'http://x' },
    { team: '', rank: 2 }, { team: 'B', rank: 0 }, { team: 'C', rank: 2, played: -1, gd: 1.5, points: -2 },
  ] }] }, now);
  checkStandings({ 'eng.1': odd });
  assert.deepEqual(odd.groups[0].rows.map((r) => r.team), ['A', 'C']);
  assert.equal(odd.groups[0].rows[1].played, 0);
  assert.equal(odd.groups[0].rows[1].points, -2);
});

test('rowOf finds a team by name, or by its slug', () => {
  const t = publishStandings(nor());
  assert.equal(rowOf(t, 'Viking FK').row.team, 'Viking FK');
  assert.equal(rowOf(t, 'VIKING FK').row.team, 'Viking FK');
  assert.equal(rowOf(t, 'Arsenal'), null);
});

test('after full-time the table is asked for again until it shows the match', async () => {
  const t0 = new Date('2026-10-01T20:00:00Z');
  const before = publishStandings(nor(), t0);
  const standings = new Map([['nor.1', before]]);
  const state = {};
  noteFinished(state, standings, { id: 'fb-1', comp: 'nor.1', teams: ['Viking FK', 'SK Brann'] }, t0);
  noteFinished(state, standings, { id: 'fb-2', comp: 'uefa.euro', teams: ['A', 'B'] }, t0); // a tournament: no table
  assert.deepEqual(Object.keys(state.tablesPending), ['fb-1']);
  const played = (name) => before.groups[0].rows.find((r) => r.team === name).played;
  assert.deepEqual(state.tablesPending['fb-1'].played, [played('Viking FK'), played('SK Brann')]);

  // ESPN hasn't caught up: same table, so nothing changed and it stays waiting.
  let calls = 0;
  const same = async () => { calls++; return nor(); };
  assert.equal(await refreshStandings(state, standings, same, { now: new Date('2026-10-01T20:05:00Z') }), false);
  assert.equal(calls, 1);
  assert.ok(state.tablesPending['fb-1']);

  // Now it has: both teams one game more.
  const after = async () => {
    const s = nor();
    for (const r of s.groups[0].rows) if (r.team === 'Viking FK' || r.team === 'SK Brann') { r.played++; r.drawn++; r.points++; }
    return s;
  };
  assert.equal(await refreshStandings(state, standings, after, { now: new Date('2026-10-01T20:10:00Z') }), true);
  assert.equal(state.tablesPending, undefined, 'nothing waiting any more');
  assert.equal(standings.get('nor.1').groups[0].rows.find((r) => r.team === 'Viking FK').played, played('Viking FK') + 1);

  // Nothing waiting: no requests at all.
  calls = 0;
  assert.equal(await refreshStandings(state, standings, same, {}), false);
  assert.equal(calls, 0);
});

test('a failed request keeps the old table, and the wait ends after 3 hours', async () => {
  const t0 = new Date('2026-10-01T20:00:00Z');
  const old = publishStandings(nor(), t0);
  const standings = new Map([['nor.1', old]]);
  const state = {};
  noteFinished(state, standings, { id: 'fb-1', comp: 'nor.1', teams: ['Viking FK', 'SK Brann'] }, t0);
  const down = async () => { throw new Error('503'); };
  const warnings = [];
  await refreshStandings(state, standings, down, { now: new Date('2026-10-01T21:00:00Z'), warn: (m) => warnings.push(m) });
  assert.equal(standings.get('nor.1'), old);
  assert.ok(state.tablesPending['fb-1']);
  assert.equal(warnings.length, 1);
  await refreshStandings(state, standings, down, { now: new Date('2026-10-01T23:30:00Z'), warn: () => {} });
  assert.equal(state.tablesPending, undefined);
});

test('a knockout tie after the league phase doesn\'t wait for the table', () => {
  const rows = Array.from({ length: 36 }, (_, i) => ({ team: `T${i + 1}`, rank: i + 1, played: 8, won: 0, drawn: 0, lost: 8, gf: 0, ga: 0, gd: 0, points: 0, note: '' }));
  const standings = new Map([['uefa.champions', publishStandings({ season: 'x', groups: [{ name: 'League Phase', rows }] })]]);
  const state = {};
  noteFinished(state, standings, { id: 'fb-9', comp: 'uefa.champions', teams: ['T1', 'T2'] });
  assert.equal(state.tablesPending, undefined);
});

test('the real docs/data/standings.json is just the tables', { skip: !existsSync(new URL('../docs/data/standings.json', import.meta.url)) }, () => {
  checkStandings(JSON.parse(readFileSync(new URL('../docs/data/standings.json', import.meta.url))));
});
