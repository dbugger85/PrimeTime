// Pure helpers for the page (no DOM), so they can be unit-tested with node --test.

export const SPORTS = { football: 'Football', tennis: 'Tennis', f1: 'F1' };

export function tierOf(score) {
  if (score >= 8) return { key: 'must', label: 'Must-watch' };
  if (score >= 6) return { key: 'good', label: 'Good' };
  if (score >= 4) return { key: 'decent', label: 'Decent' };
  return { key: 'skip', label: 'Skip it' };
}

const joinAnd = (parts) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);

export function adviceText(a) {
  if (a?.code === 'full') return 'Watch it all';
  if (a?.code === 'highlights') return 'Highlights are enough';
  if (a?.code !== 'skip' || !a.ranges?.length) return '';
  const r = a.ranges;
  if (a.unit === 'set') {
    const sets = r.map(([x, y]) => (x === y ? `${x}` : `${x}–${y}`));
    const many = r.length > 1 || r[0][0] !== r[0][1];
    return `Skip set${many ? 's' : ''} ${joinAnd(sets)}`;
  }
  if (a.unit === 'lap') {
    return `Watch the start, then skip laps ${joinAnd(r.map(([x, y]) => `${x}–${y}`))}`;
  }
  // Minutes. A window from kick-off reads better as "Start at …".
  const parts = [];
  let rest = r;
  if (r[0][0] === 0) {
    parts.push(r[0][1] === 45 ? 'Skip the first half' : `Start at ${r[0][1]}'`);
    rest = r.slice(1);
  }
  if (rest.length) {
    const skips = `skip ${joinAnd(rest.map(([x, y]) => `${x}'–${y}'`))}`;
    parts.push(parts.length ? `then ${skips}` : skips[0].toUpperCase() + skips.slice(1));
  }
  return parts.join(', ');
}

// Football skip windows as percentages of 90 minutes, for shading the strip.
export function skipShades(e) {
  if (e.sport !== 'football' || e.advice?.code !== 'skip') return [];
  return e.advice.ranges.map(([x, y]) => ({ left: (x / 90) * 100, width: ((y - x) / 90) * 100 }));
}

const LATE_ROUNDS = {
  r3: ['Round 3', 'Round 4', 'Quarterfinal', 'Semifinal', 'Final'],
  qf: ['Quarterfinal', 'Semifinal', 'Final'],
};

// Filters shared by both views: sport, services, competition, tennis round and draw.
function matchesCommon(e, prefs) {
  if (prefs.sport !== 'all' && e.sport !== prefs.sport) return false;
  if (prefs.services?.length && !e.services.some((s) => prefs.services.includes(s))) return false;
  if (prefs.comp && prefs.comp !== 'all' && e.compName !== prefs.comp) return false;
  if (e.sport === 'tennis' && prefs.sport === 'tennis') { // these settings only show on the Tennis tab
    if (prefs.round && LATE_ROUNDS[prefs.round] && !LATE_ROUNDS[prefs.round].includes(e.round)) return false;
    if (prefs.draw === 'men' && !/^men/i.test(e.draw)) return false;
    if (prefs.draw === 'women' && !/^women/i.test(e.draw)) return false;
  }
  return true;
}

// Upcoming and live events, soonest first (live ones on top).
export function filterUpcoming(list, prefs) {
  return list
    .filter((e) => matchesCommon(e, prefs))
    .sort((a, b) => (b.status === 'live') - (a.status === 'live') || a.start.localeCompare(b.start));
}

// "Today", "Tomorrow" or e.g. "Sat 4 Oct", in Norwegian time.
export function dayLabel(iso, now = new Date()) {
  const day = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(d); // YYYY-MM-DD
  const d = new Date(iso);
  if (day(d) === day(now)) return 'Today';
  if (day(d) === day(new Date(now.getTime() + 864e5))) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

// prefs: { sport, services[], comp, days, minScore, sort, round, draw, hideWatched }
export function filterEvents(events, prefs, watched = new Set(), now = Date.now()) {
  const list = events.filter((e) => {
    if (!matchesCommon(e, prefs)) return false;
    if (prefs.days && now - Date.parse(e.start) > prefs.days * 864e5) return false;
    if (prefs.minScore && e.score < prefs.minScore) return false;
    if (prefs.hideWatched && watched.has(e.id)) return false;
    return true;
  });
  return prefs.sort === 'score'
    ? list.sort((a, b) => b.score - a.score || b.start.localeCompare(a.start))
    : list.sort((a, b) => b.start.localeCompare(a.start));
}

// prefs.hideTennis / prefs.hideFootball. A race name gives nothing away, so F1 is never hidden.
export function namesHidden(event, prefs) {
  if (event.sport === 'tennis') return prefs.hideTennis;
  if (event.sport === 'football') return prefs.hideFootball;
  return false;
}

// Older saved settings had one "names" choice; turn it into the two switches.
export function migratePrefs(p) {
  const out = { ...p };
  if ('names' in out) {
    out.hideTennis ??= out.names !== 'show';
    out.hideFootball ??= out.names === 'all';
    delete out.names;
  }
  return out;
}

// Football is kept for 30 days, so "last year" only makes sense for the other sports.
const PERIODS = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 400, label: 'Last year' },
];
export const periodOptions = (sport) => (sport === 'football' ? PERIODS.slice(0, 2) : PERIODS);

const count = (list, key) => {
  const m = new Map();
  for (const e of list) for (const k of [].concat(key(e))) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
};

// Counts for the dynamic filters. Each count ignores its own filter, so it tells
// you what you'd get by picking that option (like on a shopping site).
export function facets(pool, prefs, view, watched = new Set(), now = Date.now()) {
  const run = (p) => (view === 'upcoming' ? filterUpcoming(pool, p) : filterEvents(pool, p, watched, now));
  const withComp = run({ ...prefs, comp: 'all' });
  const comps = prefs.sport === 'football' || prefs.sport === 'tennis'
    ? [...count(withComp, (e) => e.compName)].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n)
    : [];
  const services = [...count(run({ ...prefs, services: [] }), (e) => e.services)].map(([id, n]) => ({ id, n }));
  const rated = view === 'upcoming' ? [] : run({ ...prefs, minScore: 0 });
  const minCounts = Object.fromEntries([0, 4, 6, 8].map((t) => [t, rated.filter((e) => e.score >= t).length]));
  return { comps, services, minCounts };
}

// How many filters differ from the defaults (shown on "More filters").
export function activeFilters(prefs, view) {
  let n = 0;
  if (prefs.comp && prefs.comp !== 'all') n++;
  if (view === 'replays') {
    if (prefs.days !== 30) n++;
    if (prefs.minScore) n++;
    if (prefs.sort !== 'date') n++;
    if (prefs.hideWatched) n++;
  }
  if (prefs.sport === 'tennis') {
    if (prefs.round) n++;
    if (prefs.draw) n++;
  }
  return n;
}

export function titleOf(event) {
  if (event.sport === 'football') return event.teams.join(' – ');
  if (event.sport === 'tennis') return event.players.join(' vs ');
  return event.compName;
}

export function subtitleOf(event) {
  if (event.sport === 'football') return event.compName;
  if (event.sport === 'tennis') return `${event.compName} · ${event.draw} · ${event.round}`;
  return `Formula 1 · ${event.circuit}`;
}

export function hiddenTitleOf(event) {
  return event.sport === 'tennis' ? 'Players hidden' : 'Teams hidden';
}

// The lines shown by "Why this score?": [points, label] pairs, biggest first.
export function reasonLines(reasons, score) {
  const lines = [...reasons].sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
    .map(([pts, label]) => ({ pts: `${pts > 0 ? '+' : ''}${pts.toFixed(1)}`, label, negative: pts < 0 }));
  const sum = Math.round(reasons.reduce((a, [p]) => a + p, 0) * 10) / 10;
  const note = sum > 10 ? `Adds up to ${sum.toFixed(1)}, capped at 10` : sum < 0 ? 'Adds up to below 0, so it counts as 0' : '';
  return { lines, note, score };
}
