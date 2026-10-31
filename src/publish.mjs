// The spoiler guard. Everything published to the website goes through here,
// and only the fields listed below can get out. Results, goal minutes, set
// scores, winners and match length never leave the build script.

import { readFileSync } from 'node:fs';
import { SCORING_VERSIONS } from './scoring/common.mjs';
import { FORECASTS, OUTLOOKS, STAKES } from './prematch.mjs';

const rights = JSON.parse(readFileSync(new URL('./rights/norway.json', import.meta.url)));

export const ADVICE_CODES = ['full', 'highlights', 'skip', 'watch'];
const UNITS = ['min', 'lap', 'set', 'stage', 'leg', 'run', 'bib']; // stage, leg: biathlon; run: alpine; bib: winter

// ctx { country, series, start } is used by entries with rules (winter sports):
// the first rule whose conditions all match decides, otherwise `services`.
export function servicesFor(rightsKey, ctx = {}) {
  const entry = rights.competitions[rightsKey];
  if (!entry) return [];
  const rule = (entry.rules ?? []).find((r) =>
    (!r.country || r.country === ctx.country)
    && (!r.series || r.series === ctx.series)
    && (!r.before || (ctx.start && ctx.start < r.before)));
  return (rule ?? entry).services;
}

function cleanAdvice(a) {
  if (!ADVICE_CODES.includes(a?.code)) throw new Error(`Unknown advice code: ${a?.code}`);
  if (a.code !== 'skip' && a.code !== 'watch') return { code: a.code };
  if (!UNITS.includes(a.unit)) throw new Error(`Unknown advice unit: ${a.unit}`);
  const ranges = a.ranges.slice(0, 3).map(([from, to]) => [Math.round(from), Math.round(to)]);
  // Watch tips: bibs to watch; alpine two-run races also `last` (run-2 starters), and no run-1 bibs means skip run 1.
  if (a.code === 'watch') return a.unit === 'run' ? { code: 'watch', unit: 'run', ranges, last: Math.round(a.last) } : { code: 'watch', unit: a.unit, ranges };
  return { code: 'skip', unit: a.unit, ranges };
}

function base(id, sport, comp, compName, start, scored, rightsKey, ctx) {
  return {
    id,
    sport,
    comp,
    compName,
    start,
    score: scored.score, // null: unrated (F1 qualifying)
    segments: scored.segments.map((s) => Math.max(0, Math.min(3, s | 0))),
    advice: scored.score == null ? null : cleanAdvice(scored.advice),
    services: servicesFor(rightsKey, ctx),
    v: SCORING_VERSIONS[sport],
  };
}

// Starting line-ups and benches (from lineupsFromSummary). Not a spoiler: they're
// announced before kick-off. Only the formation, each starter's shirt number, name
// and position, and the bench's numbers and names are copied: no substitutions, cards or goals.
export function lineupFields(lineups) {
  if (!lineups) return {};
  return {
    lineups: lineups.slice(0, 2).map((t) => ({
      formation: /^\d(-\d){1,4}$/.test(t.formation) ? t.formation : '',
      players: t.players.slice(0, 11).map(([n, name, pos]) => [
        /^\d{1,3}$/.test(n) ? n : '', String(name), /^[A-Z]{1,3}(-[LR])?$/.test(pos) && pos !== 'SUB' ? pos : ''],
      ),
      bench: (t.bench ?? []).slice(0, 15).map(([n, name]) => [/^\d{1,3}$/.test(n) ? n : '', String(name)]),
    })),
  };
}

// What was at stake before kick-off ('title', 'relegation', …; see prematch.mjs), frozen
// then and kept on the replay: it describes the table before the match, so it's no spoiler.
const stakesField = (stakes) => (stakes in STAKES ? { stakes } : {});

// The forecast ('even', 'lively', 'one-sided') is for upcoming matches only. On a
// replay, "looked one-sided" next to a score would hint at an upset. Raw odds never get out.
const forecastField = (forecast) => (FORECASTS.includes(forecast) ? { forecast } : {});
// The outlook ('promising', 'quiet') is for upcoming matches only too: "predicted quiet" next to a
// high score would give away an upset.
const outlookField = (outlook) => (OUTLOOKS.includes(outlook) ? { outlook } : {});
// The win chances from the odds before kick-off, as whole percentages [home, draw, away], for
// the "Show win chances" setting (the owner asked for them). Upcoming only, like the forecast,
// and frozen at kick-off (the live odds follow the score).
// A published entry's chances back into { home, draw, away }, to copy them after kick-off.
export const chancesOf = (e) => (e?.chances ? { home: e.chances[0] / 100, draw: e.chances[1] / 100, away: e.chances[2] / 100 } : null);
function chancesField(c) {
  if (![c?.home, c?.draw, c?.away].every((x) => Number.isFinite(x) && x >= 0 && x <= 1)) return {};
  return { chances: [c.home, c.draw, c.away].map((x) => Math.round(100 * x)) };
}

// `limited: true` when the score had no xG to go on (FotMob had none or was down): the card says so.
export const publishFootball = (comp, match, scored, { lineups, stakes } = {}) => ({
  ...base(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, scored, comp.key),
  teams: [match.home, match.away],
  ...lineupFields(lineups),
  ...stakesField(stakes),
  ...(scored.limited ? { limited: true } : {}),
});

// The match facts behind a football score, for "Custom scoring" and "Calibration mode" on the
// page: docs/data/facts.json, which the page downloads only after a warning (like reasons.json).
// Spoilers by nature (goal minutes and sides, so the result), but no names and no text: just what
// scoreFootball needs, at full precision so the page's score equals the bot's. Shot-by-shot lists
// are left out (they only feed the strip and the skip tips, which stay the bot's).
const num = (x) => (Number.isFinite(x) ? x : undefined); // left out when missing, like NaN for the scorer
const minutes = (a) => (Array.isArray(a) ? a.filter(Number.isFinite) : []);
const SIDES = ['home', 'away'];
const pair = (p) => (p && Number.isFinite(p.home) && Number.isFinite(p.away) ? { home: p.home, away: p.away } : null);
export function trimFacts(f) {
  return {
    goals: (f.goals ?? []).filter((g) => Number.isFinite(g.min) && SIDES.includes(g.side)).map((g) => ({
      min: g.min, side: g.side, ...(g.own ? { own: true } : {}), ...(g.pen ? { pen: true } : {}),
      ...(/^\d{1,3}(\+\d{1,2})?'$/.test(g.clock ?? '') ? { clock: g.clock } : {}),
    })),
    odds: f.odds && ['home', 'draw', 'away'].every((k) => Number.isFinite(f.odds[k])) ? { home: f.odds.home, draw: f.odds.draw, away: f.odds.away } : null,
    reds: minutes(f.reds), pens: minutes(f.pens), disallowed: minutes(f.disallowed), woodwork: minutes(f.woodwork),
    ...(Array.isArray(f.redsBy) ? { redsBy: f.redsBy.filter((r) => Number.isFinite(r?.min) && SIDES.includes(r.side)).map((r) => ({ min: r.min, side: r.side })) } : {}),
    ...(Array.isArray(f.stoppage) && f.stoppage.length === 2 && f.stoppage.every((m) => Number.isFinite(m) && m >= 0 && m <= 20) ? { stoppage: [...f.stoppage] } : {}),
    ...(pair(f.passes) ? { passes: pair(f.passes) } : {}),
    ...(Array.isArray(f.xg?.bangers) ? { bangers: minutes(f.xg.bangers) } : {}),
    ...(Array.isArray(f.xg?.bigMisses) ? { bigMisses: minutes(f.xg.bigMisses) } : {}),
    corners: num(f.corners), yellows: num(f.yellows), shotsOnTarget: num(f.shotsOnTarget), totalShots: num(f.totalShots),
    shotsBy: pair(f.shotsBy),
    extraTime: f.extraTime === true, shootout: f.shootout === true,
    shootoutWinner: SIDES.includes(f.shootoutWinner) ? f.shootoutWinner : null,
    ...(f.stakes in STAKES ? { stakes: f.stakes } : {}),
    xg: pair(f.xg),
    stats: f.stats ? Object.fromEntries(['bigChances', 'xgot', 'touchesInBox'].map((k) => [k, pair(f.stats[k])]).filter(([, v]) => v)) : null,
    strength: pair(f.strength),
  };
}

// Players are sorted by name: ESPN tends to list the winner second.
export const publishTennis = (match, scored) => ({
  ...base(`tn-${match.espnId}`, 'tennis', match.comp ?? 'tennis.slam', match.tournament, match.start, scored, match.comp ?? 'tennis.slam'),
  players: [...match.players].sort((a, b) => a.localeCompare(b)),
  draw: match.draw,
  round: match.round,
});

// F1 Grand Prix races have no session field; qualifying, sprints and sprint
// qualifying are marked with session: 'qualifying' | 'sprint' | 'sprint-qualifying'.
const f1Session = (race) => (race.session && race.session !== 'race' ? { session: race.session } : {});

export const publishF1 = (race, scored) => ({
  ...base(`f1-${race.sessionKey}`, 'f1', 'f1', race.name, race.start, scored, 'f1'),
  circuit: race.circuit,
  ...f1Session(race),
});

// Winter sports: biathlon, alpine and cross-country races. No athlete names:
// start lists (pursuit order, mass start fields, run-2 order) give earlier results away.
// The strip has a fixed length per race type, whatever happened.
export function winterSegments(race, segments) {
  const n = race.comp === 'biathlon'
    ? (/relay/i.test(race.name) ? 4 : /sprint/i.test(race.name) ? 3 : 5)
    : race.comp === 'alpine' && /slalom/i.test(race.name) ? 2 : 0;
  return Array.from({ length: n }, (_, i) => segments[i] ?? 0);
}

const winterFields = (race) => ({ race: race.name, place: race.place, series: race.series, gender: race.gender });
const winterCtx = (race) => ({ country: race.country, series: race.series, start: race.start });

export const publishWinter = (race, compName, scored) => ({
  ...base(race.id, 'winter', race.comp, compName, race.start, { ...scored, segments: winterSegments(race, scored.segments) }, race.comp, winterCtx(race)),
  ...winterFields(race),
});

// Direct links to the match on a service (found by src/sources/links.mjs, kept in state.links).
// Only known services, only their own web addresses, and never a highlights or clips page.
// Replays start playing straight away (nothing to browse, nothing to spoil); upcoming and live
// matches open the match page. `partner=primetime` makes iPhones open the TV 2 app.
export const LINK_HOSTS = { tv2play: 'https://play.tv2.no/sport/', viaplay: 'https://viaplay.no/sport/', nrk: 'https://tv.nrk.no/se?v=' };
const NOT_THE_MATCH = /klipp|h(o|oe|ø)ydepunkt|highlight|sammendrag|goals|maal|mål/i;
export function linkFields(stored, { replay, now = Date.now() } = {}) {
  const links = {};
  for (const [service, link] of Object.entries(stored ?? {})) {
    const url = link?.url;
    if (!LINK_HOSTS[service] || typeof url !== 'string' || !url.startsWith(LINK_HOSTS[service]) || NOT_THE_MATCH.test(url)) continue;
    if (link.until && Date.parse(link.until) < now) continue; // Viaplay keeps a match for about 2 days
    const u = new URL(url);
    if (service === 'tv2play') {
      u.searchParams.set('partner', 'primetime');
      if (replay) u.searchParams.set('play', 'true');
    }
    if (service === 'nrk' && replay) u.searchParams.set('autoplay', 'true');
    links[service] = u.href;
  }
  return Object.keys(links).length ? { links } : {};
}

// Rights entries that run out within `days` days (or already have).
export function expiringRights(now = new Date(), days = 60) {
  return Object.entries(rights.competitions)
    .filter(([, r]) => new Date(r.validTo).getTime() - now.getTime() < days * 864e5)
    .map(([key, r]) => `${key} (valid to ${r.validTo})`);
}

// Upcoming and live events: when and where to watch, no score of any kind.
const upcomingBase = (id, sport, comp, compName, start, live, rightsKey, ctx) => ({
  id, sport, comp, compName, start, status: live ? 'live' : 'upcoming', services: servicesFor(rightsKey, ctx),
});

export const upcomingWinter = (race, compName) => ({
  ...upcomingBase(race.id, 'winter', race.comp, compName, race.start, race.live, race.comp, winterCtx(race)),
  ...winterFields(race),
});

// While a match is on: the clock as the bot read it (`at`: when), the "Excitement so far" number
// (the fallback for when the page can't ask ESPN itself; see docs/live.js) and the big-match
// factor the page needs to work that number out. No score, no leader. Live matches only.
export function liveFields({ clock, at, pace, factor } = {}) {
  const out = {};
  if (clock && Number.isInteger(clock.min) && clock.min >= 0 && clock.min <= 130 && [1, 2, 3, 4, 5].includes(clock.period)
    && typeof clock.paused === 'boolean' && Number.isFinite(Date.parse(at))) {
    out.clock = { min: clock.min, plus: Number.isInteger(clock.plus) && clock.plus >= 0 && clock.plus <= 30 ? clock.plus : 0, period: clock.period, paused: clock.paused, at: new Date(at).toISOString() };
  }
  if (Number.isFinite(pace?.pace) && pace.pace >= 0 && pace.pace <= 10) {
    out.pace = Math.round(pace.pace * 10) / 10;
    if (pace.rough) out.rough = true;
  }
  if (Number.isFinite(factor) && factor >= 0.5 && factor <= 1.5) out.factor = Math.round(factor * 100) / 100;
  return out;
}

export const upcomingFootball = (comp, match, { lineups, stakes, forecast, outlook, chances, live } = {}) => ({
  ...upcomingBase(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, match.state === 'in', comp.key),
  teams: [match.home, match.away],
  ...lineupFields(lineups),
  ...stakesField(stakes),
  ...forecastField(forecast),
  ...outlookField(outlook),
  ...chancesField(chances),
  ...(match.state === 'in' ? liveFields(live) : {}),
});

export const upcomingTennis = (match) => ({
  ...upcomingBase(`tn-${match.espnId}`, 'tennis', match.comp ?? 'tennis.slam', match.tournament, match.start, match.live, match.comp ?? 'tennis.slam'),
  players: [...match.players].sort((a, b) => a.localeCompare(b)),
  draw: match.draw,
  round: match.round,
});

export const upcomingF1 = (race) => ({
  ...upcomingBase(`f1-${race.sessionKey}`, 'f1', 'f1', race.name, race.start, race.live, 'f1'),
  circuit: race.circuit,
  ...f1Session(race),
});
