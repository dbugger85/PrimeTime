// Formula 1 races from OpenF1 (api.openf1.org). Free, no key for historical data.
// OpenF1 answers "429 Too Many Requests" quickly, so requests are spaced out.

import { getJson } from '../http.mjs';

const BASE = 'https://api.openf1.org/v1';
const get = (path) => getJson(`${BASE}/${path}`, { gapMs: 700, retries: 5 });

// Races (or, with session = 'qualifying', Grand Prix qualifying sessions) of a
// season, oldest first, each marked finished (ended over an hour ago) or not.
export async function fetchRaces(year, now = new Date(), session = 'race') {
  const name = session === 'qualifying' ? 'Qualifying' : 'Race';
  const [sessions, meetings] = [await get(`sessions?year=${year}&session_name=${name}`), await get(`meetings?year=${year}`)];
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

// Everything the scorer needs for one race. Returns null if OpenF1 has no result yet.
export async function fetchRaceData(sessionKey) {
  const result = await get(`session_result?session_key=${sessionKey}`);
  if (!result.length) return null;
  const winner = result.find((r) => r.position === 1)?.driver_number ?? result[0].driver_number;
  return {
    result,
    overtakes: await get(`overtakes?session_key=${sessionKey}`),
    raceControl: await get(`race_control?session_key=${sessionKey}`),
    position: await get(`position?session_key=${sessionKey}`),
    weather: await get(`weather?session_key=${sessionKey}`),
    laps: await get(`laps?session_key=${sessionKey}&driver_number=${winner}`),
    pit: await get(`pit?session_key=${sessionKey}`),
    drivers: await get(`drivers?session_key=${sessionKey}`),
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
  const leadChanges = [];
  for (let lap = 1; lap < leaderAfter.length; lap++) {
    const [was, now] = [leaderAfter[lap - 1], leaderAfter[lap]];
    if (was !== now && (lap === 1 || (!nearPit(was, lap) && !nearPit(now, lap)))) leadChanges.push(lap);
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
  const nameOf = (num) => {
    const full = d.drivers?.find((x) => x.driver_number === num)?.full_name;
    return full ? full.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') : `Car ${num}`;
  };
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

// OpenF1 answers "404 Not Found" instead of an empty list when it has no rows.
const maybe = (path) => get(path).catch((err) => { if (/^404/.test(err.message)) return []; throw err; });

// Everything the qualifying scorer needs. Returns null if OpenF1 has no result yet.
export async function fetchQualiData(sessionKey) {
  const result = await maybe(`session_result?session_key=${sessionKey}`);
  if (!result.length) return null;
  return {
    result,
    raceControl: await maybe(`race_control?session_key=${sessionKey}`),
    laps: await maybe(`laps?session_key=${sessionKey}`),
    weather: await maybe(`weather?session_key=${sessionKey}`),
    drivers: await maybe(`drivers?session_key=${sessionKey}`),
  };
}

// Qualifying facts. Q1 and Q2 knock out the slowest cars; Q3 decides pole.
// session_result gives each car's best time in each part (duration: [q1, q2, q3]).
export function factsFromQuali(d) {
  const best = (r, q) => (typeof r.duration?.[q] === 'number' ? r.duration[q] : null);
  const inPart = (q) => d.result.filter((r) => best(r, q) != null).sort((a, b) => best(a, q) - best(b, q));
  const [q1, q2, q3] = [0, 1, 2].map(inPart);

  // How close the knockout was: the last car through vs the first one out, by
  // their times in that part. With 22 cars, 16 get through Q1 (15 of 20), and 10 get through Q2.
  const cutMargin = (part, q, through) => (part.length > through ? best(part[through], q) - best(part[through - 1], q) : null);
  const q1Through = d.result.length > 20 ? 16 : 15;

  const rc = d.raceControl ?? [];
  // Not every message says which part it's from, so go by time: a part starts
  // with its first message that does.
  const starts = [1, 2, 3].map((q) => Math.min(...rc.filter((m) => m.qualifying_phase === q).map((m) => Date.parse(m.date))));
  const phaseOf = (m) => {
    const t = Date.parse(m.date);
    return starts[2] <= t ? 3 : starts[1] <= t ? 2 : 1;
  };
  // One red flag can come with several messages, so flags within 3 minutes count once.
  const reds = rc.filter((m) => m.flag === 'RED').sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const redFlags = reds.filter((m, i) => !i || Date.parse(m.date) - Date.parse(reds[i - 1].date) > 180e3).map(phaseOf);
  const deleted = rc.filter((m) => /DELETED/i.test(m.message ?? '') && !/REINSTATED/i.test(m.message ?? ''));

  // Provisional pole in Q3: walk the laps in the order they were finished.
  const q3Start = Number.isFinite(starts[2]) ? starts[2] : null;
  const q3Drivers = new Set(q3.map((r) => r.driver_number));
  const finished = (l) => Date.parse(l.date_start) + l.lap_duration * 1000;
  const q3Laps = (d.laps ?? [])
    .filter((l) => l.date_start && typeof l.lap_duration === 'number' && q3Drivers.has(l.driver_number) && q3Start && Date.parse(l.date_start) >= q3Start)
    .sort((a, b) => finished(a) - finished(b));
  let holder = null, bestTime = Infinity;
  const poleChanges = [];
  for (const l of q3Laps) {
    if (l.lap_duration < bestTime) {
      if (holder !== null && holder !== l.driver_number) poleChanges.push(finished(l));
      holder = l.driver_number;
      bestTime = l.lap_duration;
    }
  }
  const q3End = q3Laps.length ? finished(q3Laps.at(-1)) : 0;

  const nameOf = (num) => {
    const full = d.drivers?.find((x) => x.driver_number === num)?.full_name;
    return full ? full.split(' ').map((w) => w[0] + w.slice(1).toLowerCase()).join(' ') : `Car ${num}`;
  };
  const top = d.result.filter((r) => r.position <= 3).sort((a, b) => a.position - b.position);
  const gapP2 = q3.length >= 2 ? best(q3[1], 2) - best(q3[0], 2) : null;
  const result = top.map((r) => `${r.position}. ${nameOf(r.driver_number)}`).join(', ')
    + (gapP2 != null ? ` (pole by ${gapP2.toFixed(3)} s)` : '');

  const sessionStart = Math.min(...(d.laps ?? []).filter((l) => l.date_start).map((l) => Date.parse(l.date_start)));
  return {
    result,
    poleGap: gapP2,
    top10Spread: q3.length >= 10 ? best(q3[9], 2) - best(q3[0], 2) : null,
    q1Cut: cutMargin(q1, 0, q1Through),
    q2Cut: cutMargin(q2, 1, 10),
    poleChanges: poleChanges.length,
    latePoleChanges: poleChanges.filter((t) => q3End - t <= 4 * 60e3).length,
    redFlags, // the part (1, 2 or 3) each red flag came in
    deletedLaps: [1, 2, 3].map((q) => deleted.filter((m) => phaseOf(m) === q).length),
    rain: (d.weather ?? []).some((w) => w.rainfall > 0 && Date.parse(w.date) >= sessionStart),
  };
}
