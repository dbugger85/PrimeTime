// Fetches finished events, scores them and writes docs/data/events.json.
// Run by GitHub Actions every few hours; you can also run it yourself:
//   npm run build            (everything)
//   npm run build -- f1      (just one sport: football, tennis, f1 or winter)
//
// To stay polite to the free APIs, it remembers what it has already done:
// events already in events.json are not fetched again, and data/state.json
// lists football days and tennis Slams that are complete.

import { FOOTBALL, KEEP_DAYS } from '../src/competitions.mjs';
import { SCORING_VERSIONS } from '../src/scoring/common.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1, scoreQuali } from '../src/scoring/f1.mjs';
import * as football from '../src/sources/espn-football.mjs';
import * as tennis from '../src/sources/espn-tennis.mjs';
import * as f1 from '../src/sources/openf1.mjs';
import * as winter from '../src/sources/winter.mjs';
import * as standings from '../src/sources/espn-standings.mjs';
import { forecastOf, stakesFor, STAKES_COMPS } from '../src/prematch.mjs';
import { publishFootball, publishTennis, publishF1, publishWinter, upcomingFootball, upcomingTennis, upcomingF1, upcomingWinter, expiringRights } from '../src/publish.mjs';
import { loadData, saveData } from '../src/store.mjs';

const warn = (msg) => console.log(`::warning::${msg}`);

const now = new Date();
const only = process.argv[2];
const data = loadData();
const { events, reasons, results } = data;
// Saves a scored event: the spoiler-free card data, and separately the reasons behind its score.
const save = (event, scored) => {
  events.set(event.id, event);
  reasons.set(event.id, scored.reasons);
  results.set(event.id, scored.result);
};
let state = data.state;
// A sport's formula or weights changed: forget which days and Slams are done, so they're fetched again.
state.versions ??= {};
delete state.version; // the old single version, before each sport had its own
if (state.versions.football !== SCORING_VERSIONS.football) state.footballDays = {};
if (state.versions.tennis !== SCORING_VERSIONS.tennis) state.slamsDone = [];
state.footballDays ??= {};
state.stakes ??= {}; // frozen "what's at stake" per match id: { code, start }
for (const [id, s] of Object.entries(state.stakes)) if (now - new Date(s.start) > (KEEP_DAYS.football + 2) * 864e5) delete state.stakes[id];
state.slamsDone ??= [];

// GitHub stops a run after 30 minutes and then nothing is saved. Re-scoring a
// whole year of F1 can take a while, so after 18 minutes the build stops
// fetching more, saves what it has, and carries on at the next full build.
const BUDGET_MS = Number(process.env.BUDGET_MIN ?? 18) * 60e3; // BUDGET_MIN=2 to try it out
let outOfTimeNoted = false;
const outOfTime = () => {
  const out = Date.now() - now.getTime() > BUDGET_MS;
  if (out && !outOfTimeNoted) console.log('Out of time for this run: saving what is done, the rest comes next run');
  outOfTimeNoted ||= out;
  return out;
};

// Not-yet-finished events are rebuilt from scratch every run (times change, matches go live).
const upcoming = [];
const UPCOMING_DAYS = { football: 14, f1: 60, winter: 14 };

// Already scored with the current formula and weights for its sport (false for new events).
const isCurrent = (id) => {
  const e = events.get(id);
  return Boolean(e) && e.v === SCORING_VERSIONS[e.sport];
};
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
        if (outOfTime()) { complete = false; continue; }
        try {
          const summary = await football.fetchSummary(comp.key, m.espnId);
          const stakes = events.get(id)?.stakes ?? previous.get(id)?.stakes ?? state.stakes[id]?.code; // frozen before kick-off
          const scored = scoreFootball({ ...football.factsFromSummary(summary), stakes });
          save(publishFootball(comp, m, scored, { lineups: football.lineupsFromSummary(summary), stakes }), scored);
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

// Keeps the line-ups the live check found, and looks for them itself for
// matches starting within LINEUP_MINUTES (the live check doesn't run when this does).
const LINEUP_MINUTES = 90;
const previous = new Map(data.upcoming.map((e) => [e.id, e])); // the last run's upcoming list
async function lineupsFor(comp, m) {
  const known = previous.get(`fb-${m.espnId}`)?.lineups;
  if (known || new Date(m.start) - now > LINEUP_MINUTES * 60e3) return known;
  try {
    return football.lineupsFromSummary(await football.fetchSummary(comp.key, m.espnId));
  } catch (err) {
    warn(`line-ups ${comp.key} ${m.espnId}: ${err.message}`);
  }
}

// League tables for "what's at stake": one request per competition and run, only when needed.
const tables = new Map();
async function tablesFor(compKey) {
  if (!STAKES_COMPS.has(compKey)) return null;
  if (!tables.has(compKey)) {
    try {
      tables.set(compKey, await standings.fetchTables(compKey));
    } catch (err) {
      warn(`standings ${compKey}: ${err.message}`);
      tables.set(compKey, null);
    }
  }
  return tables.get(compKey);
}

// The forecast and the stakes are worked out only while a match hasn't started, and then
// kept as they were: once it's on, the odds and the table follow the score.
async function upcomingEntry(comp, m) {
  const old = previous.get(`fb-${m.espnId}`);
  const lineups = await lineupsFor(comp, m);
  if (m.state !== 'pre') return upcomingFootball(comp, m, { lineups, stakes: old?.stakes, forecast: old?.forecast });
  const table = await tablesFor(comp.key);
  const stakes = table ? stakesFor(table, m.home, m.away, comp.key) : old?.stakes; // keep the old one if ESPN failed
  // Also remembered in state, in case the match finishes but can't be scored at once
  // (it then isn't in the next run's upcoming list any more).
  if (stakes) state.stakes[`fb-${m.espnId}`] = { code: stakes, start: m.start };
  else delete state.stakes[`fb-${m.espnId}`];
  return upcomingFootball(comp, m, { lineups, stakes, forecast: forecastOf(m.odds) });
}

async function buildUpcomingFootball() {
  for (const comp of FOOTBALL) {
    for (let ahead = 0; ahead <= UPCOMING_DAYS.football; ahead++) {
      for (const m of await football.fetchDay(comp.key, ymd(daysAgo(-ahead)))) {
        if (m.state === 'pre' || m.state === 'in') upcoming.push(await upcomingEntry(comp, m));
      }
    }
  }
  // Matches still being played from yesterday evening (or with the day boundary in UTC).
  for (const comp of FOOTBALL) {
    for (const m of await football.fetchDay(comp.key, ymd(daysAgo(1)))) {
      if (m.state === 'in') upcoming.push(await upcomingEntry(comp, m));
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
  const sessions = [];
  for (const year of years) {
    for (const kind of Object.keys(f1.SESSIONS)) sessions.push(...await f1.fetchRaces(year, now, kind));
  }
  sessions.sort((a, b) => b.start.localeCompare(a.start)); // newest first, in case time runs out
  for (const race of sessions) {
    const year = race.start.slice(0, 4);
    const quali = f1.isQualiSession(race.session);
    if (!race.finished) {
      if (new Date(race.start) - now < UPCOMING_DAYS.f1 * 864e5) upcoming.push(upcomingF1(race));
      continue;
    }
    const id = `f1-${race.sessionKey}`;
    if (isCurrent(id) || now - new Date(race.start) > KEEP_DAYS.f1 * 864e5 || outOfTime()) continue;
    try {
      const data = quali ? await f1.fetchQualiData(race.sessionKey) : await f1.fetchRaceData(race.sessionKey);
      if (!data) continue; // results not published yet; try next run
      const scored = quali ? scoreQuali(f1.factsFromQuali(data)) : scoreF1(f1.factsFromRace(data), { sprint: race.session === 'sprint' });
      save(publishF1(race, scored), scored);
      console.log(`f1: ${race.name} ${f1.SESSIONS[race.session].toLowerCase()} ${year}`);
    } catch (err) {
      if (err.f1Live) throw err; // every other request would be refused too
      warn(`f1 ${race.name} ${year}: ${err.message}`);
    }
  }
}

// Biathlon, alpine and cross-country, newest first (in case time runs out).
async function buildWinter() {
  if (state.versions?.winter !== SCORING_VERSIONS.winter) state.winterEventsDone = []; // weights changed: look at every event again
  const races = await winter.listRaces(now, state, { aheadDays: UPCOMING_DAYS.winter, keepDays: KEEP_DAYS.winter });
  races.sort((a, b) => b.start.localeCompare(a.start));
  for (const race of races) {
    const compName = winter.WINTER[race.comp].name;
    if (!race.finished) {
      if (new Date(race.start) - now < UPCOMING_DAYS.winter * 864e5) upcoming.push(upcomingWinter(race, compName));
      continue;
    }
    if (isCurrent(race.id) || now - new Date(race.start) > KEEP_DAYS.winter * 864e5 || outOfTime()) continue;
    try {
      const scored = await winter.scoreRace(race);
      if (!scored) continue; // no result yet; try next run
      save(publishWinter(race, compName, scored), scored);
      console.log(`winter: ${compName} ${race.name}, ${race.place} ${race.start.slice(0, 10)}`);
    } catch (err) {
      warn(`winter ${race.id}: ${err.message}`);
    }
  }
}

const builders = { football: [buildFootball, buildUpcomingFootball], tennis: [buildTennis], f1: [buildF1], winter: [buildWinter] };
const previousUpcoming = data.upcoming;
for (const [sport, steps] of Object.entries(builders)) {
  if (only && only !== sport) {
    upcoming.push(...previousUpcoming.filter((e) => e.sport === sport)); // keep what the skipped sport had
    continue;
  }
  for (const build of steps) {
    try {
      await build();
    } catch (err) {
      if (err.f1Live) console.log(`${sport}: a live F1 session is on, so OpenF1 is closed to free users; trying again next run`);
      else warn(`${sport} failed: ${err.message}`); // one broken source shouldn't stop the others
    }
  }
  // If a source failed before listing anything, keep what it had in "Coming up".
  if (!upcoming.some((e) => e.sport === sport)) upcoming.push(...previousUpcoming.filter((e) => e.sport === sport));
}

for (const [id, e] of events) {
  if (now - new Date(e.start) > KEEP_DAYS[e.sport] * 864e5) events.delete(id);
}
for (const r of expiringRights(now)) warn(`Streaming rights need checking: ${r} (src/rights/norway.json)`);

if (!only) state.lastFull = now.toISOString(); // the live check uses this to know when a full build is due
state.versions = { ...SCORING_VERSIONS };
console.log(saveData({ events, upcoming, reasons, results, state }, now));
