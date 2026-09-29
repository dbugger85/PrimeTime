// Alpine and cross-country skiing from the fis-ski.com results pages. FIS has
// no public API, so this reads the web pages; if FIS redesigns its site, the
// parsing here is what needs fixing (the tests use saved pages).
//   calendar-results.html?sectorcode=AL&seasoncode=2026&categorycode=WC -> events of a season
//   event-details.html?sectorcode=AL&eventid=…                           -> the races of an event
//   results.html?sectorcode=AL&raceid=…                                  -> one race's result

import { getText } from '../http.mjs';

const BASE = 'https://www.fis-ski.com/DB/general';
const get = (path) => getText(`${BASE}/${path}`, { gapMs: 1000 }); // one page a second: it's a website, not an API

// World Cup, World Championships and Olympics. Tour de Ski stages are "SWC"
// (stage World Cup) races inside World Cup events.
export const CATEGORIES = { WC: 'World Cup', WSC: 'World Championships', OWG: 'Olympics' };
const RACE_CATEGORIES = ['WC', 'SWC', 'WSC', 'OWG'];

// The FIS season code is the year it ends in: 2026 is 2025/26. From July, the coming season is current.
export function seasonCodes(now = new Date()) {
  const cur = now.getUTCFullYear() + (now.getUTCMonth() >= 6 ? 1 : 0);
  return [cur - 1, cur];
}

// The page's text pieces in order, without tags: "<div>1</div><div>8</div>" -> ['1', '8'].
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#039;|&apos;/g, "'").replace(/&quot;/g, '"');
export const texts = (html) => html.replace(/<!--[\s\S]*?-->/g, '').split(/<[^>]+>/).map((s) => decode(s).replace(/\s+/g, ' ').trim()).filter(Boolean);

// Events of a season: [{ eventId, dates ("25-26 Oct 2025"), place, country }].
export function eventsFromCalendar(html) {
  const out = [];
  for (const row of html.split(/<div class="table-row reset-padding/).slice(1)) {
    const eventId = row.match(/eventid=(\d+)/)?.[1];
    if (!eventId || out.some((e) => e.eventId === eventId)) continue;
    const t = texts(row);
    const dateAt = t.findIndex((x) => /\b\d{4}$/.test(x));
    out.push({ eventId, dates: t[dateAt] ?? '', place: t[dateAt + 1] ?? '', country: row.match(/country__name-short">\s*([A-Z]{3})/)?.[1] ?? null });
  }
  return out;
}

export async function fetchEvents(sector, season, category) {
  return eventsFromCalendar(await get(`calendar-results.html?sectorcode=${sector}&seasoncode=${season}&categorycode=${category}`));
}

// Races of an event: [{ raceId, start, discipline, gender, category, official }].
export function racesFromEvent(html) {
  const body = html.slice(html.indexOf('eventdetailscontent'));
  const out = [];
  for (const row of body.split(/<div class="table-row reset-padding/).slice(1)) {
    const raceId = row.match(/raceid=(\d+)/)?.[1];
    if (!raceId) continue;
    const t = texts(row).filter((x) => !/^[DPC]$/.test(x) && x !== '">');
    // [date, time, codex, discipline, (venue, for events at several venues), discipline, category, gender, …]
    const codexAt = t.findIndex((x) => /^\d{4}$/.test(x));
    const genderAt = t.findIndex((x, i) => i > codexAt + 2 && /^[WMX]$/.test(x));
    const venue = t[codexAt + 2] !== t[codexAt + 1] ? t[codexAt + 2] : null;
    out.push({
      raceId,
      start: row.match(/data-iso-date="([^"]+)"/)?.[1] ?? null,
      discipline: t[codexAt + 1] ?? '',
      venue: venue?.replace(/\s*\([A-Z]{3}\)$/, '') ?? null,
      category: t[genderAt - 1] ?? '',
      gender: { W: 'women', M: 'men', X: 'mixed' }[t[genderAt]] ?? 'mixed',
      official: /Official results/i.test(row),
      cancelled: /status__item_selected[^>]*title="Cancelled"/i.test(row),
    });
  }
  return out;
}

export async function fetchRaces(sector, eventId) {
  return racesFromEvent(await get(`event-details.html?sectorcode=${sector}&eventid=${eventId}`));
}

export const fetchResultPage = (sector, raceId) => get(`results.html?sectorcode=${sector}&raceid=${raceId}`);

const TIME = /^(\d+:){0,2}\d{1,2}\.\d{1,2}$/; // 59.87, 1:07.80, 2:05:32.1
export const secondsOf = (s) => (s ? s.replace('+', '').split(':').map(Number).reduce((a, p) => a * 60 + p, 0) : null);

// One race's result: { name, rows: [{ rank, bib, name, nation, times: [...] }], unranked }.
// Alpine two-run rows have times [run1, run2, total]; one-run and cross-country rows [total].
export function resultFromPage(html) {
  const head = texts(html.slice(html.indexOf('event-header__inner'), html.indexOf('event-header__inner') + 3000));
  const rows = [];
  let unranked = 0;
  for (const chunk of html.split(/<a class="table-row"/).slice(1)) {
    if (!/athlete-biography/.test(chunk.slice(0, 300))) continue;
    const t = texts(chunk.slice(0, chunk.indexOf('</a>'))).slice(1); // the first piece is the link's attributes
    // Ranked rows: rank, bib, FIS code, name, year, nation, times… Unranked (DNF, DSQ): bib, code, name, …
    const ranked = /^\d{5,}$/.test(t[2] ?? '') && /^\d+$/.test(t[0]);
    if (!ranked) { unranked++; continue; }
    // After the times comes the gap to the winner ("+0.58"; the winner's own row
    // repeats their time there), then FIS points. Keep only the times.
    const rest = t.slice(6);
    let gapAt = rest.findIndex((x) => x.startsWith('+'));
    if (gapAt < 0) gapAt = rest.findIndex((x, i) => i > 0 && x === rest[i - 1]);
    const timesList = (gapAt < 0 ? rest : rest.slice(0, gapAt)).filter((x) => TIME.test(x));
    rows.push({ rank: Number(t[0]), bib: Number(t[1]), name: t[3], nation: t[5], times: timesList.map(secondsOf) });
  }
  return { place: head[1] ?? '', series: head[2] ?? '', name: head[3] ?? '', rows, unranked };
}

const nameOf = (r) => `${r.name.split(' ').map((w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w)).join(' ')} (${r.nation})`;
const podium = (rows, gap) => rows.slice(0, 3).map((r, i) => `${i + 1}. ${nameOf(r)}${i ? ` +${gap(r).toFixed(2).replace(/0$/, '')} s` : ''}`).join(', ');

// Alpine facts. Two-run races (slalom, giant slalom) also give the order after run 1.
export function alpineFacts(page) {
  const rows = page.rows.filter((r) => r.times.length);
  const runs = rows[0]?.times.length >= 3 ? 2 : 1;
  const total = (r) => r.times.at(-1);
  const gap = (r) => total(r) - total(rows[0]);
  const f = {
    runs,
    gapP2: rows[1] ? gap(rows[1]) : null,
    gapP5: rows[4] ? gap(rows[4]) : null,
    result: podium(rows, gap),
  };
  if (runs === 2) {
    // Run 1 order, among everyone with a run-1 time in the result.
    const run1 = rows.filter((r) => r.times.length >= 3).sort((a, b) => a.times[0] - b.times[0]);
    const run1Rank = new Map(run1.map((r, i) => [r, i + 1]));
    f.winnerRun1 = run1Rank.get(rows[0]);
    f.run1LeaderFinish = run1[0].rank;
    f.run1Spread = run1[4] ? run1[4].times[0] - run1[0].times[0] : null; // top 5 after run 1
    f.bigMover = rows.slice(0, 10).some((r) => run1Rank.get(r) - r.rank >= 10);
    f.result += ` (winner ${run1Rank.get(rows[0])}. after run 1)`;
  } else {
    f.lateBibPodium = rows.slice(0, 3).some((r) => r.bib >= 30);
  }
  return f;
}

// Cross-country facts. Mass starts, pursuits and skiathlons finish head to head.
export function crossCountryFacts(page, discipline) {
  const rows = page.rows.filter((r) => r.times.length);
  const gap = (r) => r.times[0] - rows[0].times[0];
  return {
    massStart: /mass start|pursuit|skiathlon|handicap/i.test(discipline),
    sprint: false,
    gapP2: rows[1] ? gap(rows[1]) : null,
    gapP3: rows[2] ? gap(rows[2]) : null,
    within5: rows.filter((r) => gap(r) <= 5).length,
    result: podium(rows, gap),
  };
}

// Which races PrimeTime scores. Cross-country sprints and heat mass starts
// have no usable times in the results (only the order), and team events are
// left out for now.
export function scoredRace(sector, race) {
  if (race.cancelled || !RACE_CATEGORIES.includes(race.category)) return false;
  if (sector === 'CC') return !/sprint|relay|team|heat|standings/i.test(race.discipline);
  if (sector === 'AL') return /slalom|giant|downhill|super/i.test(race.discipline) && !/team|parallel|combined/i.test(race.discipline);
  return false;
}
