// Biathlon from the IBU's public (unofficial) results API. No key needed.
//   Events?SeasonId=2526&Level=1   -> World Cup stops, World Championships, Olympics
//   Competitions?EventId=…         -> the races of one stop
//   Results?RaceId=…               -> the result, with misses per shooting
//   AnalyticResults?RaceId=…&TypeId=CRS1 / RNG1 … -> each lap's course time and each range time

import { getJson } from '../http.mjs';

const BASE = 'https://biathlonresults.com/modules/sportapi/api';
const get = (path) => getJson(`${BASE}/${path}`, { gapMs: 300 });

// A penalty loop takes about 25 seconds. Lap and range times leave it out.
const PENALTY_LOOP_S = 25;

// Race types. Individual and short individual use penalty minutes, not loops.
const FORMATS = {
  SP: { name: 'sprint', h2h: false },
  IN: { name: 'individual', h2h: false },
  SI: { name: 'short individual', h2h: false },
  PU: { name: 'pursuit', h2h: true },
  MS: { name: 'mass start', h2h: true },
  RL: { name: 'relay', h2h: true, relay: true },
  MX: { name: 'mixed relay', h2h: true, relay: true },
  SR: { name: 'single mixed relay', h2h: true, relay: true },
};
export const formatOf = (disciplineId) => FORMATS[disciplineId] ?? null;

// "2526" is the 2025/26 season. From July, the coming season is the current one.
export function seasonIds(now = new Date()) {
  const y = now.getUTCFullYear() % 100;
  const cur = now.getUTCMonth() >= 6 ? y : y - 1;
  const id = (a) => `${String(a).padStart(2, '0')}${String(a + 1).padStart(2, '0')}`;
  return [id(cur - 1), id(cur)];
}

const seriesOf = (description) => (/olympic/i.test(description) ? 'Olympics' : /world championships/i.test(description) ? 'World Championships' : 'World Cup');
const genderOf = (catId) => ({ SW: 'women', SM: 'men', MX: 'mixed' })[catId] ?? 'mixed';
const tidy = (s) => s.replace(/\s+/g, ' ').replace(/(\d)\s*km/gi, '$1 km').trim();

// All World Cup, World Championship and Olympic races of a season, oldest first.
export async function fetchRaces(seasonId, now = new Date()) {
  const races = [];
  for (const ev of await get(`Events?SeasonId=${seasonId}&Level=1`)) {
    for (const c of await get(`Competitions?EventId=${ev.EventId}`)) {
      const format = formatOf(c.DisciplineId ?? c.RaceId.slice(-2));
      if (!format) continue;
      const start = c.StartTime;
      const final = c.StatusText === 'Final' || c.StatusId === 11;
      races.push({
        raceId: c.RaceId,
        start,
        discipline: c.DisciplineId ?? c.RaceId.slice(-2),
        name: tidy(c.ShortDescription ?? c.Description ?? format.name),
        gender: genderOf(c.catId ?? c.RaceId.slice(-4, -2)),
        place: tidy(ev.ShortDescription ?? ''),
        country: ev.Nat ?? null,
        series: seriesOf(ev.Description ?? ''),
        finished: final,
        live: !final && Date.parse(start) <= now.getTime(),
      });
    }
  }
  return races.sort((a, b) => a.start.localeCompare(b.start));
}

// Everything the scorer needs. Returns null until the result is final.
export async function fetchRaceData(race) {
  const res = await get(`Results?RaceId=${race.raceId}`);
  if (!res?.IsResult || !res.Results?.length) return null;
  const format = formatOf(race.discipline);
  const data = { results: res.Results, laps: {} };
  if (format.h2h && !format.relay) {
    // Pursuit and mass start: lap and range times, to rebuild the order after each shooting.
    const stages = stagesOf(res.Results.find((r) => r.Shootings)?.Shootings);
    for (let i = 1; i <= stages + 1; i++) data.laps[`CRS${i}`] = (await get(`AnalyticResults?RaceId=${race.raceId}&TypeId=CRS${i}`)).Results ?? [];
    for (let i = 1; i <= stages; i++) data.laps[`RNG${i}`] = (await get(`AnalyticResults?RaceId=${race.raceId}&TypeId=RNG${i}`)).Results ?? [];
  }
  return data;
}

// "1:02:03.4", "25:31.8", "+12.6" -> seconds.
export function seconds(s) {
  if (s == null || s === '') return null;
  const parts = String(s).replace('+', '').split(':').map(Number);
  if (parts.some((p) => Number.isNaN(p))) return null;
  return parts.reduce((a, p) => a * 60 + p, 0);
}

// "0+1+0+2" (individual races) or "0+1 0+3" (relays: penalty loops + spare rounds per shooting).
const stagesOf = (shootings) => (shootings ? shootings.trim().split(/\s+|\+/).length / (/\s/.test(shootings.trim()) ? 2 : 1) : 0);
const missesOf = (shootings) => (shootings ?? '').trim().split('+').map(Number).filter((n) => !Number.isNaN(n));

const ordinalName = (r) => `${r.Name.split(' ').map((w, i) => (i === 0 && w === w.toUpperCase() ? w[0] + w.slice(1).toLowerCase() : w)).join(' ')} (${r.Nat})`;

// Turns the IBU data into the plain facts the scorer needs.
export function factsFromRace(race, d) {
  const format = formatOf(race.discipline);
  const finished = (r) => /^\d+$/.test(r.Rank ?? '') && seconds(r.TotalTime) != null;

  if (format.relay) return relayFacts(race, format, d, finished);

  const rows = d.results.filter((r) => !r.IsTeam && finished(r)).sort((a, b) => Number(a.Rank) - Number(b.Rank));
  const behind = (r) => seconds(r.Behind) ?? 0;
  const stages = missesOf(rows[0]?.Shootings).length;
  const top10 = rows.slice(0, 10);
  const missesByStage = Array.from({ length: stages }, (_, i) => top10.reduce((a, r) => a + (missesOf(r.Shootings)[i] ?? 0), 0));

  // Pursuit and mass start: who led after each shooting (lap + range times, plus penalty loops).
  const leaders = [];
  let winnerWorst = 1;
  if (format.h2h) {
    const lap = (k, r) => seconds(d.laps[k]?.find((x) => x.IBUId === r.IBUId)?.TotalTime);
    const startOffset = (r) => (race.discipline === 'PU' ? seconds(r.StartInfo) ?? 0 : 0);
    for (let s = 1; s <= stages; s++) {
      const times = rows.map((r) => {
        let t = startOffset(r);
        for (let i = 1; i <= s; i++) {
          const c = lap(`CRS${i}`, r), g = lap(`RNG${i}`, r);
          if (c == null || g == null) return null;
          t += c + g;
        }
        const misses = missesOf(r.Shootings).slice(0, s).reduce((a, m) => a + m, 0);
        return { r, t: t + misses * PENALTY_LOOP_S };
      }).filter((x) => x && x.t != null);
      if (!times.length) break;
      times.sort((a, b) => a.t - b.t);
      leaders.push(times[0].r.IBUId);
      const pos = times.findIndex((x) => x.r.IBUId === rows[0].IBUId) + 1;
      if (pos > winnerWorst) winnerWorst = pos;
    }
  }
  const winner = rows[0];
  const route = [...leaders, winner?.IBUId];
  const leadChanges = route.filter((id, i) => i && id !== route[i - 1]).length;

  return {
    format: race.discipline,
    h2h: format.h2h,
    relay: false,
    stages,
    gapP2: rows[1] ? behind(rows[1]) : null,
    gapP3: rows[2] ? behind(rows[2]) : null,
    within10: rows.filter((r) => behind(r) <= 10).length,
    within30: rows.filter((r) => behind(r) <= 30).length,
    missesByStage,
    leaders, // IBU ids, after each shooting (pursuit and mass start only)
    leadChanges,
    lastShootingLeaderWon: leaders.at(-1) ? leaders.at(-1) === winner?.IBUId : null,
    winnerStart: race.discipline === 'PU' ? Number(winner?.StartOrder) || null : null,
    winnerWorst,
    result: podiumText(rows),
  };
}

function relayFacts(race, format, d, finished) {
  const teams = d.results.filter((r) => r.IsTeam && finished(r)).sort((a, b) => Number(a.Rank) - Number(b.Rank));
  const legs = Math.max(0, ...d.results.filter((r) => !r.IsTeam).map((r) => Number(r.Leg) || 0));
  // Team order after each leg: the leg rows follow their team's row.
  const legRows = [];
  let team = null;
  for (const r of d.results) {
    if (r.IsTeam) { team = r; continue; }
    if (team) legRows.push({ team: team.Name, leg: Number(r.Leg), after: Number(r.TeamRankAfterLeg), behind: seconds(r.Behind) ?? 0, shootings: r.Shootings });
  }
  const leaderAfter = Array.from({ length: legs }, (_, i) => legRows.find((x) => x.leg === i + 1 && x.after === 1)?.team ?? null);
  const route = leaderAfter.filter(Boolean);
  const leadChanges = route.filter((t, i) => i && t !== route[i - 1]).length;
  // Penalty loops per leg for the top 5 teams ("0+1 0+3": loops+spares for prone, then standing).
  const top5 = new Set(teams.slice(0, 5).map((t) => t.Name));
  const loopsByLeg = Array.from({ length: legs }, (_, i) => legRows
    .filter((x) => x.leg === i + 1 && top5.has(x.team))
    .reduce((a, x) => a + (x.shootings ?? '').trim().split(/\s+/).reduce((b, p) => b + (Number(p.split('+')[0]) || 0), 0), 0));
  // How close the top 3 were at each handover.
  const closeAt = Array.from({ length: legs }, (_, i) => {
    const third = legRows.find((x) => x.leg === i + 1 && x.after === 3);
    return third ? third.behind : null;
  });
  const behind = (r) => seconds(r.Behind) ?? 0;
  return {
    format: race.discipline,
    h2h: true,
    relay: true,
    stages: legs,
    gapP2: teams[1] ? behind(teams[1]) : null,
    gapP3: teams[2] ? behind(teams[2]) : null,
    within10: teams.filter((r) => behind(r) <= 10).length,
    within30: teams.filter((r) => behind(r) <= 30).length,
    leaders: leaderAfter,
    leadChanges,
    lastShootingLeaderWon: leaderAfter.at(-2) ? leaderAfter.at(-2) === teams[0]?.Name : null, // leader at the last handover (null: unknown)
    loopsByLeg,
    closeAt,
    missesByStage: loopsByLeg,
    result: teams.slice(0, 3).map((t, i) => `${i + 1}. ${t.Name}${i ? ` +${behind(t).toFixed(1)} s` : ''}`).join(', '),
  };
}

function podiumText(rows) {
  return rows.slice(0, 3).map((r, i) => `${i + 1}. ${ordinalName(r)}${i ? ` +${(seconds(r.Behind) ?? 0).toFixed(1)} s` : ''} (${r.Shootings})`).join(', ');
}
