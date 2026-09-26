import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratePrefs, periodOptions, facets, activeFilters, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, filterEvents, namesHidden, titleOf } from '../docs/logic.js';

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
  const skip = (unit, ranges) => adviceText({ code: 'skip', unit, ranges });
  assert.equal(adviceText({ code: 'full' }), 'Watch it all');
  assert.equal(skip('min', [[0, 45]]), 'Skip the first half');
  assert.equal(skip('min', [[0, 20]]), "Start at 20'");
  assert.equal(skip('min', [[0, 20], [50, 65]]), "Start at 20', then skip 50'–65'");
  assert.equal(skip('min', [[45, 60]]), "Skip 45'–60'");
  assert.equal(skip('min', [[10, 25], [45, 60], [65, 75]]), "Skip 10'–25', 45'–60' and 65'–75'");
  assert.equal(skip('lap', [[4, 15], [22, 30]]), 'Watch the start, then skip laps 4–15 and 22–30');
  assert.equal(skip('set', [[1, 1]]), 'Skip set 1');
  assert.equal(skip('set', [[1, 2]]), 'Skip sets 1–2');
  assert.equal(skip('set', [[2, 2]]), 'Skip set 2');
});

test('skip shading on the football strip', () => {
  assert.deepEqual(skipShades({ sport: 'football', advice: { code: 'skip', unit: 'min', ranges: [[0, 45]] } }), [{ left: 0, width: 50 }]);
  assert.deepEqual(skipShades({ sport: 'f1', advice: { code: 'skip', unit: 'lap', ranges: [[4, 9]] } }), []);
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

test('filters: tennis rounds and draw (Tennis tab only), and sorting by score', () => {
  assert.equal(ids(filterEvents(events, { ...base, sport: 'tennis', round: 'qf' }, new Set(), now)), '');
  assert.equal(ids(filterEvents(events, { ...base, sport: 'tennis', draw: 'women' }, new Set(), now)), 'c');
  assert.equal(ids(filterEvents(events, { ...base, round: 'qf' }, new Set(), now)), 'abcd', 'ignored on the All tab');
  assert.equal(ids(filterEvents(events, { ...base, sort: 'score' }, new Set(), now)), 'dacb');
});

test('names: separate switches for tennis and football, F1 never hidden', () => {
  const both = { hideTennis: true, hideFootball: true };
  assert.equal(namesHidden(events[2], { hideTennis: true, hideFootball: false }), true);
  assert.equal(namesHidden(events[0], { hideTennis: true, hideFootball: false }), false);
  assert.equal(namesHidden(events[0], both), true);
  assert.equal(namesHidden(events[3], both), false);
  assert.deepEqual(migratePrefs({ names: 'all' }), { hideTennis: true, hideFootball: true });
  assert.deepEqual(migratePrefs({ names: 'show' }), { hideTennis: false, hideFootball: false });
  assert.deepEqual(migratePrefs({ names: 'tennis', sport: 'f1' }), { hideTennis: true, hideFootball: false, sport: 'f1' });
  assert.equal(titleOf(events[0]), 'A – B');
});

test('reason lines: biggest first, signed, with a cap note', () => {
  const { lines, note } = reasonLines([[0.5, 'small'], [-1.5, 'one-sided'], [4.8, '4 goals'], [7, 'lots']], 10);
  assert.deepEqual(lines.map((l) => l.pts), ['+7.0', '+4.8', '-1.5', '+0.5']);
  assert.equal(lines[2].negative, true);
  assert.equal(note, 'Adds up to 10.8, capped at 10');
  assert.equal(reasonLines([[3, 'x']], 3).note, '');
});

test('upcoming: live first, then soonest; shared filters apply', () => {
  const soon = [
    { id: 'x', sport: 'football', start: '2026-10-10T14:00Z', status: 'upcoming', services: ['viaplay'], compName: 'Premier League' },
    { id: 'y', sport: 'f1', start: '2026-10-04T12:00Z', status: 'upcoming', services: ['viaplay', 'f1tv'], compName: 'GP' },
    { id: 'z', sport: 'football', start: '2026-09-26T18:00Z', status: 'live', services: ['tv2play'], compName: 'Nations League' },
  ];
  assert.equal(ids(filterUpcoming(soon, base)), 'zyx');
  assert.equal(ids(filterUpcoming(soon, { ...base, sport: 'football' })), 'zx');
  assert.equal(ids(filterUpcoming(soon, { ...base, services: ['f1tv'] })), 'y');
});

test('day labels in Norwegian time', () => {
  const now = new Date('2026-09-26T21:00:00Z'); // 23:00 in Oslo
  assert.equal(dayLabel('2026-09-26T21:30:00Z', now), 'Today');
  assert.equal(dayLabel('2026-09-26T22:30:00Z', now), 'Tomorrow'); // 00:30 in Oslo
  assert.equal(dayLabel('2026-10-04T12:00:00Z', now), 'Sun 4 Oct');
});

test('dynamic filters: counts per competition, service and rating', () => {
  const f = facets(events, { ...base, sport: 'football' }, 'replays', new Set(), now);
  assert.deepEqual(f.comps.map((c) => `${c.name}:${c.n}`).sort(), ['Eliteserien:1', 'Premier League:1']);
  assert.deepEqual(f.services.map((x) => `${x.id}:${x.n}`).sort(), ['tv2play:1', 'viaplay:1']);
  assert.deepEqual(f.minCounts, { 0: 2, 4: 1, 6: 1, 8: 1 });
  assert.deepEqual(facets(events, { ...base, sport: 'f1' }, 'replays', new Set(), now).comps, [], 'no competition chips for F1');
  assert.deepEqual(facets(events, base, 'replays', new Set(), now).comps, [], 'none on the All tab either');
  // A chosen service doesn't shrink the service counts themselves.
  const g = facets(events, { ...base, services: ['viaplay'] }, 'replays', new Set(), now);
  assert.equal(g.services.find((x) => x.id === 'hbomax').n, 1);
});

test('period choices and active filter count', () => {
  assert.deepEqual(periodOptions('football').map((p) => p.days), [7, 30]);
  assert.deepEqual(periodOptions('f1').map((p) => p.days), [7, 30, 400]);
  assert.equal(activeFilters({ ...base, days: 30 }, 'replays'), 0);
  assert.equal(activeFilters({ ...base, days: 7, minScore: 6, comp: 'Eliteserien' }, 'replays'), 3);
  assert.equal(activeFilters({ ...base, days: 7, minScore: 6 }, 'upcoming'), 0, 'replay-only filters do not count on Coming up');
});

test('publishing stamps a version on the page files', async () => {
  const { stamp } = await import('../scripts/stamp.mjs');
  const { readFileSync } = await import('node:fs');
  const html = readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
  const js = readFileSync(new URL('../docs/app.js', import.meta.url), 'utf8');
  const out = stamp(html, js, 'abc1234');
  assert.match(out.html, /src="\.\/app\.js\?v=abc1234"/);
  assert.match(out.html, /href="\.\/style\.css\?v=abc1234"/);
  assert.match(out.js, /from '\.\/logic\.js\?v=abc1234'/);
  assert.doesNotMatch(out.js, /from '\.\/logic\.js'/);
});
