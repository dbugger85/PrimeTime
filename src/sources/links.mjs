// Direct links to the match itself on the streaming services, so nobody has to browse
// an app that shows results on its front page. All three sources are the services' own
// public (unofficial) JSON behind their web apps:
//   TV 2 Play  ai.play.tv2.no/v4/…           football: the "Kommende kamper" and "Kamper i opptak" lists
//   Viaplay    content.viaplay.no/pcdash-no/…  Premier League: upcoming matches (kept ~2 days after)
//   NRK TV     psapi.nrk.no/tv/catalog/…       biathlon, alpine and cross-country: one episode per race
// OPTIONAL, like FotMob: every function gives up quietly, and a card without a link
// keeps the service's front page. Found links are remembered in state.links, so each
// full build only asks about events that don't have one yet.

import { getJson } from '../http.mjs';
import { sameTeam } from './fotmob.mjs';

const get = (url) => getJson(url, { gapMs: 1000, retries: 1 });
const osloDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Oslo' }).format(new Date(ms)); // YYYY-MM-DD
const DAY = 864e5;

// Norwegian names TV 2 uses for national teams (and a few clubs), in ESPN's spelling.
const NORWEGIAN = {
  tyskland: 'Germany', hellas: 'Greece', nederland: 'Netherlands', irland: 'Republic of Ireland', 'østerrike': 'Austria',
  danmark: 'Denmark', kasakhstan: 'Kazakhstan', kypros: 'Cyprus', belgia: 'Belgium', tyrkia: 'Türkiye', 'nord-irland': 'Northern Ireland',
  skottland: 'Scotland', sveits: 'Switzerland', frankrike: 'France', italia: 'Italy', spania: 'Spain', norge: 'Norway', sverige: 'Sweden',
  island: 'Iceland', 'færøyene': 'Faroe Islands', polen: 'Poland', tsjekkia: 'Czechia', ungarn: 'Hungary', kroatia: 'Croatia',
  'bosnia-hercegovina': 'Bosnia-Herzegovina', 'nord-makedonia': 'North Macedonia', litauen: 'Lithuania', estland: 'Estonia',
  hviterussland: 'Belarus', ukraina: 'Ukraine', aserbajdsjan: 'Azerbaijan', russland: 'Russia', romania: 'Romania',
  hamkam: 'Hamarkameratene', 'sarpsborg 08': 'Sarpsborg FK', 'bayern münchen': 'Bayern Munich', 'man. united': 'Manchester United',
  'man. city': 'Manchester City', 'man united': 'Manchester United', 'man city': 'Manchester City', 'nottm forest': 'Nottingham Forest',
  spurs: 'Tottenham Hotspur', wolves: 'Wolverhampton Wanderers',
};
const english = (name) => NORWEGIAN[name.trim().toLowerCase()] ?? name.trim();
const sameMatch = (title, e) => {
  const [a, b] = title.split(' - ').map(english);
  return Boolean(b) && sameTeam(a, e.teams[0]) && sameTeam(b, e.teams[1]);
};

// ---- TV 2 Play (football) ----
const TV2 = 'https://ai.play.tv2.no';
const TV2_COMPS = {
  'nor.1': 'Eliteserien', 'uefa.nations': 'UEFA Nations League', 'uefa.champions': 'UEFA Champions League',
  'fifa.worldq.uefa': 'VM-kvalifisering UEFA', 'uefa.euroq': 'EM-kvalifisering',
};

// "I dag 18:45", "I går 20:30", "Man. 20:30", "26. sep. 14:45" -> an Oslo date (YYYY-MM-DD), or null.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
const WEEKDAYS = ['søn', 'man', 'tir', 'ons', 'tor', 'fre', 'lør'];
export function tv2Day(label, now, upcoming) {
  const t = (label ?? '').toLowerCase();
  if (t.startsWith('i dag')) return osloDay(now);
  if (t.startsWith('i går')) return osloDay(now - DAY);
  if (t.startsWith('i morgen')) return osloDay(now + DAY);
  const wd = WEEKDAYS.findIndex((w) => t.startsWith(w));
  if (wd >= 0) { // a weekday within the next (or, for replays, the last) week
    for (let i = 1; i <= 7; i++) {
      const ms = now + (upcoming ? i : -i) * DAY;
      if (new Date(osloDay(ms) + 'T12:00:00Z').getUTCDay() === wd) return osloDay(ms);
    }
  }
  const m = /^(\d{1,2})\.\s*([a-zæøå]{3})/.exec(t);
  if (m && MONTHS.includes(m[2])) {
    const year = new Date(now).getUTCFullYear();
    const iso = (y) => `${y}-${String(MONTHS.indexOf(m[2]) + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    // the year that puts it nearest to today
    return [year - 1, year, year + 1].map(iso).sort((x, y) => Math.abs(Date.parse(x) - now) - Math.abs(Date.parse(y) - now))[0];
  }
  return null;
}

async function tv2Feeds() {
  const page = await get(`${TV2}/v4/content/path/sport/fotball`);
  const feeds = await get(`${TV2}${page.feeds.self_uri}`);
  const find = (re) => feeds.feeds?.find((f) => re.test(f.title ?? ''))?.id;
  return { upcoming: find(/kommende/i), past: find(/i opptak/i) };
}

async function tv2Links(wanted, now) {
  const needs = wanted.filter((e) => e.sport === 'football' && TV2_COMPS[e.comp] && e.services.includes('tv2play'));
  if (!needs.length) return {};
  const ids = await tv2Feeds();
  const found = {};
  const scan = async (feedId, upcoming, maxPages) => {
    for (let page = 0; page < maxPages && feedId; page++) {
      const feed = await get(`${TV2}/v4/feed/${feedId}?start=${page * 50}&size=50`);
      let oldest = Infinity;
      for (const item of feed.content ?? []) {
        if (!item.url?.startsWith('/sport/fotball/')) continue;
        const day = tv2Day(item.labels?.[0]?.text, now, upcoming);
        if (day) oldest = Math.min(oldest, Date.parse(day));
        for (const e of needs) {
          if (found[e.id] || item.original_title !== TV2_COMPS[e.comp] || !sameMatch(item.title ?? '', e)) continue;
          if (day && Math.abs(Date.parse(day) - Date.parse(osloDay(Date.parse(e.start)))) > DAY) continue;
          found[e.id] = { url: `https://play.tv2.no${item.url}` };
        }
      }
      if (needs.every((e) => found[e.id]) || (feed.content ?? []).length < 50) break;
      if (!upcoming && now - oldest > 35 * DAY) break; // past the 30 days PrimeTime keeps
    }
  };
  await scan(ids.upcoming, true, 3);
  await scan(ids.past, false, 10);
  return found;
}

// ---- Viaplay (Premier League) ----
async function viaplayLinks(wanted) {
  const needs = wanted.filter((e) => e.sport === 'football' && e.comp === 'eng.1' && e.services.includes('viaplay'));
  if (!needs.length) return {};
  const data = await get('https://content.viaplay.no/pcdash-no/sport/fotball/premier-league');
  const items = [];
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (o.epg && o.content && o.publicPath) { items.push(o); return; }
    for (const v of Object.values(o)) walk(v);
  };
  walk(data);
  const found = {};
  for (const e of needs) {
    // The broadcast starts a little before kick-off.
    const hit = items.find((x) => Math.abs(Date.parse(x.epg.start) - Date.parse(e.start)) <= 90 * 60e3 && sameMatch(x.content.title ?? '', e));
    if (hit) found[e.id] = { url: `https://viaplay.no/sport/${hit.publicPath}`, until: hit.system?.availability?.end ?? null };
  }
  return found;
}

// ---- NRK TV (winter sports) ----
const NRK_SERIES = { biathlon: 'skiskyting', alpine: 'alpint', 'cross-country': 'langrenn' };
const NRK_GENDER = { women: /kvinner/, men: /menn/, mixed: /mix|mixed|singlemix/ };
// Our race name -> what NRK's title says.
const NRK_TYPES = [
  [/single mixed/i, /singlemix/], [/mixed relay/i, /mixstafett|mixed stafett/], [/relay/i, /stafett/],
  [/pursuit/i, /jaktstart/], [/mass start/i, /fellesstart/], [/sprint/i, /sprint/], [/individual/i, /normal|individuell/],
  [/giant slalom/i, /storslalåm/], [/slalom/i, /^slalåm/], [/downhill/i, /utfor/], [/super-?g/i, /super-?g/],
];

export function nrkMatch(e, episodes) {
  const day = osloDay(Date.parse(e.start)).split('-').reverse().join('.'); // 22.03.2026
  const type = NRK_TYPES.find(([ours]) => ours.test(e.race))?.[1];
  const km = /(\d+(?:[.,]\d+)?)\s*km/i.exec(e.race)?.[1];
  const hits = episodes.filter((x) => {
    const t = (x.titles?.title ?? '').toLowerCase();
    if (!t.endsWith(day) || !NRK_GENDER[e.gender]?.test(t)) return false;
    if (e.comp === 'cross-country') return km ? t.startsWith(`${km.replace('.', ',')} km`) || t.startsWith(`${km} km`) : false;
    if (!type?.test(t)) return false;
    return !/2\. omgang/.test(t); // two-run alpine races: link to run 1
  });
  return hits.length === 1 ? hits[0] : null;
}

async function nrkLinks(wanted) {
  const needs = wanted.filter((e) => e.sport === 'winter' && NRK_SERIES[e.comp] && e.services.includes('nrk'));
  const found = {};
  const seasons = new Map(); // "series/year" -> episodes
  for (const e of needs) {
    const key = `${NRK_SERIES[e.comp]}/${e.start.slice(0, 4)}`;
    if (!seasons.has(key)) {
      const data = await get(`https://psapi.nrk.no/tv/catalog/series/${key.replace('/', '/seasons/')}`).catch(() => null);
      const list = data?._embedded?.instalments;
      seasons.set(key, Array.isArray(list) ? list : list?._embedded?.episodes ?? []);
    }
    const ep = nrkMatch(e, seasons.get(key));
    if (ep?.prfId && ep.availability?.status !== 'expired') found[e.id] = { url: `https://tv.nrk.no/se?v=${ep.prfId}` };
  }
  return found;
}

// Looks up links for the events and upcoming events that don't have one yet, and stores
// them in state.links ({ id: { service: { url, until } } }), dropping entries older than 32 days.
export async function updateLinks(state, events, upcoming, now = Date.now()) {
  state.links ??= {};
  for (const [id, l] of Object.entries(state.links)) if (now - Date.parse(l.start ?? 0) > 32 * DAY) delete state.links[id];
  const wanted = [...upcoming, ...events.filter((e) => now - Date.parse(e.start) < 30 * DAY)];
  const missing = (service) => wanted.filter((e) => !state.links[e.id]?.[service]);
  const report = [];
  for (const [service, find] of [['tv2play', tv2Links], ['viaplay', viaplayLinks], ['nrk', nrkLinks]]) {
    try {
      const found = await find(missing(service), now);
      for (const [id, link] of Object.entries(found)) {
        const e = wanted.find((x) => x.id === id);
        state.links[id] = { ...state.links[id], start: e.start, [service]: link };
      }
      report.push(`${service} ${Object.keys(found).length}`);
    } catch (err) {
      report.push(`${service} failed (${err.message.slice(0, 60)})`); // optional: the front page link stays
    }
  }
  return `direct links: ${report.join(', ')}`;
}
