// Fetches finished events, scores them and writes docs/data/events.json.
// Run by GitHub Actions every few hours; you can also run it yourself:
//   npm run build            (everything)
//   npm run build -- f1      (just one sport: football, tennis or f1)
//
// To stay polite to the free APIs, it remembers what it has already done:
// events already in events.json are not fetched again, and data/state.json
// lists football days and tennis Slams that are complete.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { FOOTBALL, KEEP_DAYS } from '../src/competitions.mjs';
import { SCORING_VERSION } from '../src/scoring/common.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1 } from '../src/scoring/f1.mjs';
import * as football from '../src/sources/espn-football.mjs';
import * as tennis from '../src/sources/espn-tennis.mjs';
import * as f1 from '../src/sources/openf1.mjs';
import { publishFootball, publishTennis, publishF1, upcomingFootball, upcomingTennis, upcomingF1, expiringRights } from '../src/publish.mjs';

const root = new URL('..', import.meta.url);
const EVENTS = new URL('docs/data/events.json', root);
const STATE = new URL('data/state.json', root);
const REASONS = new URL('docs/data/reasons.json', root); // spoilers: only loaded after a warning
const readJson = (url, fallback) => (existsSync(url) ? JSON.parse(readFileSync(url)) : fallback);
const warn = (msg) => console.log(`::warning::${msg}`);

const now = new Date();
const only = process.argv[2];
const events = new Map(readJson(EVENTS, { events: [] }).events.map((e) => [e.id, e]));
const reasons = new Map(Object.entries(readJson(REASONS, {})));
// Saves a scored event: the spoiler-free card data, and separately the reasons behind its score.
const save = (event, scored) => { events.set(event.id, event); reasons.set(event.id, scored.reasons); };
let state = readJson(STATE, {});
if (state.version !== SCORING_VERSION) state = { version: SCORING_VERSION }; // formula changed: redo everything
state.footballDays ??= {};
state.slamsDone ??= [];

// Not-yet-finished events are rebuilt from scratch every run (times change, matches go live).
const upcoming = [];
const UPCOMING_DAYS = { football: 14, f1: 60 };

const isCurrent = (id) => events.get(id)?.v === SCORING_VERSION;
const ymd = (d) => d.toISOString().slice(0, 10).replaceAll('-', '');
const daysAgo = (n) => new Date(now.getTime() - n * 864e5);

async function buildFootball() {
  for (const comp of FOOTBALL) {
    const done = new Set(state.footballDays[comp.key] ?? []);
    for (let ago = KEEP_DAYS.football; ago >= 0; ago--) {
      const day = ymd(daysAgo(ago));
      if (done.has(day)) continue;
      const matches = await football.fetchDay(comp.key, day);
      let complete = true;
      for (const m of matches) {
        if (!m.finished) { complete = false; continue; }
        const id = `fb-${m.espnId}`;
        if (isCurrent(id)) continue;
        try {
          const scored = scoreFootball(football.factsFromSummary(await football.fetchSummary(comp.key, m.espnId)));
          save(publishFootball(comp, m, scored), scored);
        } catch (err) {
          complete = false;
          warn(`football ${comp.key} ${m.espnId}: ${err.message}`);
        }
      }
      if (complete && ago >= 2) done.add(day); // recent days may still get late matches or data fixes
    }
    const oldest = ymd(daysAgo(KEEP_DAYS.football + 1));
    state.footballDays[comp.key] = [...done].filter((d) => d >= oldest).sort();
  }
}

async function buildUpcomingFootball() {
  for (const comp of FOOTBALL) {
    for (let ahead = 0; ahead <= UPCOMING_DAYS.football; ahead++) {
      for (const m of await football.fetchDay(comp.key, ymd(daysAgo(-ahead)))) {
        if (m.state === 'pre' || m.state === 'in') upcoming.push(upcomingFootball(comp, m));
      }
    }
  }
  // Matches still being played from yesterday evening (or with the day boundary in UTC).
  for (const comp of FOOTBALL) {
    for (const m of await football.fetchDay(comp.key, ymd(daysAgo(1)))) {
      if (m.state === 'in') upcoming.push(upcomingFootball(comp, m));
    }
  }
}

async function buildTennis() {
  const done = new Set(state.slamsDone);
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear()]) {
    for (const slam of await tennis.fetchSlams(year, now, done)) {
      for (const m of tennis.upcomingFromSlam(slam)) upcoming.push(upcomingTennis(m));
      const matches = tennis.matchesFromSlam(slam);
      for (const m of matches) {
        const scored = scoreTennis(m);
        save(publishTennis(m, scored), scored);
      }
      if (slam.endDate && new Date(slam.endDate).getTime() + 2 * 864e5 < now.getTime()) done.add(slam.id);
      console.log(`tennis: ${slam.name} ${year}: ${matches.length} matches`);
    }
  }
  state.slamsDone = [...done];
}

async function buildF1() {
  const years = [now.getUTCFullYear() - 1, now.getUTCFullYear()];
  if (now.getUTCMonth() === 11) years.push(now.getUTCFullYear() + 1); // December: next season's first races
  for (const year of years) {
    for (const race of await f1.fetchRaces(year, now)) {
      if (!race.finished) {
        if (new Date(race.start) - now < UPCOMING_DAYS.f1 * 864e5) upcoming.push(upcomingF1(race));
        continue;
      }
      const id = `f1-${race.sessionKey}`;
      if (isCurrent(id) || now - new Date(race.start) > KEEP_DAYS.f1 * 864e5) continue;
      try {
        const data = await f1.fetchRaceData(race.sessionKey);
        if (!data) continue; // results not published yet; try next run
        const scored = scoreF1(f1.factsFromRace(data));
        save(publishF1(race, scored), scored);
        console.log(`f1: ${race.name} ${year}`);
      } catch (err) {
        warn(`f1 ${race.name} ${year}: ${err.message}`);
      }
    }
  }
}

const builders = { football: [buildFootball, buildUpcomingFootball], tennis: [buildTennis], f1: [buildF1] };
const previousUpcoming = readJson(EVENTS, {}).upcoming ?? [];
for (const [sport, steps] of Object.entries(builders)) {
  if (only && only !== sport) {
    upcoming.push(...previousUpcoming.filter((e) => e.sport === sport)); // keep what the skipped sport had
    continue;
  }
  for (const build of steps) {
    try {
      await build();
    } catch (err) {
      warn(`${sport} failed: ${err.message}`); // one broken source shouldn't stop the others
    }
  }
}

for (const [id, e] of events) {
  if (now - new Date(e.start) > KEEP_DAYS[e.sport] * 864e5) events.delete(id);
}
for (const r of expiringRights(now)) warn(`Streaming rights need checking: ${r} (src/rights/norway.json)`);

const list = [...events.values()].sort((a, b) => b.start.localeCompare(a.start));
mkdirSync(new URL('docs/data/', root), { recursive: true });
mkdirSync(new URL('data/', root), { recursive: true });
// An event that finished and got scored shouldn't also be listed as upcoming.
const soon = [...new Map(upcoming.filter((e) => !events.has(e.id)).map((e) => [e.id, e])).values()]
  .sort((a, b) => a.start.localeCompare(b.start));
writeFileSync(EVENTS, JSON.stringify({ generated: now.toISOString(), events: list, upcoming: soon }) + '\n');
writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
writeFileSync(REASONS, JSON.stringify(Object.fromEntries(list.filter((e) => reasons.has(e.id)).map((e) => [e.id, reasons.get(e.id)]))) + '\n');
const count = (s) => list.filter((e) => e.sport === s).length;
console.log(`events.json: ${list.length} events (football ${count('football')}, tennis ${count('tennis')}, f1 ${count('f1')}), ${soon.length} upcoming`);
