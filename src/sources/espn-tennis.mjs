// Tennis from ESPN's public (unofficial) API. No key needed: the Grand Slams
// (men's and women's singles), the nine ATP Masters 1000 events and the ATP Finals.
// The ATP scoreboard for any day of a tournament returns the whole tournament,
// so one request per tournament is enough.

import { getJson } from '../http.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/tennis/atp/scoreboard';

// Days to try for each Slam (month is 1-based): the middle of its usual fortnight first,
// then earlier days down to its usual first day, so it's found from day one. `id` is
// ESPN's tournament id: a Slam that's done (state.slamsDone has "<id>-<year>") isn't
// downloaded again, which saves about 2 MB per Slam per build.
const SLAM_PROBES = [
  { id: '154', name: 'Australian Open', days: [[1, 25], [1, 21], [1, 18], [1, 29]] },
  { id: '172', name: 'Roland Garros', days: [[6, 1], [5, 28], [5, 24], [6, 5]] },
  { id: '188', name: 'Wimbledon', days: [[7, 6], [7, 2], [6, 29], [7, 10]] },
  { id: '189', name: 'US Open', days: [[9, 6], [9, 2], [8, 30], [8, 31]] },
];

// ATP Masters 1000 and the ATP Finals (owner's choice, 2026-10-31; WTA not wanted for now).
// Their dates move by a week or two between years, so each has a few probe days across
// its usual window. `name` replaces ESPN's sponsor names ("Rolex Paris Masters").
const ATP_PROBES = [
  { id: '411', name: 'Indian Wells', days: [[3, 12], [3, 8], [3, 15], [3, 5]] },
  { id: '713', name: 'Miami Open', days: [[3, 25], [3, 21], [3, 28], [3, 19]] },
  { id: '42', name: 'Monte-Carlo Masters', days: [[4, 9], [4, 6], [4, 12], [4, 15]] },
  { id: '413', name: 'Madrid Open', days: [[4, 28], [4, 25], [5, 1], [4, 22]] },
  { id: '414', name: 'Italian Open', days: [[5, 12], [5, 9], [5, 15], [5, 6]] },
  { id: '421', name: 'Canadian Open', days: [[8, 5], [8, 1], [8, 9], [7, 29]] },
  { id: '718', name: 'Cincinnati Open', days: [[8, 15], [8, 12], [8, 18], [8, 8]] },
  { id: '315', name: 'Shanghai Masters', days: [[10, 9], [10, 5], [10, 1], [10, 13]] },
  { id: '13', name: 'Paris Masters', days: [[11, 2], [10, 30], [10, 27], [11, 5]] },
  { id: '339', name: 'ATP Finals', days: [[11, 15], [11, 12], [11, 18], [11, 9]] },
];
const ATP_NAMES = Object.fromEntries(ATP_PROBES.map((t) => [t.id, t.name]));
const idOf = (event) => String(event?.id ?? '').split('-')[0];
const ours = (e) => e.major || idOf(e) in ATP_NAMES;
// Singles draws we show: both at the Slams, only the men's at ATP events (some are joint with the WTA).
const shown = (event, slug) => /singles/.test(slug) && (event.major || slug.startsWith('mens'));

// 'tennis.slam' or 'tennis.atp' (the comp field and the rights key), and the name to show.
export const compOf = (event) => (event.major ? 'tennis.slam' : 'tennis.atp');
export const nameOf = (event) => (event.major ? event.name : ATP_NAMES[idOf(event)] ?? event.name);

const ymd = (y, m, d) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`;

// Returns the tournaments of `year` (Slams, then ATP) that have started before `now`.
// A day's answer can hold several of ours, so each answer is remembered for the run.
export async function fetchSlams(year, now = new Date(), skipIds = new Set()) {
  const found = [];
  const days = new Map();
  const day = async (key) => { if (!days.has(key)) days.set(key, (await getJson(`${BASE}?dates=${key}`)).events ?? []); return days.get(key); };
  for (const t of [...SLAM_PROBES.map((s) => ({ ...s, major: true })), ...ATP_PROBES]) {
    if (skipIds.has(`${t.id}-${year}`)) continue;
    // Today first (in the current year), so a tournament shows from its first day.
    const today = now.getUTCFullYear() === year ? [[now.getUTCMonth() + 1, now.getUTCDate()]] : [];
    for (const [m, d] of [...today, ...t.days]) {
      if (new Date(Date.UTC(year, m - 1, d)) > now) continue; // not that far yet: try an earlier day
      const event = (await day(ymd(year, m, d))).find((e) => (t.major ? e.major : e.id === `${t.id}-${year}`));
      if (event) {
        if (!skipIds.has(event.id) && !found.includes(event)) found.push(event);
        break;
      }
    }
  }
  return found;
}

// Our tournaments being played on a given day (YYYYMMDD).
export async function fetchSlamsOn(yyyymmdd) {
  const data = await getJson(`${BASE}?dates=${yyyymmdd}`);
  return (data.events ?? []).filter(ours);
}

// Main-draw singles matches of a Slam that haven't finished yet (both players known).
export function upcomingFromSlam(event) {
  const out = [];
  for (const g of event.groupings ?? []) {
    if (!shown(event, g.grouping?.slug ?? '')) continue;
    for (const c of g.competitions ?? []) {
      const round = c.round?.displayName ?? '';
      const state = c.status?.type?.state;
      if (/qualifying/i.test(round) || (state !== 'pre' && state !== 'in')) continue;
      const names = (c.competitors ?? []).map((x) => x.athlete?.displayName).filter(Boolean);
      if (names.length !== 2) continue;
      out.push({ espnId: c.id, comp: compOf(event), tournament: nameOf(event), draw: g.grouping.displayName, round, start: c.date, players: names, live: state === 'in' });
    }
  }
  return out;
}

// Flattens a Slam into finished main-draw singles matches.
export function matchesFromSlam(event) {
  const out = [];
  for (const g of event.groupings ?? []) {
    const slug = g.grouping?.slug ?? '';
    if (!shown(event, slug)) continue;
    const bestOf = event.major && slug.startsWith('mens') ? 5 : 3; // Masters and the ATP Finals: best of three
    for (const c of g.competitions ?? []) {
      const round = c.round?.displayName ?? '';
      if (/qualifying/i.test(round) || !c.status?.type?.completed) continue;
      const [a, b] = c.competitors ?? [];
      if (!a?.linescores?.length || !b?.linescores?.length) continue; // walkover
      out.push({
        espnId: c.id,
        comp: compOf(event),
        tournament: nameOf(event),
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
          tbPoints: [s.tiebreak, b.linescores[i]?.tiebreak],
        })),
      });
    }
  }
  return out;
}
