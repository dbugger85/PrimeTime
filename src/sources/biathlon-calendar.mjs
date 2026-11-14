// Which biathlon races there are, and when: from English Wikipedia, since IBU's
// own data API closed (401 since 2026-11-09). Wikipedia's API is open to bots
// that name themselves (https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy).
//   "2025–26 Biathlon World Cup"             -> the season's calendar: stages, places, dates
//   "2025–26 Biathlon World Cup – Stage 3"   -> one stage's "Schedule of events" (date, time, race)
//   "Biathlon World Championships 2027", "Biathlon at the 2026 Winter Olympics" -> their schedules
// The results themselves come from IBU's result sheets (src/sources/ibu.mjs).
//
// Wikipedia is written by volunteers: a stage only shows up once someone has
// written its page with a schedule (usually a few days before). Times are as the
// page gives them (CET unless it says otherwise); the result sheet corrects them later.

import { getJson } from '../http.mjs';

const API = 'https://en.wikipedia.org/w/api.php?action=parse&prop=wikitext&format=json&formatversion=2&redirects=1&page=';

export async function fetchWikitext(title) {
  const res = await getJson(API + encodeURIComponent(title.replace(/ /g, '_')), { gapMs: 1000 });
  if (res?.error?.code === 'missingtitle') return null;
  if (!res?.parse) throw new Error(`Wikipedia: no page "${title}" (${res?.error?.code ?? 'unknown answer'})`);
  return res.parse.wikitext;
}

// "2526" -> "2025–26 Biathlon World Cup".
export const seasonTitle = (season) => `20${season.slice(0, 2)}–${season.slice(2)} Biathlon World Cup`;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthOf = (name) => MONTHS.findIndex((m) => m.toLowerCase().startsWith(String(name).toLowerCase().slice(0, 3)));
// Months from July belong to the season's first year: "2526", December -> 2025, March -> 2026.
const yearOf = (season, month) => 2000 + Number(month >= 6 ? season.slice(0, 2) : season.slice(2));

// Wiki markup -> plain text: [[a|b]] -> b, [[a]] -> a, templates and tags out.
export function plain(s) {
  let t = String(s ?? '');
  t = t.replace(/<ref[^>]*\/>/g, '').replace(/<ref[\s\S]*?<\/ref>/g, '').replace(/<[^>]+>/g, '');
  t = t.replace(/\{\{nowrap\|([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/gi, '$1');
  for (let k = 0; k < 3; k++) t = t.replace(/\{\{[^{}]*\}\}/g, '');
  t = t.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'{2,}/g, '');
  return t.replace(/&nbsp;/g, ' ').replace(/&ndash;/g, '–').replace(/\s+/g, ' ').trim();
}

// Country from {{flagicon|SWE}} or {{Flag icon|Estonia}}.
const COUNTRY_NAMES = {
  austria: 'AUT', canada: 'CAN', china: 'CHN', 'czech republic': 'CZE', czechia: 'CZE', estonia: 'EST', finland: 'FIN', france: 'FRA',
  germany: 'GER', italy: 'ITA', japan: 'JPN', korea: 'KOR', 'south korea': 'KOR', norway: 'NOR', poland: 'POL', russia: 'RUS',
  slovakia: 'SVK', slovenia: 'SLO', sweden: 'SWE', switzerland: 'SUI', 'united states': 'USA', usa: 'USA',
};
export function countryOf(cell) {
  const m = /\{\{\s*flag\s*icon\s*\|\s*([^|}]+)/i.exec(cell);
  if (!m) return null;
  const v = m[1].trim();
  return /^[A-Z]{3}$/.test(v) ? v : COUNTRY_NAMES[v.toLowerCase()] ?? null;
}

// "29 November–7 December", "12–14 December", "8–21 February" -> [first, last] (UTC midnight).
export function stageDays(text, season) {
  const t = plain(text).replace(/[‐-―-]/g, '–');
  const m = /(\d{1,2})(?:\s+([A-Za-z]+))?\s*–\s*(\d{1,2})\s+([A-Za-z]+)/.exec(t);
  const one = /(\d{1,2})\s+([A-Za-z]+)/.exec(t);
  const day = (d, month) => (month < 0 ? null : new Date(Date.UTC(yearOf(season, month), month, Number(d))));
  if (m) return [day(m[1], monthOf(m[2] ?? m[4])), day(m[3], monthOf(m[4]))];
  if (one) { const d = day(one[1], monthOf(one[2])); return [d, d]; }
  return [null, null];
}

// The rows of the first wiki table after `from`: [[cell, …], …] (raw cells, header rows left out).
export function tableRows(text, from = 0) {
  const start = text.indexOf('{|', from);
  if (start < 0) return [];
  const end = text.indexOf('\n|}', start);
  const body = text.slice(start, end < 0 ? undefined : end);
  return body.split(/\n\|-[^\n]*/).slice(1).map((row) => {
    const cells = [];
    for (const line of row.split('\n')) {
      if (!line.startsWith('|') || line.startsWith('|}')) continue;
      for (let cell of line.slice(1).split('||')) {
        // "style=… | text" or "rowspan=2| text": the part after the attributes' "|" (not inside [[…]] or {{…}}).
        const bar = cell.replace(/\[\[[^\]]*\]\]|\{\{[^}]*\}\}/g, (x) => '\0'.repeat(x.length)).indexOf('|');
        const attrs = bar >= 0 ? cell.slice(0, bar) : '';
        if (bar >= 0 && /=/.test(attrs) && !/\[\[|\{\{/.test(attrs)) cell = cell.slice(bar + 1);
        cells.push({ text: cell.trim(), rowspan: Number(/rowspan\s*=\s*"?(\d+)/i.exec(attrs)?.[1] ?? 1) });
      }
    }
    return cells;
  }).filter((r) => r.length);
}

// The season's stages: [{ code: 'CP03' | 'CH__' | 'OG__', series, place, country, first, last, page }].
// The race type columns of the calendar table.
const TYPE_COLUMNS = [[/individual/i, 'IN'], [/sprint/i, 'SP'], [/pursuit/i, 'PU'], [/mass start/i, 'MS'], [/single mixed/i, 'SR'], [/mixed relay/i, 'MX'], [/relay/i, 'RL']];

export function stagesFromSeason(wikitext, season) {
  const at = wikitext.search(/==\s*Calendar\s*==/i);
  if (at < 0) return [];
  // Header: "!Stage !Location !Date !Individual /<br>Short individual !Sprint … !Details".
  const head = wikitext.slice(wikitext.indexOf('{|', at), wikitext.indexOf('\n|-', at)).split('\n').filter((l) => l.startsWith('!'))
    .flatMap((l) => l.slice(1).split('!!')).map((h) => plain(h.replace(/^[^|[{]*=[^|[{]*\|/, '')));
  const columns = head.map((h) => TYPE_COLUMNS.find(([re]) => re.test(h))?.[1] ?? null);
  const out = [];
  for (const cells of tableRows(wikitext, at)) {
    const raw = cells.map((c) => c.text);
    const first = raw[0] ?? '';
    const n = /^\s*(\d{1,2})\s*$/.exec(first)?.[1];
    const code = n ? `CP${n.padStart(2, '0')}` : /\|\s*WCH\s*\]\]|World Championships/i.test(first) ? 'CH__' : /\|\s*OG\s*\]\]|Olympic/i.test(first) ? 'OG__' : null;
    if (!code) continue;
    const link = raw.map((c) => /\[\[([^\]|]+)\|[^\]]*\]\]/.exec(c.replace(/&nbsp;/g, ' '))?.[1]).filter(Boolean).at(-1);
    const isStagePage = (t) => /Stage \d+|World Championships|Olympics/i.test(t ?? '');
    const [firstDay, lastDay] = stageDays(raw[2] ?? '', season);
    out.push({
      code,
      series: code === 'CH__' ? 'World Championships' : code === 'OG__' ? 'Olympics' : 'World Cup',
      place: plain(raw[1]).replace(/\s*–\s*/g, '–'),
      country: countryOf(raw[1] ?? ''),
      first: firstDay,
      last: lastDay,
      page: isStagePage(link) ? link.trim() : null, // null: no stage page yet
      types: columns.flatMap((t, i) => (t && /●|•|✓/.test(raw[i] ?? '') ? [t] : [])), // ['SP', 'PU', 'MS']
    });
  }
  return out;
}

// Race name -> IBU codes: category (SW women, SM men, MX mixed) + discipline.
export function raceCodes(event) {
  const e = plain(event).toLowerCase();
  if (/single mixed/.test(e)) return { cat: 'MX', disc: 'SR' };
  if (/mixed/.test(e) && /relay/.test(e)) return { cat: 'MX', disc: 'RL' };
  const cat = /\bwomen|\bladies/.test(e) ? 'SW' : /\bmen\b/.test(e) ? 'SM' : null; // "Women's 7.5 km Sprint", "4 x 6 km Women Relay"
  const disc = /short individual/.test(e) ? 'SI' : /individual/.test(e) ? 'IN' : /sprint/.test(e) ? 'SP'
    : /pursuit/.test(e) ? 'PU' : /mass start/.test(e) ? 'MS' : /relay/.test(e) ? 'RL' : null;
  return cat && disc ? { cat, disc } : null;
}

const DISCIPLINE_NAMES = { SP: 'sprint', PU: 'pursuit', MS: 'mass start', IN: 'individual', SI: 'short individual', RL: 'relay' };
// A tidy race name: "Women's 7.5 km sprint", "Men's 4x7.5 km relay", "Mixed relay", "Single mixed relay".
export function raceName(event, { cat, disc }) {
  if (cat === 'MX') return disc === 'SR' ? 'Single mixed relay' : 'Mixed relay';
  const e = plain(event).replace(/×/g, 'x');
  const km = disc === 'RL' ? /(\d)\s*x\s*(\d+(?:\.\d+)?)\s*km/i.exec(e) : /(\d+(?:\.\d+)?)\s*km/i.exec(e);
  const dist = km ? (disc === 'RL' ? `${km[1]}x${km[2]} km ` : `${km[1]} km `) : '';
  return `${cat === 'SW' ? "Women's" : "Men's"} ${dist}${DISCIPLINE_NAMES[disc]}`;
}

// Hours ahead of UTC: from the page ("UTC+2", "CET", "EET"), else the host country's winter time.
const EASTERN = new Set(['FIN', 'EST', 'LAT', 'LTU', 'UKR', 'BLR']);
function offsetOf(text, country) {
  const utc = /UTC\s*([+−-])\s*(\d{1,2})/.exec(text);
  if (utc) return (utc[1] === '+' ? 1 : -1) * Number(utc[2]);
  if (/\bCEST\b/.test(text)) return 2;
  if (/\bEEST\b/.test(text)) return 3;
  if (/\bEET\b|Eastern European/.test(text)) return 2;
  if (/\bCET\b|Central European/.test(text)) return 1;
  return EASTERN.has(country) ? 2 : 1;
}

// A stage page's schedule: [{ cat, disc, name, start (ISO, UTC) }].
export function racesFromSchedule(wikitext, stage, season) {
  const at = wikitext.search(/==+\s*(Schedule|Competition schedule)[^=]*==+/i);
  if (at < 0) return [];
  const tableAt = wikitext.indexOf('{|', at);
  const note = wikitext.slice(at, tableAt); // "All times are local (UTC+2)."
  const out = [];
  let date = null, dateLeft = 0;
  for (const cells of tableRows(wikitext, at)) {
    let k = 0;
    const d = /^(\d{1,2})\s+([A-Za-z]+)/.exec(plain(cells[0]?.text));
    if (d && monthOf(d[2]) >= 0) {
      date = { day: Number(d[1]), month: monthOf(d[2]) };
      dateLeft = cells[0].rowspan;
      k = 1;
    } else if (dateLeft <= 0) {
      continue;
    }
    dateLeft--;
    const timeCell = cells[k]?.text ?? '';
    const time = /(\d{1,2}):(\d{2})/.exec(plain(timeCell));
    const event = cells.slice(time ? k + 1 : k).map((c) => c.text).join(' ');
    const codes = raceCodes(event);
    if (!codes || !date) continue;
    const off = offsetOf(`${note} ${timeCell}`, stage.country);
    const start = new Date(Date.UTC(yearOf(season, date.month), date.month, date.day, time ? Number(time[1]) - off : 12, time ? Number(time[2]) : 0));
    out.push({ ...codes, name: raceName(event, codes), start: start.toISOString(), event: plain(event) });
  }
  return fixGenders(out).map(({ event, ...r }) => r);
}

// Two races with the same code: one page called the women's 12.5 km mass start "Men's" (Nové
// Město 2026). The distance tells them apart: the other gender's usual distance wins.
const DISTANCES = { SP: ['7.5', '10'], PU: ['10', '12.5'], MS: ['12.5', '15'], IN: ['15', '20'], SI: ['12.5', '15'], RL: ['6', '7.5'] };
function fixGenders(list) {
  for (const r of list) {
    const twin = list.find((x) => x !== r && x.cat === r.cat && x.disc === r.disc);
    if (!twin || r.cat === 'MX' || !DISTANCES[r.disc]) continue;
    const km = /(\d+(?:\.\d+)?)\s*km/.exec(r.event.replace(/^.*[x×]\s*(?=\d)/, ''))?.[1];
    const [women, men] = DISTANCES[r.disc];
    const cat = km === women ? 'SW' : km === men ? 'SM' : null;
    if (cat && cat !== r.cat) { r.cat = cat; r.name = raceName(r.event.replace(/^(wo)?men'?s?\b/i, cat === 'SW' ? "Women's" : "Men's"), r); }
  }
  return list;
}

// A race counts as over (so its result sheet is looked for) this long after its start.
const RACE_HOURS = 2.5;
// Give up on a race whose sheet hasn't come out this long after its start (cancelled or moved).
export const GIVE_UP_DAYS = 2;

// Every World Cup, World Championship and Olympic race of this season and the last, as
// { raceId, season, code, cat, discipline, name, start, place, country, series, gender, finished, live }.
// state.biathlonStages caches the schedules of stages that ended over two days ago (they
// won't change), so a full build only reads the season pages and the current stages.
// state.biathlonGone lists races given up on (no result sheet two days after the start).
//
// A stage without a schedule on Wikipedia (no stage page, like Oslo 2026) is still found once it's
// over: the calendar row says which race types it had, and `findRace(raceId, discipline)` looks
// for each one's result sheet (which also gives the real start). Each sheet is looked for once;
// the list found is cached like a schedule.
export async function listBiathlon(now, state, { aheadDays = 14, keepDays = 400, raceIdOf, findRace = null, wikitext = fetchWikitext, log = console.log } = {}) {
  state.biathlonStages ??= {};
  state.biathlonGone ??= {};
  const races = [];
  const day = 864e5;
  for (const season of seasonIdsAround(now)) {
    const text = await wikitext(seasonTitle(season));
    if (!text) continue; // no page for that season yet
    for (const stage of stagesFromSeason(text, season)) {
      if (!stage.first || !stage.last) continue;
      if (stage.first - now > aheadDays * day) continue; // too far ahead to list yet
      if (now - stage.last > keepDays * day) continue; // too old to keep
      const key = stage.page ?? `${season} ${stage.code}`;
      let list = state.biathlonStages[key]?.races;
      if (!list) {
        const page = stage.page ? await wikitext(stage.page) : null;
        list = page ? racesFromSchedule(page, stage, season) : [];
        const over = now - stage.last > day; // the day after the last race day
        if (!list.length && over && findRace) list = await racesFromSheets(season, stage, raceIdOf, findRace);
        if (!list.length) { log(`biathlon: no schedule on Wikipedia yet for ${stage.place} (${stage.code})`); continue; }
        if (now - stage.last > 2 * day) state.biathlonStages[key] = { last: stage.last.toISOString(), races: list };
      }
      for (const r of list) {
        const raceId = raceIdOf(season, stage.code, r.cat, r.disc);
        if (state.biathlonGone[raceId]) continue;
        const start = Date.parse(r.start);
        const finished = now - start > RACE_HOURS * 3600e3;
        races.push({
          raceId, season, code: stage.code, cat: r.cat, discipline: r.disc, name: r.name, start: r.start,
          place: stage.place, country: stage.country, series: stage.series,
          gender: r.cat === 'SW' ? 'women' : r.cat === 'SM' ? 'men' : 'mixed',
          finished, live: !finished && start <= now.getTime(),
        });
      }
    }
  }
  // Forget what's too old to matter.
  for (const [page, s] of Object.entries(state.biathlonStages)) if (now - Date.parse(s.last) > keepDays * day) delete state.biathlonStages[page];
  for (const [id, start] of Object.entries(state.biathlonGone)) if (now - Date.parse(start) > keepDays * day) delete state.biathlonGone[id];
  return races.sort((a, b) => a.start.localeCompare(b.start));
}

// The races of a finished stage, from the result sheets of the race types its calendar row lists.
// The individual column covers both the individual and the short individual: the second is only
// looked for when the first isn't there.
async function racesFromSheets(season, stage, raceIdOf, findRace) {
  const candidates = stage.types.flatMap((t) => (t === 'MX' ? [['MX', 'RL']] : t === 'SR' ? [['MX', 'SR']] : [['SW', t], ['SM', t]]));
  const out = [];
  for (const [cat, disc] of candidates) {
    let d = disc;
    let found = await findRace(raceIdOf(season, stage.code, cat, disc), disc);
    if (!found && disc === 'IN') { d = 'SI'; found = await findRace(raceIdOf(season, stage.code, cat, 'SI'), 'SI'); }
    if (!found) continue;
    out.push({ cat, disc: d, name: raceName(found.title ?? '', { cat, disc: d }), start: utcFromLocal(found.start, stage.country) });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// "2526": this season and the last. From July, the coming season is the current one.
function seasonIdsAround(now) {
  const y = now.getUTCFullYear() % 100;
  const cur = now.getUTCMonth() >= 6 ? y : y - 1;
  const id = (a) => `${String(a).padStart(2, '0')}${String(a + 1).padStart(2, '0')}`;
  return [id(cur - 1), id(cur)];
}

// The result sheet's local start time -> UTC, by the host country's time zone (Central
// or Eastern European; summer time from the last Sunday of March, which the season ends near).
export function utcFromLocal({ year, month, day, hour, minute }, country) {
  const lastSundayOfMarch = 31 - new Date(Date.UTC(year, 2, 31)).getUTCDay();
  const summer = (month > 2 && month < 9) || (month === 2 && day >= lastSundayOfMarch) ? 1 : 0;
  const off = (EASTERN.has(country) ? 2 : 1) + summer;
  return new Date(Date.UTC(year, month, day, hour - off, minute)).toISOString();
}
