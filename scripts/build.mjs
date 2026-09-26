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
import { publishFootball, publishTennis, publishF1, expiringRights } from '../src/publish.mjs';

const root = new URL('..', import.meta.url);
const EVENTS = new URL('docs/data/events.json', root);
const STATE = new URL('data/state.json', root);
const readJson = (url, fallback) => (existsSync(url) ? JSON.parse(readFileSync(url)) : fallback);
const warn = (msg) => console.log(`::warning::${msg}`);

const now = new Date();
const only = process.argv[2];
const events = new Map(readJson(EVENTS, { events: [] }).events.map((e) => [e.id, e]));
let state = readJson(STATE, {});
if (state.version !== SCORING_VERSION) state = { version: SCORING_VERSION }; // formula changed: redo everything
state.footballDays ??= {};
state.slamsDone ??= [];

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
          const facts = football.factsFromSummary(await football.fetchSummary(comp.key, m.espnId));
          events.set(id, publishFootball(comp, m, scoreFootball(facts)));
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

async function buildTennis() {
  const done = new Set(state.slamsDone);
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear()]) {
    for (const slam of await tennis.fetchSlams(year, now, done)) {
      const matches = tennis.matchesFromSlam(slam);
      for (const m of matches) events.set(`tn-${m.espnId}`, publishTennis(m, scoreTennis(m)));
      if (slam.endDate && new Date(slam.endDate).getTime() + 2 * 864e5 < now.getTime()) done.add(slam.id);
      console.log(`tennis: ${slam.name} ${year}: ${matches.length} matches`);
    }
  }
  state.slamsDone = [...done];
}

async function buildF1() {
  for (const year of [now.getUTCFullYear() - 1, now.getUTCFullYear()]) {
    for (const race of await f1.fetchRaces(year, now)) {
      const id = `f1-${race.sessionKey}`;
      if (isCurrent(id) || now - new Date(race.start) > KEEP_DAYS.f1 * 864e5) continue;
      try {
        const data = await f1.fetchRaceData(race.sessionKey);
        if (!data) continue; // results not published yet; try next run
        events.set(id, publishF1(race, scoreF1(f1.factsFromRace(data))));
        console.log(`f1: ${race.name} ${year}`);
      } catch (err) {
        warn(`f1 ${race.name} ${year}: ${err.message}`);
      }
    }
  }
}

const builders = { football: buildFootball, tennis: buildTennis, f1: buildF1 };
for (const [sport, build] of Object.entries(builders)) {
  if (only && only !== sport) continue;
  try {
    await build();
  } catch (err) {
    warn(`${sport} failed: ${err.message}`); // one broken source shouldn't stop the others
  }
}

for (const [id, e] of events) {
  if (now - new Date(e.start) > KEEP_DAYS[e.sport] * 864e5) events.delete(id);
}
for (const r of expiringRights(now)) warn(`Streaming rights need checking: ${r} (src/rights/norway.json)`);

const list = [...events.values()].sort((a, b) => b.start.localeCompare(a.start));
mkdirSync(new URL('docs/data/', root), { recursive: true });
mkdirSync(new URL('data/', root), { recursive: true });
writeFileSync(EVENTS, JSON.stringify({ generated: now.toISOString(), events: list }) + '\n');
writeFileSync(STATE, JSON.stringify(state, null, 1) + '\n');
const count = (s) => list.filter((e) => e.sport === s).length;
console.log(`events.json: ${list.length} events (football ${count('football')}, tennis ${count('tennis')}, f1 ${count('f1')})`);
