// Reading and writing the data files shared by the full build and the live check.
//   docs/data/events.json   spoiler-free: scored events + upcoming/live events (the page loads this)
//   docs/data/reasons.json  spoilers: why each event got its score (loaded only after a warning)
//   docs/data/results.json  big spoilers: the actual result (loaded only after a second warning)
//   docs/cal/<team>.ics     calendar feeds, one per football team (src/calendar.mjs)
//   data/state.json         bookkeeping: what's complete, when the last full build ran

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { writeCalendars } from './calendar.mjs';
import { linkFields } from './publish.mjs';
import { SCORING_VERSIONS } from './scoring/common.mjs';

const root = new URL('..', import.meta.url);
const EVENTS = new URL('docs/data/events.json', root);
const REASONS = new URL('docs/data/reasons.json', root);
const RESULTS = new URL('docs/data/results.json', root);
const STATE = new URL('data/state.json', root);
const readJson = (url, fallback) => (existsSync(url) ? JSON.parse(readFileSync(url)) : fallback);

// A GitHub warning: shown in yellow in the run's log and summary.
export const warn = (msg) => console.log(`::warning::${msg}`);

// Saves a scored event: the spoiler-free card data, and separately the reasons behind
// its score and the result (each only loaded after its warning on the page).
export const saver = ({ events, reasons, results }) => (event, scored) => {
  events.set(event.id, event);
  reasons.set(event.id, scored.reasons);
  results.set(event.id, scored.result);
};

export function loadData() {
  const data = readJson(EVENTS, {});
  const loaded = {
    events: new Map((data.events ?? []).map((e) => [e.id, e])),
    upcoming: data.upcoming ?? [],
    reasons: new Map(Object.entries(readJson(REASONS, {}))),
    results: new Map(Object.entries(readJson(RESULTS, {}))),
    state: readJson(STATE, {}),
  };
  loaded.migrated = unrateQualifying(loaded); // the live check must save these even if nothing else changed
  return loaded;
}

// F1 qualifying used to get a score, a strip and tips (until F1 version 11). Its saved
// result is all that's still needed, so older sessions are un-rated here instead of re-fetched.
function unrateQualifying({ events, reasons }) {
  let n = 0;
  for (const e of events.values()) {
    if (e.sport !== 'f1' || !/qualifying/.test(e.session ?? '') || e.score === null) continue;
    events.set(e.id, { ...e, score: null, segments: [], advice: null, v: SCORING_VERSIONS.f1 });
    reasons.set(e.id, []);
    n++;
  }
  return n > 0;
}

// Writes all the files. Returns a one-line summary.
export function saveData({ events, upcoming, reasons, results, state }, now = new Date()) {
  // Direct links to the match (state.links, see src/sources/links.mjs) go onto every event here,
  // so both the full build and the live check publish them.
  const withLinks = (e, replay) => {
    const { links, ...rest } = e;
    return { ...rest, ...linkFields(state.links?.[e.id], { replay, now: now.getTime() }) };
  };
  const list = [...events.values()].map((e) => withLinks(e, true)).sort((a, b) => b.start.localeCompare(a.start));
  // An event that finished and got scored shouldn't also be listed as upcoming.
  const soon = [...new Map(upcoming.filter((e) => !events.has(e.id)).map((e) => [e.id, withLinks(e, false)])).values()]
    .sort((a, b) => a.start.localeCompare(b.start));
  mkdirSync(new URL('docs/data/', root), { recursive: true });
  mkdirSync(new URL('data/', root), { recursive: true });
  writeFileSync(EVENTS, JSON.stringify({ generated: now.toISOString(), events: list, upcoming: soon }) + '\n');
  const pick = (map) => JSON.stringify(Object.fromEntries(list.filter((e) => map.has(e.id)).map((e) => [e.id, map.get(e.id)]))) + '\n';
  writeFileSync(REASONS, pick(reasons));
  writeFileSync(RESULTS, pick(results));
  const feeds = writeCalendars(new URL('docs/cal/', root), list, soon, state, now); // updates state.calTeams
  writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
  const count = (s) => list.filter((e) => e.sport === s).length;
  const live = soon.filter((e) => e.status === 'live').length;
  return `events.json: ${list.length} events (football ${count('football')}, tennis ${count('tennis')}, f1 ${count('f1')}, winter ${count('winter')}), ${soon.length} upcoming (${live} live), ${feeds} calendar feeds`;
}
