// Team strength ratings (Elo) for the "big match" line in the football score. Free, no key:
//   Club Elo        http://api.clubelo.com/YYYY-MM-DD   CSV: Rank,Club,Country,Level,Elo,From,To (HTTP only)
//   World Football Elo  https://www.eloratings.net/World.tsv (code -> rating) + en.teams.tsv (code -> names)
// Both are optional: when a site is down, the last good list (in state) or the committed seed
// in src/ratings/ is used. The ratings are never published; they only nudge the score.
//
// Clubs are rated against their own league (the owner's choice): the strongest team in
// Eliteserien counts as much as the strongest in the Premier League. National teams use
// the world scale, so England–Spain is a bigger match than Malta–Andorra.

import { readFileSync } from 'node:fs';
import { getText } from '../http.mjs';
import { FOOTBALL } from '../competitions.mjs';

const seed = (file) => JSON.parse(readFileSync(new URL(`../ratings/${file}`, import.meta.url), 'utf8'));
// Club Elo was down (502, "site overloaded") when this was built; the newest full copy was
// from 23 January 2025 (via web.archive.org). It's only used until Club Elo answers again.
const CLUB_SEED = seed('clubelo-2025-01-23.json');
const NATION_SEED = seed('world-2026-10-09.json');

// ESPN's name -> the rating list's name, where a loose match isn't enough.
const CLUB_ALIASES = {
  'Manchester United': 'Man United', 'Manchester City': 'Man City', 'Nottingham Forest': 'Forest',
  'Tottenham Hotspur': 'Tottenham', 'Newcastle United': 'Newcastle', 'Leeds United': 'Leeds', 'Hull City': 'Hull',
  'Ipswich Town': 'Ipswich', 'Coventry City': 'Coventry', 'West Ham United': 'West Ham', 'Wolverhampton Wanderers': 'Wolves',
  'Leicester City': 'Leicester', 'Norwich City': 'Norwich', 'Sheffield United': 'Sheffield United',
  'Hamarkameratene': 'Ham-Kam', 'Bodo/Glimt': 'Bodoe Glimt', 'Bodø/Glimt': 'Bodoe Glimt',
  'Paris Saint-Germain': 'Paris SG', 'Atlético Madrid': 'Atletico', 'AS Roma': 'Roma', 'Bayern Munich': 'Bayern',
  'PSV Eindhoven': 'PSV', 'Feyenoord Rotterdam': 'Feyenoord', 'Shakhtar Donetsk': 'Shakhtar', 'Sporting CP': 'Sporting',
  'Slavia Prague': 'Slavia Praha', 'Real Betis': 'Betis', 'Borussia Dortmund': 'Dortmund', 'AEK Athens': 'AEK',
  'Club Brugge': 'Brugge', 'Internazionale': 'Inter', 'LASK Linz': 'LASK', 'Bayer Leverkusen': 'Leverkusen',
  'Eintracht Frankfurt': 'Frankfurt', 'Borussia Mönchengladbach': 'Gladbach', 'Olympique de Marseille': 'Marseille',
  'Olympique Lyonnais': 'Lyon', 'AC Milan': 'Milan', 'Red Bull Salzburg': 'Salzburg', 'Sparta Prague': 'Sparta Praha',
  'Dinamo Zagreb': 'Dinamo Zagreb', 'Crvena Zvezda': 'Crvena Zvezda', 'FC Copenhagen': 'FC Kobenhavn',
};
const NATION_ALIASES = {
  'Bosnia-Herzegovina': 'Bosnia and Herzegovina', 'Republic of Ireland': 'Ireland', 'Türkiye': 'Turkey',
  'USA': 'United States', 'Korea Republic': 'South Korea', 'Côte d\'Ivoire': 'Ivory Coast', 'IR Iran': 'Iran',
};

// "Bodø/Glimt" and "Bodoe Glimt" both become "bodoeglimt"-ish keys: accents, club
// prefixes like FC/FK/SK and everything after "&" ("Brighton & Hove Albion") go.
export function normName(s) {
  return s.replace(/ø/gi, 'oe').replace(/æ/gi, 'ae').replace(/å/gi, 'a').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\b(fc|fk|sk|bk|afc|cf|ac|sc|vfb|rb|cp|ik)\b/g, '').replace(/&.*$/, '').replace(/[^a-z]/g, '');
}
// Club Elo writes ø both as "oe" (Bodoe) and as "o" (Tromso), so try both.
const looseKeys = (s) => [...new Set([normName(s), normName(s.replace(/ø/gi, 'o'))])];

function lookup(list, aliases, name) {
  const target = aliases[name] ?? name;
  if (list[target] != null) return list[target];
  const keys = looseKeys(target);
  for (const [k, v] of Object.entries(list)) if (looseKeys(k).some((x) => keys.includes(x))) return v;
  return null;
}
export const clubElo = (clubs, name) => lookup(clubs, CLUB_ALIASES, name);
export const nationElo = (nations, name) => lookup(nations, NATION_ALIASES, name);

// Club Elo's CSV -> { club: elo }.
export function parseClubElo(csv) {
  const out = {};
  for (const line of csv.trim().split('\n').slice(1)) {
    const c = line.split(',');
    if (c[1] && Number.isFinite(+c[4]) && +c[4] > 0) out[c[1]] = Math.round(+c[4]);
  }
  return out;
}

// eloratings.net: World.tsv (rank, rank, code, rating, …) and en.teams.tsv (code, name, other names…) -> { name: elo }.
export function parseWorldElo(worldTsv, teamsTsv) {
  const byCode = {};
  for (const line of worldTsv.trim().split('\n')) {
    const c = line.split('\t');
    if (c[2] && Number.isFinite(+c[3]) && +c[3] > 0) byCode[c[2]] = +c[3];
  }
  const out = {};
  for (const line of teamsTsv.trim().split('\n')) {
    const [code, ...names] = line.split('\t'); // the name, then other spellings ("USA", "Bosnia & Herzegovina")
    if (byCode[code]) for (const n of names) if (n.trim()) out[n.trim()] ??= byCode[code];
  }
  return out;
}

const day = (d) => d.toISOString().slice(0, 10);
// Elo ratings move slowly, so a weekly refresh is plenty.
const REFRESH_DAYS = 7;

// Brings state.ratings up to date: each source is fetched once a week (a failed source is
// tried again the next day, not at every build). `tablesFor(compKey)` gives the league tables, whose teams
// make up each league's field. Never throws: the old lists, then the seeds, stay in use.
//   state.ratings = { clubsDate, clubsTried, nationsDate, nationsTried, nations: { name: elo }, leagues: { 'nor.1': { 'SK Brann': 1496, … } } }
export async function updateRatings(state, now, tablesFor) {
  const r = (state.ratings ??= {});
  const today = day(now);
  // Due: never fetched, or the last good list is a week old, and not already tried today.
  const due = (src) => r[`${src}Tried`] !== today && (!r[`${src}Date`] || now - new Date(r[`${src}Date`]) >= REFRESH_DAYS * 864e5);
  let clubs = null;
  if (due('clubs')) {
    r.clubsTried = today;
    try {
      clubs = parseClubElo(await getText(`http://api.clubelo.com/${today}`, { retries: 1 }));
      if (Object.keys(clubs).length < 100) throw new Error('too few clubs');
      r.clubsDate = today;
    } catch (err) {
      console.log(`ratings: Club Elo unavailable (${err.message}); using the saved ratings`);
      clubs = null;
    }
  }
  if (due('nations')) {
    r.nationsTried = today;
    try {
      const [world, teams] = [await getText('https://www.eloratings.net/World.tsv', { retries: 1 }), await getText('https://www.eloratings.net/en.teams.tsv', { retries: 1 })];
      const nations = parseWorldElo(world, teams);
      if (Object.keys(nations).length < 100) throw new Error('too few teams');
      r.nations = nations;
      r.nationsDate = today;
    } catch (err) {
      console.log(`ratings: eloratings.net unavailable (${err.message}); using the saved ratings`);
    }
  }
  // Each club league's field, from its table (fetched for the stakes anyway). It follows the
  // table even while Club Elo is down, so promoted clubs join and relegated ones leave: clubs
  // already in the field keep their last good rating, newcomers get the seed's. A league whose
  // table failed keeps its old field.
  r.leagues ??= {};
  for (const comp of FOOTBALL.filter((c) => c.teams === 'clubs')) {
    const tables = await tablesFor(comp.key);
    const teams = tables?.flatMap((t) => t.rows.map((row) => row.team)) ?? [];
    if (!teams.length) continue;
    const old = r.leagues[comp.key] ?? {};
    if (!clubs && teams.length === Object.keys(old).length && teams.every((t) => t in old)) continue;
    r.leagues[comp.key] = Object.fromEntries(teams.map((t) => [t, clubs ? clubElo(clubs, t) : (old[t] ?? clubElo(CLUB_SEED, t))]));
  }
}

// The latest Elo of every football team in `events`, for the page's "Show Elo ratings"
// setting: { 'Bodø/Glimt': 1582, Spain: 2287 }. One number per team, the same on all its
// cards (the owner's choice), so comparing two cards never shows a change in between.
export function eloList(ratings, events) {
  const out = {};
  for (const e of events) {
    if (e.sport !== 'football') continue;
    const comp = FOOTBALL.find((c) => c.key === e.comp);
    for (const team of e.teams ?? []) {
      if (team in out) continue;
      const elo = comp?.teams === 'nations' ? nationElo(ratings?.nations ?? NATION_SEED, team) : ratings?.leagues?.[e.comp]?.[team];
      if (Number.isFinite(elo)) out[team] = Math.round(elo);
    }
  }
  return out;
}

// Each team's strength from 0 (weak) to 1 (strong), or null when it isn't known.
// Clubs: the share of their league's field they're stronger than (a club Club Elo doesn't
// list, usually just promoted, counts as the league's weakest). National teams: the world
// scale, Elo 1400 (Kazakhstan, the Faroes) = 0 to 2100 (Spain, England, France) = 1.
export function strengthOf(ratings, compKey, home, away) {
  const comp = FOOTBALL.find((c) => c.key === compKey);
  if (comp?.teams === 'nations') {
    const elo = [home, away].map((t) => nationElo(ratings?.nations ?? NATION_SEED, t));
    if (!elo.every(Number.isFinite)) return null;
    const q = (e) => Math.min(1, Math.max(0, (e - 1400) / 700));
    return { home: q(elo[0]), away: q(elo[1]) };
  }
  const field = ratings?.leagues?.[compKey];
  if (!field || !(home in field) || !(away in field)) return null;
  const known = Object.values(field).filter(Number.isFinite);
  if (known.length < 4) return null;
  const floor = Math.min(...known);
  const all = Object.values(field).map((e) => e ?? floor);
  const share = (t) => {
    const e = field[t] ?? floor;
    return (all.filter((x) => x < e).length + (all.filter((x) => x === e).length - 1) / 2) / (all.length - 1);
  };
  return { home: share(home), away: share(away) };
}
