// Biathlon results from IBU's official result sheets: the PDF files IBU publishes
// for every race at ibu.blob.core.windows.net (the same files Wikipedia links to
// as its sources). No key, no login, no robots.txt rules. IBU's JSON API at
// biathlonresults.com answers 401 since 2026-11-09 and is not used any more.
//
//   docs/2526/BT/SWRL/CP03/SWMS/C73E_v1.pdf   the result: bib, misses per shooting, time, behind
//   docs/2526/BT/SWRL/CP03/SWMS/C77D_v1.pdf   "Competition analysis" (pursuit, mass start): each
//                                             athlete's place after every loop, so after every shooting
//
// 2526 is the season; CP03 the third World Cup stage (CH__ World Championships, OG__ Olympics);
// SW/SM/MX women/men/mixed; SP/PU/MS/IN/SI/RL/SR the race type. A corrected sheet gets a new
// version (_v2); a few were first published as _v0. Which races exist, and when, comes from
// Wikipedia (src/sources/biathlon-calendar.mjs).

import { getBytes } from '../http.mjs';
import { pdfRows } from '../pdf.mjs';

const BASE = 'https://ibu.blob.core.windows.net/docs';
const VERSIONS = [1, 2, 0];

// Race types. Head-to-head races are pursuit, mass start and relays.
const FORMATS = {
  SP: { name: 'sprint', h2h: false, sheet: 'C73B' },
  IN: { name: 'individual', h2h: false, sheet: 'C73A' },
  SI: { name: 'short individual', h2h: false, sheet: 'C73A' },
  PU: { name: 'pursuit', h2h: true, sheet: 'C73D', analysis: 'C77D' },
  MS: { name: 'mass start', h2h: true, sheet: 'C73E', analysis: 'C77D' },
  RL: { name: 'relay', h2h: true, relay: true, sheet: 'C73C' },
  SR: { name: 'single mixed relay', h2h: true, relay: true, sheet: 'C73C' },
};
export const formatOf = (discipline) => FORMATS[discipline] ?? null;

// IBU's race id, the same as the old API used ("BT2526SWRLCP03SWMS"), so ids stay the same.
export const raceIdOf = (season, code, cat, disc) => `BT${season}SWRL${code}${cat}${disc}`;
export const sheetUrl = (raceId, sheet, version) => `${BASE}/${raceId.slice(2, 6)}/BT/SWRL/${raceId.slice(10, 14)}/${raceId.slice(14)}/${sheet}_v${version}.pdf`;

// The first sheet found of _v1, _v2 and _v0, or null while there's none. Sheets found are
// kept for the rest of the run (listing a stage from its sheets, then scoring, reads each once).
const found = new Map();
async function fetchSheet(raceId, sheet) {
  const key = `${raceId}/${sheet}`;
  if (found.has(key)) return found.get(key);
  for (const v of VERSIONS) {
    const bytes = await getBytes(sheetUrl(raceId, sheet, v), { gapMs: 1000, missingOk: true });
    if (bytes) {
      const out = { url: sheetUrl(raceId, sheet, v), rows: pdfRows(bytes) };
      found.set(key, out);
      return out;
    }
  }
  return null;
}

// For a stage Wikipedia has no schedule for: does this race have a result sheet? Its title
// ("WOMEN 12.5km MASS START") and local start, or null.
export async function findRace(raceId, discipline) {
  const sheet = await fetchSheet(raceId, formatOf(discipline).sheet);
  if (!sheet) return null;
  const start = sheetStart(sheet.rows);
  const title = sheet.rows.find((r) => /\b(SPRINT|PURSUIT|MASS START|INDIVIDUAL|RELAY)\b/.test(r.join(' ')))?.join(' ');
  return start ? { start, title } : null;
}

// Everything the scorer needs, or null while the result sheet isn't out.
export async function fetchRaceData(race) {
  const format = formatOf(race.discipline);
  const result = await fetchSheet(race.raceId, format.sheet);
  if (!result || !resultRows(result.rows).length && !relayTeams(result.rows).length) return null;
  const analysis = format.analysis ? await fetchSheet(race.raceId, format.analysis) : null;
  return { result: result.rows, analysis: analysis?.rows ?? null, urls: [result.url, analysis?.url].filter(Boolean) };
}

// "1:02:03.4", "25:31.8", "+12.6" -> seconds.
export function seconds(s) {
  if (s == null || s === '') return null;
  const t = String(s).replace('+', '').trim();
  if (!/^\d+(:\d{1,2})*(\.\d+)?$/.test(t)) return null;
  return t.split(':').map(Number).reduce((a, p) => a * 60 + p, 0);
}

const isTime = (s) => /^\d{1,2}(:\d{2}){1,2}\.\d$/.test(s ?? ''); // 32:53.2, 1:07:06.2
const isGap = (s) => /^\+\d/.test(s ?? '') || s === '0.0';
const rankOf = (s) => (/^=?\d+$/.test(s ?? '') ? Number(String(s).replace('=', '')) : null);

// When the race started, from the sheet's header ("SUN 21 DEC 2025 \ START TIME: 12:15"), local time.
export function sheetStart(rows) {
  for (const r of rows) {
    const m = /(\d{1,2}) ([A-Z]{3}) (\d{4}).*START TIME: (\d{1,2}):(\d{2})/.exec(r.join(' '));
    if (m) return { day: Number(m[1]), month: 'JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC'.indexOf(m[2]) / 3, year: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) };
  }
  return null;
}

// Individual results (sprint, individual, pursuit, mass start), in finishing order:
// [{ rank, bib, name, nat, misses: [per shooting], startBehind (pursuit), behind }].
// A row: rank, bib, name, nation, (pursuit: start behind), misses per shooting, total misses,
// the time or "+gap", then points and the like. Athletes who didn't finish have no rank.
export function resultRows(rows) {
  const out = [];
  for (const r of rows) {
    const rank = rankOf(r[0]);
    if (rank == null || !/^\d+$/.test(r[1] ?? '') || !/^[A-Z]{3}$/.test(r[3] ?? '')) continue;
    let k = 4;
    const startBehind = /^\d+:\d{2}$/.test(r[k] ?? '') ? seconds(r[k++]) : null;
    const counts = [];
    while (k < r.length && /^\d{1,2}$/.test(r[k])) counts.push(Number(r[k++]));
    const total = counts.pop();
    const misses = counts.reduce((a, m) => a + m, 0) === total ? counts : [];
    const timeAt = r.findIndex((c, i) => i >= k && (isTime(c) || isGap(c)));
    if (timeAt < 0) continue; // lapped or no time
    const gapAt = r.findIndex((c, i) => i >= timeAt && isGap(c));
    out.push({ rank, bib: Number(r[1]), name: r[2], nat: r[3], misses, startBehind, behind: gapAt >= 0 ? seconds(r[gapAt]) : rank === 1 ? 0 : null });
  }
  return out.filter((x) => x.behind != null);
}

// Relays: [{ rank, bib, nat, name, behind, legs: [{ leg, after, behind, loops }] }].
// Team row: rank, bib, NOR, -, NORWAY, misses ("0+9"), time, behind, points. Leg rows under it:
// "3 - 1", colour, name, (single mixed relay: gender, rank), prone "0+0", standing "0+2", total,
// leg time, leg rank, team time, team rank after the leg, team behind after the leg.
export function relayTeams(rows) {
  const teams = [];
  let team = null;
  for (const r of rows) {
    if (/^\d+\s*-\s*\d+$/.test(r[0] ?? '') && team) {
      const shots = r.filter((c) => /^\d\+\d$/.test(c));
      const n = r.length;
      team.legs.push({
        leg: team.legs.length + 1, // the single mixed relay lists "2-1, 2-2, 2-1, 2-2": count the rows
        after: rankOf(r[n - 2]),
        behind: seconds(r[n - 1]),
        loops: shots.slice(0, 2).reduce((a, s) => a + Number(s.split('+')[0]), 0),
      });
      continue;
    }
    const rank = rankOf(r[0]);
    if (rank != null && /^\d+$/.test(r[1] ?? '') && /^[A-Z]{3}$/.test(r[2] ?? '') && r[3] === '-') {
      const timeAt = r.findIndex(isTime);
      team = { rank, bib: Number(r[1]), nat: r[2], name: r[4], behind: timeAt >= 0 ? seconds(r[timeAt + 1]) ?? (rank === 1 ? 0 : null) : null, legs: [] };
      if (timeAt >= 0) teams.push(team);
      continue;
    }
  }
  return teams.filter((t) => t.behind != null);
}

// The competition analysis: bib -> place after each loop (the last loop is the finish).
// Each athlete has a row "rank, bib, name, nation, …" followed by
// "Cumulative Tim | 7:21.1 +30.0 23 | 14:09.4 +33.1 18 | …" (time, behind, place per loop).
export function analysisPlaces(rows) {
  const places = new Map();
  let bib = null;
  for (const r of rows) {
    if (rankOf(r[0]) != null && /^\d+$/.test(r[1] ?? '') && /^[A-Z]{3}$/.test(r[3] ?? '')) { bib = Number(r[1]); continue; }
    if (bib == null || !/^Cumulative/i.test(r[0] ?? '')) continue;
    const cells = r.slice(1);
    const list = [];
    for (let k = 0; k + 2 < cells.length && isTime(cells[k]); k += 3) list.push(rankOf(cells[k + 2]));
    places.set(bib, list);
    bib = null;
  }
  return places;
}

// Turns the result sheets into the plain facts the scorer needs.
export function factsFromRace(race, d) {
  const format = formatOf(race.discipline);
  if (format.relay) return relayFacts(race, d);

  const rows = resultRows(d.result).sort((a, b) => a.rank - b.rank);
  const stages = Math.max(0, ...rows.slice(0, 10).map((r) => r.misses.length));
  const top10 = rows.slice(0, 10);
  const missesByStage = Array.from({ length: stages }, (_, i) => top10.reduce((a, r) => a + (r.misses[i] ?? 0), 0));
  const winner = rows[0];

  // Pursuit and mass start: who led after each shooting, from the competition analysis.
  // Without it (not published yet, or not understood) the race is scored on the finish alone.
  const leaders = [];
  let winnerWorst = null;
  if (format.h2h && d.analysis) {
    const places = analysisPlaces(d.analysis);
    for (let s = 0; s < stages; s++) {
      const first = [...places].find(([, p]) => p[s] === 1)?.[0];
      if (first == null) { leaders.length = 0; break; }
      leaders.push(first);
    }
    const mine = places.get(winner?.bib);
    if (leaders.length && mine) winnerWorst = Math.max(...mine.slice(0, stages).filter(Number.isInteger));
  }
  const route = leaders.length ? [...leaders, winner?.bib] : [];
  const leadChanges = route.filter((id, i) => i && id !== route[i - 1]).length;

  return {
    format: race.discipline,
    h2h: format.h2h,
    relay: false,
    stages,
    gapP2: rows[1]?.behind ?? null,
    gapP3: rows[2]?.behind ?? null,
    within10: rows.filter((r) => r.behind <= 10).length,
    within30: rows.filter((r) => r.behind <= 30).length,
    topBibs: rows.slice(0, 3).map((r) => r.bib).filter(Number.isInteger), // sprint and individual go in bib order
    missesByStage,
    leaders, // bibs, after each shooting (pursuit and mass start, when the analysis is out)
    leadChanges,
    lastShootingLeaderWon: leaders.length ? leaders.at(-1) === winner?.bib : null,
    winnerStart: race.discipline === 'PU' ? winner?.bib ?? null : null, // pursuit bibs are the start order
    winnerWorst: winnerWorst ?? 1,
    result: rows.slice(0, 3).map((r, i) => `${i + 1}. ${displayName(r.name)} (${r.nat})${i ? ` +${r.behind.toFixed(1)} s` : ''} (${r.misses.join('+')})`).join(', '),
  };
}

function relayFacts(race, d) {
  const teams = relayTeams(d.result).sort((a, b) => a.rank - b.rank);
  const legs = Math.max(0, ...teams.map((t) => t.legs.length));
  const leaderAfter = Array.from({ length: legs }, (_, i) => teams.find((t) => t.legs[i]?.after === 1)?.nat ?? null);
  const route = leaderAfter.filter(Boolean);
  const leadChanges = route.filter((t, i) => i && t !== route[i - 1]).length;
  // Penalty loops per leg for the top 5 teams.
  const loopsByLeg = Array.from({ length: legs }, (_, i) => teams.slice(0, 5).reduce((a, t) => a + (t.legs[i]?.loops ?? 0), 0));
  // How close the top 3 were at each handover.
  const closeAt = Array.from({ length: legs }, (_, i) => teams.flatMap((t) => (t.legs[i]?.after === 3 ? [t.legs[i].behind] : []))[0] ?? null);
  return {
    format: race.discipline,
    h2h: true,
    relay: true,
    stages: legs,
    gapP2: teams[1]?.behind ?? null,
    gapP3: teams[2]?.behind ?? null,
    within10: teams.filter((t) => t.behind <= 10).length,
    within30: teams.filter((t) => t.behind <= 30).length,
    leaders: leaderAfter,
    leadChanges,
    lastShootingLeaderWon: leaderAfter.at(-2) ? leaderAfter.at(-2) === teams[0]?.nat : null, // leader at the last handover (null: unknown)
    loopsByLeg,
    closeAt,
    missesByStage: loopsByLeg,
    result: teams.slice(0, 3).map((t, i) => `${i + 1}. ${titleCase(t.name)}${i ? ` +${t.behind.toFixed(1)} s` : ''}`).join(', '),
  };
}

// "OEBERG Hanna" -> "Oeberg Hanna"; "NORWAY" -> "Norway". Only for the result spoiler.
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])\p{L}/gu, (c) => c.toUpperCase());
const displayName = (name) => name.split(' ').map((w) => (w === w.toUpperCase() ? titleCase(w) : w)).join(' ');
