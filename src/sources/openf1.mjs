// Formula 1 races from OpenF1 (api.openf1.org). Free, no key for historical data.
// OpenF1 answers "429 Too Many Requests" quickly, so requests are spaced out.

import { getJson } from '../http.mjs';

const BASE = 'https://api.openf1.org/v1';
const get = (path) => getJson(`${BASE}/${path}`, { gapMs: 700, retries: 5 });

// OpenF1's session names for the sessions PrimeTime scores.
export const SESSIONS = { race: 'Race', qualifying: 'Qualifying', sprint: 'Sprint', 'sprint-qualifying': 'Sprint Qualifying' };
export const isQualiSession = (session) => session === 'qualifying' || session === 'sprint-qualifying';

// The season's meetings (Grand Prix names), fetched once per year and run.
const meetingCache = new Map();
const meetingsOf = (year) => {
  if (!meetingCache.has(year)) meetingCache.set(year, get(`meetings?year=${year}`).catch((err) => { meetingCache.delete(year); throw err; }));
  return meetingCache.get(year);
};

// Races of a season (or other sessions: see SESSIONS), oldest first, each
// marked finished (ended over an hour ago) or not.
export async function fetchRaces(year, now = new Date(), session = 'race') {
  const name = encodeURIComponent(SESSIONS[session]);
  const [sessions, meetings] = [await get(`sessions?year=${year}&session_name=${name}`), await meetingsOf(year)];
  const names = new Map(meetings.map((m) => [m.meeting_key, m.meeting_name]));
  return sessions
    .filter((s) => !s.is_cancelled)
    .map((s) => ({
      finished: new Date(s.date_end).getTime() + 3600e3 < now.getTime(),
      live: new Date(s.date_start) <= now && new Date(s.date_end).getTime() + 3600e3 >= now.getTime(),
      sessionKey: s.session_key,
      name: names.get(s.meeting_key) ?? `${s.country_name} Grand Prix`,
      circuit: s.circuit_short_name,
      start: s.date_start,
      session,
    }));
}

// OpenF1 answers "404 Not Found" instead of an empty list when it has no rows.
const maybe = (path) => get(path).catch((err) => { if (/^404/.test(err.message)) return []; throw err; });

// "LANDO NORRIS" -> "Lando Norris" (for the result spoiler), or "Car 4" if unknown.
function driverName(d, num) {
  const full = d.drivers?.find((x) => x.driver_number === num)?.full_name;
  return full ? full.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') : `Car ${num}`;
}

// One session's times (date_start, date_end), or undefined.
export const fetchSession = async (sessionKey) => (await maybe(`sessions?session_key=${sessionKey}`))[0];

// Everything the scorer needs for one race. Returns null if OpenF1 has no result yet.
export async function fetchRaceData(sessionKey) {
  const result = await maybe(`session_result?session_key=${sessionKey}`);
  if (!result.length) return null;
  const winner = result.find((r) => r.position === 1)?.driver_number ?? result[0].driver_number;
  return {
    result,
    overtakes: await maybe(`overtakes?session_key=${sessionKey}`),
    raceControl: await maybe(`race_control?session_key=${sessionKey}`),
    position: await maybe(`position?session_key=${sessionKey}`),
    weather: await maybe(`weather?session_key=${sessionKey}`),
    laps: await maybe(`laps?session_key=${sessionKey}&driver_number=${winner}`),
    pit: await maybe(`pit?session_key=${sessionKey}`),
    drivers: await maybe(`drivers?session_key=${sessionKey}`),
  };
}

// Turns raw OpenF1 data into the plain facts the scorer needs.
export function factsFromRace(d) {
  const laps = [...d.laps].filter((l) => l.date_start).sort((a, b) => a.lap_number - b.lap_number);
  const totalLaps = Math.max(...d.result.map((r) => r.number_of_laps ?? 0), laps.length);
  const raceStart = laps[0] ? Date.parse(laps[0].date_start) : 0;
  const lapAt = (iso) => {
    const t = Date.parse(iso);
    let lap = 1;
    for (const l of laps) if (Date.parse(l.date_start) <= t) lap = l.lap_number;
    return lap;
  };

  // Position changes caused by pit stops aren't real racing, so ignore anything
  // involving a car that pitted within a lap of it.
  const pitted = new Set((d.pit ?? []).map((p) => `${p.driver_number}:${p.lap_number}`));
  const nearPit = (driver, lap) => [lap - 1, lap, lap + 1].some((l) => pitted.has(`${driver}:${l}`));

  // Leader at the end of each lap (index 0 = on the grid).
  const leaderRows = d.position.filter((p) => p.position === 1).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const leaderAfter = [];
  for (let lap = 0, i = 0, cur = leaderRows[0]?.driver_number; lap <= laps.length; lap++) {
    const until = lap < laps.length ? Date.parse(laps[lap].date_start) : Infinity; // start of lap+1
    while (i < leaderRows.length && Date.parse(leaderRows[i].date) < until) cur = leaderRows[i++].driver_number;
    leaderAfter.push(cur);
  }
  // Not at the start (lap 1): whether the pole-sitter kept the lead into turn 1 would show in the score.
  const leadChanges = [];
  for (let lap = 2; lap < leaderAfter.length; lap++) {
    const [was, now] = [leaderAfter[lap - 1], leaderAfter[lap]];
    if (was !== now && !nearPit(was, lap) && !nearPit(now, lap)) leadChanges.push(lap);
  }

  // Overtakes after the first lap, not pit-related, and not undone within two laps (timing noise).
  const moves = d.overtakes
    .filter((o) => Date.parse(o.date) >= raceStart)
    .map((o) => ({ lap: lapAt(o.date), position: o.position, by: o.overtaking_driver_number, on: o.overtaken_driver_number }))
    .filter((o) => !nearPit(o.by, o.lap) && !nearPit(o.on, o.lap));
  const undone = (o) => moves.some((x) => x.by === o.on && x.on === o.by && Math.abs(x.lap - o.lap) <= 2);
  const overtakes = moves.filter((o) => o.lap > 1 && !undone(o));
  const startMoves = moves.filter((o) => o.lap === 1 && !undone(o)).length;

  // "1. Lando Norris, 2. …, 3. … (won by 4.4 s)", names in normal case.
  const nameOf = (num) => driverName(d, num);
  const podium = [1, 2, 3].map((p) => d.result.find((r) => r.position === p)).filter(Boolean);
  const gap = d.result.find((r) => r.position === 2)?.gap_to_leader;
  const result = podium.map((r) => `${r.position}. ${nameOf(r.driver_number)}`).join(', ')
    + (typeof gap === 'number' ? ` (won by ${gap.toFixed(1)} s)` : '');

  const rc = d.raceControl;
  const msgLaps = (re) => rc.filter((m) => re.test(m.message ?? '')).map((m) => m.lap_number ?? 1);
  const p2 = d.result.find((r) => r.position === 2);

  return {
    result,
    totalLaps,
    overtakes: overtakes.map(({ lap, position }) => ({ lap, position })),
    startMoves,
    leadChanges,
    safetyCars: msgLaps(/^SAFETY CAR DEPLOYED/i),
    vscs: msgLaps(/^VSC DEPLOYED|VIRTUAL SAFETY CAR DEPLOYED/i),
    redFlags: [...new Set(rc.filter((m) => m.flag === 'RED').map((m) => m.lap_number ?? 1))],
    gapP2: typeof p2?.gap_to_leader === 'number' ? p2.gap_to_leader : null,
    dnfs: d.result.filter((r) => r.dnf).length,
    rain: d.weather.some((w) => w.rainfall > 0 && Date.parse(w.date) >= raceStart),
  };
}

// Qualifying gets no score or tips (the owner found they gave too much away), so only
// the result is needed, for "Show the result". Returns null if OpenF1 has no result yet.
export async function fetchQualiData(sessionKey) {
  const result = await maybe(`session_result?session_key=${sessionKey}`);
  if (!result.length) return null;
  return { result, drivers: await maybe(`drivers?session_key=${sessionKey}`) };
}

// "1. Lando Norris, 2. …, 3. … (pole by 0.026 s)". session_result gives each car's
// best time in each part (duration: [q1, q2, q3]).
export function factsFromQuali(d) {
  const best = (r, q) => (typeof r.duration?.[q] === 'number' ? r.duration[q] : null);
  const q3 = d.result.filter((r) => best(r, 2) != null).sort((a, b) => best(a, 2) - best(b, 2));
  const nameOf = (num) => driverName(d, num);
  const top = d.result.filter((r) => r.position <= 3).sort((a, b) => a.position - b.position);
  const gapP2 = q3.length >= 2 ? best(q3[1], 2) - best(q3[0], 2) : null;
  const result = top.map((r) => `${r.position}. ${nameOf(r.driver_number)}`).join(', ')
    + (gapP2 != null ? ` (pole by ${gapP2.toFixed(3)} s)` : '');

  return { result };
}
