// The three winter sports behind one interface, so the build and the live check
// can treat them alike:
//   listRaces(now, state)  -> every World Cup / World Championship / Olympic race
//                             of this season and the last, as plain race objects
//   scoreRace(race)        -> the score, or null until the result is out

import * as ibu from './ibu.mjs';
import * as fis from './fis.mjs';
import { scoreBiathlon, scoreAlpine, scoreCrossCountry } from '../scoring/winter.mjs';

export const WINTER = {
  biathlon: { name: 'Biathlon', prefix: 'bt' },
  alpine: { name: 'Alpine', prefix: 'al', sector: 'AL' },
  'cross-country': { name: 'Cross-country', prefix: 'cc', sector: 'CC' },
};

const SERIES = { WC: 'World Cup', SWC: 'Tour de Ski', WSC: 'World Championships', OWG: 'Olympics' };
const genderWord = { women: "Women's", men: "Men's", mixed: 'Mixed' };
const tidy = (s) => s.replace(/(\d)\s*km/gi, '$1 km').replace(/\s+/g, ' ').trim();

// "Women's 7.5 km sprint", "Men's giant slalom", "Women's 20 km mass start free".
function raceName(gender, discipline) {
  const d = tidy(discipline).replace(/^(Women'?s?|Men'?s?)\s+/i, '');
  const lower = d.replace(/\b(Sprint|Pursuit|Mass Start|Individual|Short Individual|Relay|Mixed Relay|Single Mixed Relay|Slalom|Giant Slalom|Downhill|Super G|Interval Start|Skiathlon|Classic|Free)\b/g, (w) => w.toLowerCase())
    .replace(/super g/g, 'super-G');
  return /^mixed|relay/i.test(d) && gender === 'mixed' ? lower[0].toUpperCase() + lower.slice(1) : `${genderWord[gender]} ${lower}`;
}

// Parses FIS calendar dates like "25-26 Oct 2025", "29 Nov-01 Dec 2025" or "07 Feb 2027" -> [first, last] day.
export function calendarDays(text) {
  const m = text.match(/(\d{1,2})(?:\s+([A-Za-z]{3}))?(?:\s+(\d{4}))?\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  if (m) {
    const end = new Date(`${m[4]} ${m[5]} ${m[6]} UTC`);
    const start = new Date(`${m[1]} ${m[2] ?? m[5]} ${m[3] ?? m[6]} UTC`);
    if (start > end) start.setUTCFullYear(start.getUTCFullYear() - 1);
    return [start, end];
  }
  const one = text.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
  return one ? [new Date(`${one[0]} UTC`), new Date(`${one[0]} UTC`)] : [null, null];
}

// state.winterEventsDone: FIS events whose races are all finished and scored,
// so their pages aren't fetched again every run.
export async function listRaces(now, state, { aheadDays = 14, keepDays = 400 } = {}) {
  const races = [];

  for (const season of ibu.seasonIds(now)) {
    for (const r of await ibu.fetchRaces(season, now)) {
      races.push({
        id: `bt-${r.raceId}`, comp: 'biathlon', name: tidyBiathlon(r.name), place: r.place, country: r.country,
        series: r.series, gender: r.gender, start: r.start, finished: r.finished, live: r.live, ref: r,
      });
    }
  }

  state.winterEventsDone ??= [];
  const done = new Set(state.winterEventsDone);
  for (const [comp, { sector }] of Object.entries(WINTER).filter(([, w]) => w.sector)) {
    for (const season of fis.seasonCodes(now)) {
      for (const category of Object.keys(fis.CATEGORIES)) {
        for (const ev of await fis.fetchEvents(sector, season, category)) {
          if (done.has(`${sector}${ev.eventId}`)) continue;
          const [first, last] = calendarDays(ev.dates ?? '');
          if (first && first - now > aheadDays * 864e5) continue; // too far ahead to list yet
          if (last && now - last > keepDays * 864e5) continue; // too old to keep
          const list = (await fis.fetchRaces(sector, ev.eventId)).filter((race) => fis.scoredRace(sector, race) && race.start);
          for (const race of list) {
            const start = new Date(race.start).toISOString();
            // No official result two days after the start: cancelled (weather, usually) without being marked so.
            if (!race.official && now - Date.parse(start) > 2 * 864e5) continue;
            races.push({
              id: `${WINTER[comp].prefix}-${race.raceId}`, comp, name: raceName(race.gender, race.discipline),
              place: race.venue ?? ev.place, country: ev.country, series: SERIES[race.category] ?? 'World Cup',
              gender: race.gender, start, finished: race.official, live: !race.official && Date.parse(start) <= now.getTime(),
              ref: { sector, raceId: race.raceId, discipline: race.discipline },
            });
          }
          // An event that ended over two days ago with official results for every race (or over a week ago) won't change.
          if (last && ((now - last > 2 * 864e5 && list.every((r) => r.official)) || now - last > 7 * 864e5)) done.add(`${sector}${ev.eventId}`);
        }
      }
    }
  }
  state.winterEventsDone = [...done];
  return races;
}

// "Women 7.5 km Sprint" -> "Women's 7.5 km sprint"; relays keep their names.
function tidyBiathlon(name) {
  const g = /^women/i.test(name) ? 'women' : /^men/i.test(name) ? 'men' : 'mixed';
  return raceName(g, name);
}

export async function scoreRace(race) {
  if (race.comp === 'biathlon') {
    const data = await ibu.fetchRaceData(race.ref);
    return data ? scoreBiathlon(ibu.factsFromRace(race.ref, data)) : null;
  }
  const html = await fis.fetchResultPage(race.ref.sector, race.ref.raceId);
  const page = fis.resultFromPage(html);
  if (!page.rows.length) return null;
  return race.comp === 'alpine' ? scoreAlpine(fis.alpineFacts(page)) : scoreCrossCountry(fis.crossCountryFacts(page, race.ref.discipline));
}
