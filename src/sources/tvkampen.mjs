// Biathlon start times from TV-kampen (tvkampen.com), the Norwegian TV guide, read in the full
// build only: one page a run. Optional like FotMob: any failure gives nothing, and the race times
// come from IBU's start lists and Wikipedia instead (src/sources/biathlon-calendar.mjs).
//   https://www.tvkampen.com/vintersport/skiskyting-verdenscup          World Cup (league 2199)
//   https://www.tvkampen.com/vintersport/skiskytter-verdensmesterskap   World Championships (league 2646)
// robots.txt allows these pages (it disallows /api, /go/ and /wp-admin/, which are never used).
// The terms allow private, non-commercial use; the owner accepted the grey zone (2026-11-14).
//
// The page is built with Next.js: its data sits in `self.__next_f.push([1, "…"])` script chunks,
// as objects like {"fixture_id":1994920,"title":"20 km, Individuell (Menn)",
// "date":"2026-11-26T15:15:00.000Z","league_id":2199,…}. The page also lists other winter
// sports for today and studio shows ("Vinterstudion"), so only the biathlon leagues and titles
// that name a race are kept. Only the time, race type and gender are used.

import { getText } from '../http.mjs';

const PAGES = {
  'World Cup': { url: 'https://www.tvkampen.com/vintersport/skiskyting-verdenscup', league: 2199 },
  'World Championships': { url: 'https://www.tvkampen.com/vintersport/skiskytter-verdensmesterskap', league: 2646 },
};

// The page's data: the strings of every `self.__next_f.push([1, "…"])` chunk, joined.
export function nextData(html) {
  let text = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    try {
      const chunk = JSON.parse(m[1]);
      if (typeof chunk[1] === 'string') text += chunk[1];
    } catch { /* not a data chunk */ }
  }
  return text;
}

// The JSON object starting at `from` (counting braces outside strings).
function objectAt(text, from) {
  let depth = 0, inString = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(from, i + 1);
  }
  return null;
}

// "Sprint, 7,5 km (Kvinner)" -> { cat: 'SW', disc: 'SP' }; "Mikset Stafett" -> { cat: 'MX', disc: 'RL' };
// "Vinterstudion" -> null.
export function raceOf(title) {
  const t = String(title ?? '').toLowerCase();
  if (/enkel[- ]?mikset|single mixed/.test(t)) return { cat: 'MX', disc: 'SR' };
  if (/mikset|mixed/.test(t) && /stafett|relay/.test(t)) return { cat: 'MX', disc: 'RL' };
  const cat = /\(kvinner\)|\bkvinner\b|women/.test(t) ? 'SW' : /\(menn\)|\bmenn\b|\bmen\b/.test(t) ? 'SM' : null;
  const disc = /kort individuell|short individual/.test(t) ? 'SI' : /individuell|individual/.test(t) ? 'IN'
    : /sprint/.test(t) ? 'SP' : /jaktstart|pursuit/.test(t) ? 'PU' : /fellesstart|mass start/.test(t) ? 'MS' : /stafett|relay/.test(t) ? 'RL' : null;
  return cat && disc ? { cat, disc } : null;
}

// The biathlon races on a page: [{ start (ISO, UTC), cat, disc, title }], each once.
export function racesFromPage(html, league) {
  const text = nextData(html);
  const seen = new Set();
  const out = [];
  for (const m of text.matchAll(/\{"fixture_id":\d+,"fixture_slug"/g)) {
    let f;
    try { f = JSON.parse(objectAt(text, m.index) ?? ''); } catch { continue; }
    if (f?.league_id !== league || seen.has(f.fixture_id)) continue;
    const race = raceOf(f.title);
    const start = Date.parse(f.date);
    if (!race || !Number.isFinite(start)) continue;
    seen.add(f.fixture_id);
    out.push({ start: new Date(start).toISOString(), ...race, title: String(f.title).replace(/(\d),(\d)/g, '$1.$2') }); // "Sprint, 7.5 km (Kvinner)"
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

// One page per series a run (remembered), or [] on any failure.
const cache = new Map();
export function timesFor(series) {
  const page = PAGES[series];
  if (!page) return Promise.resolve([]);
  if (!cache.has(series)) {
    cache.set(series, getText(page.url, { gapMs: 1000, retries: 1 })
      .then((html) => racesFromPage(html, page.league))
      .catch((err) => { console.log(`TV-kampen ${series}: ${err.message} (start times from IBU and Wikipedia instead)`); return []; }));
  }
  return cache.get(series);
}
