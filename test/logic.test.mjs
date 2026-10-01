import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migratePrefs, periodOptions, facets, activeFilters, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, filterEvents, namesHidden, titleOf, subtitleOf, isFavorite, favCount, toggleFav, favNames, searchNames, encodeSettings, decodeSettings, winterLabel, prematchLine } from '../docs/logic.js';

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
  const { lines, note } = reasonLines([[0.5, 'small'], [-1.5, 'one-sided'], [4.8, '4 goals'], [7, 'lots']]);
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

test('favorites: football teams, tennis players only under Coming up, F1 as a whole', () => {
  const favs = { teams: ['A'], players: ['E'], f1: true };
  const on = { ...base, favsOnly: true, favs };
  assert.equal(ids(filterEvents(events, on, new Set(), now)), 'ad', 'tennis is left out of replays: it would spoil who went through');
  assert.equal(ids(filterEvents(events, { ...on, favs: { ...favs, f1: false } }, new Set(), now)), 'a');
  assert.equal(ids(filterEvents(events, { ...base, favs }, new Set(), now)), 'abcd', 'off: everything shows');
  const soon = events.map((e) => ({ ...e, status: 'upcoming' }));
  assert.equal(ids(filterUpcoming(soon, on)), 'dca', 'tennis favorites do count under Coming up');
  assert.ok(isFavorite(events[2], favs, 'upcoming'));
  assert.ok(!isFavorite(events[2], favs, 'replays'));
  assert.equal(facets(events, on, 'replays', new Set(), now).minCounts[0], 2, 'counts follow the favorites filter');
  assert.equal(favCount(favs), 3);
});

test('favorites: toggling, and the search box', () => {
  let favs = { teams: [], players: [], f1: false };
  favs = toggleFav(favs, 'teams', 'Viking');
  favs = toggleFav(favs, 'teams', 'Bodø/Glimt');
  assert.deepEqual(favs.teams, ['Bodø/Glimt', 'Viking']);
  assert.deepEqual(toggleFav(favs, 'teams', 'Viking').teams, ['Bodø/Glimt']);

  const names = favNames([[{ teams: ['Manchester City', 'Manchester United'] }, { teams: ['Bodø/Glimt', 'Brann'] }], [{ players: ['Casper Ruud', 'Iga Swiatek'] }]]);
  assert.equal(names.length, 6);
  assert.deepEqual(searchNames(names, 'bodo', favs), [], 'already a favorite');
  assert.deepEqual(searchNames(names, 'bodo', { teams: [], players: [] }).map((n) => n.name), ['Bodø/Glimt'], 'accents ignored');
  assert.deepEqual(searchNames(names, 'ruud', favs), [{ kind: 'players', name: 'Casper Ruud' }], 'matches a surname');
  assert.deepEqual(searchNames(names, 'man', favs).map((n) => n.name), ['Manchester City', 'Manchester United']);
  assert.deepEqual(searchNames(names, '  ', favs), []);
});

test('settings link: round trip, recent watched marks only, broken links', () => {
  const defaults = { view: 'replays', sport: 'all', services: [], hints: true, favs: { teams: [], players: [], f1: false } };
  const prefs = { ...defaults, view: 'upcoming', sport: 'f1', services: ['viaplay'], hints: false, favs: { teams: ['Bodø/Glimt'], players: [], f1: true } };
  const code = encodeSettings(prefs, new Set(['a', 'd', 'gone']), events, now);
  assert.match(code, /^[\w-]+$/, 'safe to put in a link');
  const back = decodeSettings(code, defaults);
  assert.deepEqual(back.prefs, { sport: 'f1', services: ['viaplay'], hints: false, favs: { ...prefs.favs, winter: [] } }, 'the tab you are on is not copied');
  assert.deepEqual(back.watched, ['a'], 'd is from June, and "gone" is no longer in the data');
  assert.equal(decodeSettings('not-a-real-link', defaults), null);
  const odd = btoa(JSON.stringify({ p: { sport: 3, hints: 'yes', extra: 1, services: ['tv2play', 5] }, w: 'x' }));
  assert.deepEqual(decodeSettings(odd, defaults), { prefs: { services: ['tv2play'] }, watched: [] }, 'wrong types are dropped');
});

test('F1 qualifying: titles, skip text and the sessions filter', () => {
  const q = ev({ id: 'q', sport: 'f1', score: 7, start: '2026-06-09T14:00Z', compName: 'British Grand Prix', circuit: 'Silverstone', session: 'qualifying' });
  assert.equal(titleOf(q), 'British Grand Prix qualifying');
  assert.equal(adviceText({ code: 'skip', unit: 'part', ranges: [[1, 1]] }), 'Skip Q1');
  assert.equal(adviceText({ code: 'skip', unit: 'part', ranges: [[1, 2]] }), 'Skip Q1 and Q2');
  const all = [...events, q];
  const f1 = { ...base, sport: 'f1' };
  assert.equal(ids(filterEvents(all, f1, new Set(), now)), 'dq', 'newest first: the race is a day after qualifying');
  assert.equal(ids(filterEvents(all, { ...f1, f1Session: 'qualifying' }, new Set(), now)), 'q');
  assert.equal(ids(filterEvents(all, { ...f1, f1Session: 'race' }, new Set(), now)), 'd');
  assert.equal(ids(filterEvents(all, { ...base, f1Session: 'race' }, new Set(), now)), 'abcdq', 'ignored off the F1 tab');
  assert.equal(activeFilters({ ...f1, days: 30, sort: 'date', f1Session: 'race' }, 'replays'), 1);
  const sp = ev({ id: 's', sport: 'f1', score: 6, start: '2026-06-08T14:00Z', compName: 'British Grand Prix', circuit: 'Silverstone', session: 'sprint' });
  const sq = ev({ id: 't', sport: 'f1', score: 5, start: '2026-06-07T14:00Z', compName: 'British Grand Prix', circuit: 'Silverstone', session: 'sprint-qualifying' });
  assert.equal(titleOf(sp), 'British Grand Prix sprint');
  assert.equal(titleOf(sq), 'British Grand Prix sprint qualifying');
  assert.equal(subtitleOf(sq), 'Formula 1 · Sprint qualifying · Silverstone');
  assert.equal(ids(filterEvents([...all, sp, sq], { ...f1, f1Session: 'sprint' }, new Set(), now)), 'st', 'sprint weekends: the sprint and its qualifying');
  assert.equal(ids(filterEvents([...all, sp, sq], { ...f1, f1Session: 'qualifying' }, new Set(), now)), 'q', 'Grand Prix qualifying only');
});

test('winter: titles, gender filter, sport chips and favorites per sport and gender', () => {
  const w = (o) => ev({ sport: 'winter', start: '2026-09-20T12:00Z', score: 6, series: 'World Cup', place: 'Oberhof', ...o });
  const list = [
    w({ id: 'w1', comp: 'biathlon', compName: 'Biathlon', race: "Women's 10 km pursuit", gender: 'women' }),
    w({ id: 'w2', comp: 'biathlon', compName: 'Biathlon', race: 'Mixed relay', gender: 'mixed' }),
    w({ id: 'w3', comp: 'alpine', compName: 'Alpine', race: "Men's slalom", gender: 'men' }),
  ];
  assert.equal(titleOf(list[0]), "Women's 10 km pursuit");
  assert.equal(subtitleOf(list[0]), 'World Cup · Oberhof');
  const tab = { ...base, sport: 'winter' };
  assert.equal(ids(filterEvents(list, { ...tab, gender: 'women' }, new Set(), now)), 'w1');
  assert.equal(ids(filterEvents(list, { ...tab, comp: 'Alpine' }, new Set(), now)), 'w3');
  assert.deepEqual(facets(list, tab, 'replays', new Set(), now).comps.map((c) => c.name), ['Biathlon', 'Alpine']);
  const favs = { teams: [], players: [], f1: false, winter: ['biathlon:women'] };
  assert.equal(ids(filterEvents(list, { ...tab, favsOnly: true, favs }, new Set(), now)), 'w1w2', 'mixed races count for anyone following the sport');
  assert.equal(winterLabel('cross-country:men'), 'Cross-country (men)');
  const names = favNames([list]);
  assert.deepEqual(searchNames(names, 'biath', favs), [], 'already followed');
  assert.deepEqual(searchNames(names, 'alp', favs), [{ kind: 'winter', name: 'alpine:men', label: 'Alpine (men)' }]);
  assert.deepEqual(toggleFav(favs, 'winter', 'alpine:men').winter, ['alpine:men', 'biathlon:women']);
  assert.equal(adviceText({ code: 'skip', unit: 'stage', ranges: [[1, 2]] }), 'Start after shooting 2');
  assert.equal(adviceText({ code: 'skip', unit: 'leg', ranges: [[1, 2]] }), 'Start at leg 3');
  assert.equal(adviceText({ code: 'skip', unit: 'run', ranges: [[1, 1]] }), 'Skip run 1');
});

test('pre-match hints: one short line, or nothing', () => {
  assert.equal(prematchLine({ stakes: 'title', forecast: 'even' }), 'Title race · looks even on paper');
  assert.equal(prematchLine({ forecast: 'lively' }), 'Could be lively');
  assert.equal(prematchLine({ stakes: 'relegation' }), 'Relegation battle');
  assert.equal(prematchLine({}), '');
  assert.equal(prematchLine({ stakes: 'title', forecast: 'lively', outlook: 'promising' }), 'Title race · promising', 'the outlook replaces the forecast words');
  assert.equal(prematchLine({ forecast: 'one-sided', outlook: 'quiet' }), 'Could be quiet');
});

test('"Tomorrow" is right on the nights the clocks change', () => {
  // 25 Oct 2026: clocks go back, so the day has 25 hours.
  assert.equal(dayLabel('2026-10-26T08:00:00Z', new Date('2026-10-24T22:30:00Z')), 'Tomorrow'); // 00:30 Sun Oslo → Mon match
  // 29 Mar 2026: clocks go forward (23 hours).
  assert.equal(dayLabel('2026-03-29T12:00:00Z', new Date('2026-03-28T22:30:00Z')), 'Tomorrow'); // 23:30 Sat → Sun match
  assert.equal(dayLabel('2026-03-29T22:30:00Z', new Date('2026-03-28T22:30:00Z')), 'Mon 30 Mar'); // 00:30 Mon is not "tomorrow"
});

test('sorting reads the times, whatever their format', () => {
  const a = { id: 'a', start: '2026-10-01T18:00:00+02:00' }; // 16:00 UTC
  const b = { id: 'b', start: '2026-10-01T17:00Z' };
  const prefs = { sport: 'all', services: [], comp: 'all', favsOnly: false, favs: { teams: [], players: [], f1: false, winter: [] } };
  assert.deepEqual(filterUpcoming([b, a].map((e) => ({ ...e, sport: 'f1', services: [], status: 'upcoming' })), prefs).map((e) => e.id), ['a', 'b']);
});
