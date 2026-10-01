// The light, frequent check (every 15 minutes). It only looks at events that are
// live or about to start, according to the upcoming list the full build made:
//   - adds football line-ups once ESPN has them (about 75 minutes before kick-off),
//   - marks them LIVE when they start,
//   - scores them as soon as they have finished, and moves them to the replays.
// When nothing is on it makes no requests at all and changes nothing.
//   npm run live

import { FOOTBALL } from '../src/competitions.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1, scoreQuali } from '../src/scoring/f1.mjs';
import * as football from '../src/sources/espn-football.mjs';
import * as tennis from '../src/sources/espn-tennis.mjs';
import * as f1 from '../src/sources/openf1.mjs';
import { getJson } from '../src/http.mjs';
import { publishFootball, publishTennis, publishF1, upcomingFootball, upcomingTennis, lineupFields } from '../src/publish.mjs';
import { loadData, saveData } from '../src/store.mjs';

const now = process.env.NOW ? new Date(process.env.NOW) : new Date(); // NOW=... pretends it's another time (for testing)
const data = loadData();
const { events, reasons, results } = data;
let upcoming = data.upcoming;
const before = JSON.stringify([upcoming, [...events.keys()]]);
const warn = (msg) => console.log(`::warning::${msg}`);
const save = (event, scored) => {
  events.set(event.id, event);
  reasons.set(event.id, scored.reasons);
  results.set(event.id, scored.result);
};

// "In play" window: from `minutesBefore` the start until `hours` after it.
const inWindow = (e, hours, minutesBefore = 10) => {
  const t = new Date(e.start).getTime();
  return t - minutesBefore * 60e3 <= now.getTime() && now.getTime() <= t + hours * 3600e3;
};
const ymd = (iso) => iso.slice(0, 10).replaceAll('-', '');

// Line-ups come out about 75 minutes before kick-off. From 90 minutes before,
// ask for each match that doesn't have them yet: one request per match and run,
// and none once both teams are in.
const LINEUP_MINUTES = 90;

async function lineupsFootball() {
  for (const e of upcoming.filter((x) => x.sport === 'football' && !x.lineups && inWindow(x, 4, LINEUP_MINUTES))) {
    try {
      const lineups = football.lineupsFromSummary(await football.fetchSummary(e.comp, e.id.slice(3)));
      if (!lineups) continue; // not announced yet
      Object.assign(e, lineupFields(lineups));
      console.log(`line-ups for ${e.teams.join(' – ')}`);
    } catch (err) {
      warn(`line-ups ${e.comp} ${e.id}: ${err.message}`); // try again next time
    }
  }
}

async function liveFootball() {
  await lineupsFootball();
  const active = upcoming.filter((e) => e.sport === 'football' && inWindow(e, 4));
  // One scoreboard request per competition and day covers all its matches.
  const days = new Map(active.map((e) => [`${e.comp}|${ymd(e.start)}`, e]));
  for (const key of days.keys()) {
    const [compKey, day] = key.split('|');
    const comp = FOOTBALL.find((c) => c.key === compKey);
    for (const m of await football.fetchDay(compKey, day)) {
      const id = `fb-${m.espnId}`;
      const old = upcoming.find((e) => e.id === id);
      if (!old) continue;
      if (m.finished) {
        try {
          const summary = await football.fetchSummary(compKey, m.espnId);
          const scored = scoreFootball({ ...football.factsFromSummary(summary), stakes: old.stakes });
          save(publishFootball(comp, m, scored, { lineups: football.lineupsFromSummary(summary) ?? old.lineups, stakes: old.stakes }), scored);
          upcoming = upcoming.filter((e) => e.id !== id);
          console.log(`scored ${m.home} – ${m.away}`);
        } catch (err) {
          warn(`football ${compKey} ${m.espnId}: ${err.message}`); // try again next time
        }
      } else if (m.state === 'pre' || m.state === 'in') {
        // Live flag and new kick-off time; the pre-match hints stay as the full build froze them.
        upcoming = upcoming.map((e) => (e.id === id ? upcomingFootball(comp, m, { lineups: old.lineups, stakes: old.stakes, forecast: old.forecast }) : e));
      } else {
        upcoming = upcoming.filter((e) => e.id !== id); // postponed or cancelled
      }
    }
  }
}

// OpenF1 is closed to free users while a session is live, so during the race we
// only flip the LIVE badge by the clock, and ask OpenF1 once it should be over.
const F1_RACE_HOURS = 3; // a race lasts about 2 h; results appear an hour or so later
const F1_SHORT_HOURS = 1.5; // qualifying lasts an hour, a sprint about 35 minutes

async function liveF1() {
  for (const e of upcoming.filter((x) => x.sport === 'f1' && inWindow(x, 6))) {
    const start = new Date(e.start).getTime();
    const quali = f1.isQualiSession(e.session);
    if (now.getTime() < start + (e.session ? F1_SHORT_HOURS : F1_RACE_HOURS) * 3600e3) {
      e.status = start <= now.getTime() ? 'live' : 'upcoming';
      continue;
    }
    const sessionKey = Number(e.id.slice(3));
    const [session] = await getJson(`https://api.openf1.org/v1/sessions?session_key=${sessionKey}`, { gapMs: 700 });
    if (!session) continue;
    const finished = new Date(session.date_end).getTime() + 3600e3 < now.getTime();
    if (!finished) {
      e.status = new Date(session.date_start) <= now ? 'live' : 'upcoming';
      continue;
    }
    const data = quali ? await f1.fetchQualiData(sessionKey) : await f1.fetchRaceData(sessionKey);
    if (!data) continue; // results not out yet
    const race = { sessionKey, name: e.compName, circuit: e.circuit, start: e.start, session: e.session };
    const scored = quali ? scoreQuali(f1.factsFromQuali(data)) : scoreF1(f1.factsFromRace(data), { sprint: e.session === 'sprint' });
    save(publishF1(race, scored), scored);
    upcoming = upcoming.filter((x) => x.id !== e.id);
    console.log(`scored ${e.compName}${e.session ? ` ${e.session}` : ''}`);
  }
}

async function liveTennis() {
  if (!upcoming.some((e) => e.sport === 'tennis' && inWindow(e, 6))) return;
  // During a Slam, today's scoreboard returns the whole tournament in one request.
  const current = await tennis.fetchSlamOn(ymd(now.toISOString()));
  if (!current) return;
  for (const m of tennis.matchesFromSlam(current)) {
    if (events.has(`tn-${m.espnId}`)) continue;
    const scored = scoreTennis(m);
    save(publishTennis(m, scored), scored);
  }
  upcoming = [...upcoming.filter((e) => e.sport !== 'tennis'), ...tennis.upcomingFromSlam(current).map(upcomingTennis)];
}

// Winter races: only the LIVE badge, by the clock. They're scored by the full
// build (every 3 hours), which reads FIS's web pages at a gentle pace.
function liveWinter() {
  for (const e of upcoming.filter((x) => x.sport === 'winter')) {
    if (new Date(e.start).getTime() <= now.getTime()) e.status = 'live';
  }
}

for (const [sport, run] of Object.entries({ football: liveFootball, f1: liveF1, tennis: liveTennis, winter: liveWinter })) {
  try {
    await run();
  } catch (err) {
    if (err.f1Live) console.log('live f1: an F1 session is still live, so OpenF1 is closed; trying again next run');
    else warn(`live ${sport} failed: ${err.message}`);
  }
}

if (JSON.stringify([upcoming, [...events.keys()]]) === before) {
  console.log('live: nothing changed');
} else {
  console.log(saveData({ events, upcoming, reasons, results, state: data.state }, now));
}
