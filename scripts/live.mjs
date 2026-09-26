// The light, frequent check (every 15 minutes). It only looks at events that are
// live or about to start, according to the upcoming list the full build made:
//   - marks them LIVE when they start,
//   - scores them as soon as they have finished, and moves them to the replays.
// When nothing is on it makes no requests at all and changes nothing.
//   npm run live

import { FOOTBALL } from '../src/competitions.mjs';
import { scoreFootball } from '../src/scoring/football.mjs';
import { scoreTennis } from '../src/scoring/tennis.mjs';
import { scoreF1 } from '../src/scoring/f1.mjs';
import * as football from '../src/sources/espn-football.mjs';
import * as tennis from '../src/sources/espn-tennis.mjs';
import * as f1 from '../src/sources/openf1.mjs';
import { getJson } from '../src/http.mjs';
import { publishFootball, publishTennis, publishF1, upcomingFootball, upcomingTennis } from '../src/publish.mjs';
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

// "In play" window: from 10 minutes before the start until `hours` after it.
const inWindow = (e, hours) => {
  const t = new Date(e.start).getTime();
  return t - 10 * 60e3 <= now.getTime() && now.getTime() <= t + hours * 3600e3;
};
const ymd = (iso) => iso.slice(0, 10).replaceAll('-', '');

async function liveFootball() {
  const active = upcoming.filter((e) => e.sport === 'football' && inWindow(e, 4));
  // One scoreboard request per competition and day covers all its matches.
  const days = new Map(active.map((e) => [`${e.comp}|${ymd(e.start)}`, e]));
  for (const key of days.keys()) {
    const [compKey, day] = key.split('|');
    const comp = FOOTBALL.find((c) => c.key === compKey);
    for (const m of await football.fetchDay(compKey, day)) {
      const id = `fb-${m.espnId}`;
      if (!upcoming.some((e) => e.id === id)) continue;
      if (m.finished) {
        try {
          const scored = scoreFootball(football.factsFromSummary(await football.fetchSummary(compKey, m.espnId)));
          save(publishFootball(comp, m, scored), scored);
          upcoming = upcoming.filter((e) => e.id !== id);
          console.log(`scored ${m.home} – ${m.away}`);
        } catch (err) {
          warn(`football ${compKey} ${m.espnId}: ${err.message}`); // try again next time
        }
      } else if (m.state === 'pre' || m.state === 'in') {
        upcoming = upcoming.map((e) => (e.id === id ? upcomingFootball(comp, m) : e)); // live flag, new kick-off time
      } else {
        upcoming = upcoming.filter((e) => e.id !== id); // postponed or cancelled
      }
    }
  }
}

async function liveF1() {
  for (const e of upcoming.filter((x) => x.sport === 'f1' && inWindow(x, 6))) {
    const sessionKey = Number(e.id.slice(3));
    const [session] = await getJson(`https://api.openf1.org/v1/sessions?session_key=${sessionKey}`, { gapMs: 700 });
    if (!session) continue;
    const finished = new Date(session.date_end).getTime() + 3600e3 < now.getTime();
    if (!finished) {
      e.status = new Date(session.date_start) <= now ? 'live' : 'upcoming';
      continue;
    }
    const raceData = await f1.fetchRaceData(sessionKey);
    if (!raceData) continue; // results not out yet
    const race = { sessionKey, name: e.compName, circuit: e.circuit, start: e.start };
    const scored = scoreF1(f1.factsFromRace(raceData));
    save(publishF1(race, scored), scored);
    upcoming = upcoming.filter((x) => x.id !== e.id);
    console.log(`scored ${e.compName}`);
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

for (const [sport, run] of Object.entries({ football: liveFootball, f1: liveF1, tennis: liveTennis })) {
  try {
    await run();
  } catch (err) {
    warn(`live ${sport} failed: ${err.message}`);
  }
}

if (JSON.stringify([upcoming, [...events.keys()]]) === before) {
  console.log('live: nothing changed');
} else {
  console.log(saveData({ events, upcoming, reasons, results, state: data.state }, now));
}
