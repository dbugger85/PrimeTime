// Tennis Grand Slams from ESPN's public (unofficial) API. No key needed.
// During a Slam, the ATP scoreboard for any day of it returns the whole
// tournament (men's and women's draws), so one request per Slam is enough.

import { getJson } from '../http.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

// A day in the middle of each Slam's usual fortnight (month is 1-based), plus backups.
const SLAM_PROBES = [
  { name: 'Australian Open', days: [[1, 25], [1, 21], [1, 29]] },
  { name: 'Roland Garros', days: [[6, 1], [5, 28], [6, 5]] },
  { name: 'Wimbledon', days: [[7, 6], [7, 2], [7, 10]] },
  { name: 'US Open', days: [[9, 6], [9, 2], [8, 30]] },
];

const ymd = (y, m, d) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

// Returns the Slam tournaments of `year` that have started before `now`.
export async function fetchSlams(year, now = new Date(), skipIds = new Set()) {
  const found = [];
  for (const slam of SLAM_PROBES) {
    for (const [m, d] of slam.days) {
      if (new Date(Date.UTC(year, m - 1, d)) > now) break;
      const data = await getJson(`${BASE}?dates=${ymd(year, m, d)}`);
      const event = (data.events ?? []).find((e) => e.major);
      if (event) {
        if (!skipIds.has(event.id)) found.push(event);
        break;
      }
    }
  }
  return found;
}

// Flattens a Slam into finished main-draw singles matches.
export function matchesFromSlam(event) {
  const out = [];
  for (const g of event.groupings ?? []) {
    const slug = g.grouping?.slug ?? '';
    if (!/singles/.test(slug)) continue;
    const bestOf = slug.startsWith('mens') ? 5 : 3;
    for (const c of g.competitions ?? []) {
      const round = c.round?.displayName ?? '';
      if (/qualifying/i.test(round) || !c.status?.type?.completed) continue;
      const [a, b] = c.competitors ?? [];
      if (!a?.linescores?.length || !b?.linescores?.length) continue; // walkover
      out.push({
        espnId: c.id,
        tournament: event.name,
        draw: g.grouping.displayName,
        round,
        start: c.date,
        players: [a.athlete?.displayName ?? '?', b.athlete?.displayName ?? '?'],
        bestOf,
        retired: c.status.type.name === 'STATUS_RETIRED',
        winnerIndex: b.winner ? 1 : 0,
        sets: a.linescores.map((s, i) => ({
          games: [s.value, b.linescores[i]?.value ?? 0],
          tiebreak: s.tiebreak != null || b.linescores[i]?.tiebreak != null,
        })),
      });
    }
  }
  return out;
}
