// Expected goals (xG) and team stats from FotMob's public (unofficial) web API. No key needed.
//   matches?date=YYYYMMDD     -> every match of a day, all competitions (to find FotMob's id)
//   matchDetails?matchId=ID   -> the shot map (every shot with its minute and its xG) and the
//                                match stats (touches in the box, big chances, xG on target)
// This is an OPTIONAL extra: FotMob doesn't like scrapers and could block us any day.
// Every function here returns null instead of failing, and the football score then
// falls back to shot counts and marks the card "limited info".

import { getJson } from '../http.mjs';
import { teamSlug } from '../../docs/logic.js';

const BASE = 'https://www.fotmob.com/api/data';
const get = (path) => getJson(`${BASE}/${path}`, { gapMs: 1000, retries: 2 }); // gently: one request a second

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');

// Each day's list is fetched once per run.
const dayCache = new Map();
function fetchDay(yyyymmdd) {
  if (!dayCache.has(yyyymmdd)) {
    dayCache.set(yyyymmdd, get(`matches?date=${yyyymmdd}`).then(
      (d) => (d.leagues ?? []).flatMap((l) => l.matches ?? []),
      () => null, // FotMob down or blocking: no xG this run
    ));
  }
  return dayCache.get(yyyymmdd);
}

// Team names differ between ESPN and FotMob ("SK Brann" / "Brann", "Bodo/Glimt" / "Bodø/Glimt",
// "Republic of Ireland" / "Ireland", "Internazionale" / "Inter"). Two names are the same team when
// every distinctive word of the shorter one is in the other (a word may be a short form of one
// there: "inter" / "internazionale"). "Manchester City" and "Manchester United" stay different.
const FILLER = new Set(['fk', 'fc', 'sk', 'ik', 'bk', 'if', 'afc', 'cf', 'ac', 'sc', 'cd', 'club', 'de', 'of', 'the', 'and', 'republic']);
const words = (name) => teamSlug(name).split('-').filter((w) => w.length >= 3 && !FILLER.has(w));
const sameWord = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
export function sameTeam(a, b) {
  if (teamSlug(a) === teamSlug(b)) return true;
  const [short, long] = [words(a), words(b)].sort((x, y) => x.length - y.length);
  return short.length > 0 && short.every((w) => long.some((v) => sameWord(w, v)));
}

// FotMob's id for an ESPN match ({ home, away, start }), or null. Looks at kick-offs within
// 20 minutes and needs at least one team to match; tries the UTC day, then the day either side.
export async function findMatchId(match) {
  const start = Date.parse(match.start);
  for (const day of [ymd(start), ymd(start - 864e5), ymd(start + 864e5)]) {
    const list = await fetchDay(day);
    if (!list) return null;
    const hits = list.filter((m) => Math.abs(Date.parse(m.status?.utcTime) - start) <= 20 * 60e3
      && (sameTeam(m.home?.name ?? '', match.home) || sameTeam(m.away?.name ?? '', match.away)));
    if (hits.length === 1) return hits[0].id;
    if (hits.length > 1) return hits.find((m) => sameTeam(m.home.name, match.home) && sameTeam(m.away.name, match.away))?.id ?? null;
  }
  return null;
}

// Match minute with stoppage time kept inside its own half, like ESPN's minuteOf (45+3' -> 44.9).
const PERIODS = { FirstHalf: [0, 45], SecondHalf: [45, 90], FirstHalfExtra: [90, 105], SecondHalfExtra: [105, 120] };
const minuteOf = (s) => {
  const [lo, hi] = PERIODS[s.period] ?? [0, 120];
  return Math.min(Math.max(s.min ?? 0, lo), hi - 0.1);
};

// Turns a matchDetails answer into xG facts, or null when there's no shot map with xG.
//   { home: 1.45, away: 0.75, shots: [{ min, side, xg }], bangers: [min], bigMisses: [min] }
// (penalty shootouts left out). `bangers`: goals from outside the box, or unlikely chances struck so
// well they went in (xG 0.05 or less, xG on target 0.6 or more). `bigMisses`: big chances (xG 0.3 or
// more, not penalties) that weren't scored. Minutes only, for the "late drama" and "great goals" lines.
export function xgFromDetails(details) {
  const shots = details?.content?.shotmap?.shots;
  const homeId = details?.general?.homeTeam?.id;
  if (!Array.isArray(shots) || !shots.length || homeId == null) return null;
  // Own goals and the odd other shot have no xG: skip one or two, but not a shot map without xG.
  const missing = shots.filter((s) => !Number.isFinite(s.expectedGoals)).length;
  if (missing > 2 || missing === shots.length) return null;
  const inPlay = shots.filter((s) => Number.isFinite(s.expectedGoals) && !/shootout|penalt/i.test(s.period ?? ''));
  const out = { home: 0, away: 0, shots: [], bangers: [], bigMisses: [] };
  for (const s of inPlay) {
    const side = s.teamId === homeId ? 'home' : 'away';
    out[side] += s.expectedGoals;
    out.shots.push({ min: minuteOf(s), side, xg: s.expectedGoals });
    const goal = s.eventType === 'Goal' && !s.isOwnGoal;
    const pen = /penalty/i.test(s.situation ?? '');
    if (goal && !pen && (s.isFromInsideBox === false || (s.expectedGoals <= 0.05 && s.expectedGoalsOnTarget >= 0.6))) out.bangers.push(minuteOf(s));
    if (!goal && !pen && s.expectedGoals >= 0.3) out.bigMisses.push(minuteOf(s));
  }
  out.home = Math.round(out.home * 100) / 100;
  out.away = Math.round(out.away * 100) / 100;
  return out;
}

// The team stats from a matchDetails answer (content.stats.Periods.All.stats: groups of
// { key, title, stats: [home, away] }), or null when there are none. Totals for the whole match,
// no minutes, so they only affect the score, not the strip or the skip tips. Each one is null when
// FotMob doesn't show it for that match. "Big chances" already includes the ones missed.
//   { touchesInBox: { home: 37, away: 32 }, bigChances: { home: 3, away: 3 }, xgot: { home: 2.47, away: 0.59 } }
const KEYS = { touchesInBox: 'touches_opp_box', bigChances: 'big_chance', xgot: 'expected_goals_on_target' };
export function statsFromDetails(details) {
  const groups = details?.content?.stats?.Periods?.All?.stats;
  if (!Array.isArray(groups)) return null;
  const num = (v) => (typeof v === 'string' ? Number(v.replace(/\s.*$/, '')) : Number(v)); // "183 (70%)" -> 183
  const pair = (key) => {
    for (const g of groups) {
      for (const s of g.stats ?? []) {
        if (s.key !== key || !Array.isArray(s.stats) || s.stats.length !== 2) continue;
        const [home, away] = s.stats.map(num);
        return Number.isFinite(home) && Number.isFinite(away) ? { home, away } : null;
      }
    }
    return null;
  };
  const out = Object.fromEntries(Object.entries(KEYS).map(([name, key]) => [name, pair(key)]));
  return Object.values(out).some(Boolean) ? out : null;
}

// xG and team stats for a finished ESPN match: { xg, stats }, each null when FotMob doesn't have it,
// or null as a whole (not found, FotMob down or blocking).
export async function fotmobFor(match) {
  try {
    const id = await findMatchId(match);
    if (!id) return null;
    const details = await get(`matchDetails?matchId=${id}`);
    if (!details?.general?.finished) return null;
    const xg = xgFromDetails(details);
    const stats = statsFromDetails(details);
    // At a neutral ground the two sources can disagree about who's "home": follow ESPN.
    const fmHome = details.general.homeTeam?.name ?? '';
    if (sameTeam(fmHome, match.away) && !sameTeam(fmHome, match.home)) {
      if (xg) {
        [xg.home, xg.away] = [xg.away, xg.home];
        for (const s of xg.shots) s.side = s.side === 'home' ? 'away' : 'home';
      }
      for (const k of Object.keys(stats ?? {})) if (stats[k]) stats[k] = { home: stats[k].away, away: stats[k].home };
    }
    return { xg, stats };
  } catch {
    return null;
  }
}

// xG facts alone, or null (kept for callers that only want the shot map).
export const xgFor = async (match) => (await fotmobFor(match))?.xg ?? null;
