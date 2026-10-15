// Team strength ratings (Elo) for the "big match" line in the football score. Free, no key:
//   Club Elo        http://api.clubelo.com/YYYY-MM-DD   CSV: Rank,Club,Country,Level,Elo,From,To (HTTP only)
//   World Football Elo  https://www.eloratings.net/World.tsv (code -> rating) + en.teams.tsv (code -> names)
// Both are optional: when a site is down, the last good list (in state) or the committed seed
// in src/ratings/ is used. The ratings are never published; they only nudge the score.
//
// Clubs are rated half against their own league and half on the worldwide Elo scale (the
// owner's choice, `FOOTBALL.leagueLevel`): the strongest team in Eliteserien counts for more
// than a mid-table one, but a Premier League pair still outranks it. National teams use
// the world scale, so England–Spain is a bigger match than Malta–Andorra.

import { readFileSync } from 'node:fs';
import { getText } from '../http.mjs';
import { FOOTBALL } from '../competitions.mjs';
import { FOOTBALL as W } from '../scoring/weights.mjs';

const seed = (file) => JSON.parse(readFileSync(new URL(`../ratings/${file}`, import.meta.url), 'utf8'));
// Club Elo's API has been down (502, "site overloaded") since this was built. The seed is the
// ranking page clubelo.com/Ranking as web.archive.org saved it on 27 September 2026: every club
// from 1500 Elo up (736 clubs; the lower half of Eliteserien is under the cutoff, see `ppg`).
// It's only used until Club Elo answers again.
export const CLUB_SEED_DATE = '2026-09-27';
const CLUB_SEED = seed(`clubelo-${CLUB_SEED_DATE}.json`);
const NATION_SEED = seed('world-2026-10-09.json');

// ESPN's name -> the rating list's name, where a loose match isn't enough.
const CLUB_ALIASES = {
  'Manchester United': 'Man United', 'Manchester City': 'Man City', 'Nottingham Forest': 'Forest',
  'Tottenham Hotspur': 'Tottenham', 'Newcastle United': 'Newcastle', 'Leeds United': 'Leeds', 'Hull City': 'Hull',
  'Ipswich Town': 'Ipswich', 'Coventry City': 'Coventry', 'West Ham United': 'West Ham', 'Wolverhampton Wanderers': 'Wolves',
  'Leicester City': 'Leicester', 'Norwich City': 'Norwich', 'Sheffield United': 'Sheffield United',
  'Hamarkameratene': 'Ham-Kam', 'Bodo/Glimt': 'Bodoe Glimt', 'Bodø/Glimt': 'Bodoe Glimt',
  'Paris Saint-Germain': 'Paris SG', 'Atlético Madrid': 'Atlético', 'AS Roma': 'Roma', 'Bayern Munich': 'Bayern München',
  'PSV Eindhoven': 'PSV', 'Feyenoord Rotterdam': 'Feyenoord', 'Shakhtar Donetsk': 'Shakhtar', 'Sporting CP': 'Sporting',
  'Slavia Prague': 'Slavia Praha', 'Real Betis': 'Betis', 'Borussia Dortmund': 'Dortmund', 'AEK Athens': 'AEK',
  'Club Brugge': 'Brugge', 'Internazionale': 'Internazionale', 'LASK Linz': 'LASK', 'Bayer Leverkusen': 'Leverkusen',
  'Eintracht Frankfurt': 'Frankfurt', 'Borussia Mönchengladbach': 'Gladbach', 'Olympique de Marseille': 'Marseille',
  'Olympique Lyonnais': 'Lyon', 'AC Milan': 'Milan', 'Red Bull Salzburg': 'Salzburg', 'Sparta Prague': 'Sparta Praha',
  'Dinamo Zagreb': 'Dinamo Zagreb', 'Crvena Zvezda': 'Crvena Zvezda', 'FC Copenhagen': 'FC Kobenhavn',
  'Werder Bremen': 'Werder', 'SV Elversberg': 'Elversberg', 'FC Cologne': 'Köln', 'Hamburg SV': 'Hamburg', 'TSG Hoffenheim': 'Hoffenheim',
  'AS Monaco': 'Monaco', 'Stade Rennais': 'Rennes', 'AJ Auxerre': 'Auxerre',
  'Deportivo': 'Depor', 'Celta Vigo': 'Celta', 'Racing Santander': 'Santander',
  'Swansea City': 'Swansea', 'Birmingham City': 'Birmingham', 'Queens Park Rangers': 'QPR', 'West Bromwich Albion': 'West Brom',
  'Stoke City': 'Stoke', 'Blackburn Rovers': 'Blackburn', 'Charlton Athletic': 'Charlton', 'Bolton Wanderers': 'Bolton',
  'Cardiff City': 'Cardiff', 'Derby County': 'Derby', 'Preston North End': 'Preston',
  'Union St.-Gilloise': 'St Gillis', 'Olympiacos': 'Olympiakos', 'Omonia Nicosia': 'Omonia', "Hapoel Be'er": 'Beer-Sheva',
  "Hapoel Be'er Sheva": 'Beer-Sheva', 'Jagiellonia Bialystok': 'Jagiellonia', 'AZ Alkmaar': 'AZ', 'Levski Sofia': 'Levski',
  'NK Celje': 'Celje', 'Lech Poznan': 'Lech', 'NEC Nijmegen': 'Nijmegen', 'AGF': 'Aarhus', 'Ajax Amsterdam': 'Ajax',
  'F.C. København': 'FC Kobenhavn', 'KAA Gent': 'Gent', 'Hajduk Split': 'Hajduk', 'Heart of Midlothian': 'Hearts',
  'Mjällby AIF': 'Mjällby', 'Pafos': 'Paphos', 'Red Star Belgrade': 'Crvena Zvezda', 'Sint-Truidense': 'St Truiden', 'CSU Craiova': 'Craiova',
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
  if (list[name] != null) return list[name]; // the list spells it like ESPN after all
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
  // A newer seed than the saved ratings (and no fresh Club Elo list): take every club from the seed
  // once, or the saved fields would keep the older seed's numbers forever.
  const reseed = !clubs && r.clubSeed !== CLUB_SEED_DATE && !(r.clubsDate >= CLUB_SEED_DATE);
  for (const comp of FOOTBALL.filter((c) => c.teams === 'clubs')) {
    const tables = await tablesFor(comp.key);
    const teams = tables?.flatMap((t) => t.rows.map((row) => row.team)) ?? [];
    if (!teams.length) continue;
    const old = r.leagues[comp.key] ?? {};
    // Points per game from the table, to order the clubs Club Elo doesn't list (see strengthOf).
    (r.ppg ??= {})[comp.key] = Object.fromEntries(tables.flatMap((t) => t.rows.map((row) => [row.team, row.played > 0 ? row.points / row.played : 0])));
    if (!clubs && !reseed && teams.length === Object.keys(old).length && teams.every((t) => t in old)) continue;
    r.leagues[comp.key] = Object.fromEntries(teams.map((t) => [t, clubs ? clubElo(clubs, t) : reseed ? clubElo(CLUB_SEED, t) : (old[t] ?? clubElo(CLUB_SEED, t))]));
  }
  if (reseed) r.clubSeed = CLUB_SEED_DATE;
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
// National teams: the world scale, Elo 1400 (Kazakhstan, the Faroes) = 0 to 2100 (Spain,
// England, France) = 1. Clubs: a mix (`leagueLevel`, 0.5 = half and half) of the share of
// their league's field they out-rate, and the worldwide Club Elo scale, 1450 (the weakest
// clubs in the leagues followed) = 0 to 2050 (Bayern, Arsenal, Man City) = 1. A club Club Elo
// doesn't list (under the seed's 1500 cutoff, or just promoted) ranks below every listed club,
// and among the unlisted by points per game in the table (`ratings.ppg`).
const CUTOFF = 1500; // the seed (clubelo.com's ranking page) lists clubs from 1500 Elo up
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
  const ppg = ratings.ppg?.[compKey] ?? {};
  const floor = Math.min(...known, CUTOFF) - 4; // the unlisted sit under the listed, 0–3 points per game apart
  const rate = (t) => field[t] ?? floor + (ppg[t] ?? 0);
  const all = Object.keys(field).map(rate);
  const share = (t) => {
    const e = rate(t);
    return (all.filter((x) => x < e).length + (all.filter((x) => x === e).length - 1) / 2) / (all.length - 1);
  };
  const world = (t) => Math.min(1, Math.max(0, (rate(t) - 1450) / 600));
  const level = Math.min(1, Math.max(0, W.leagueLevel));
  const mix = (t) => (1 - level) * share(t) + level * world(t);
  return { home: mix(home), away: mix(away) };
}
