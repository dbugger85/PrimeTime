// The spoiler guard. Everything published to the website goes through here,
// and only the fields listed below can get out. Results, goal minutes, set
// scores, winners and match length never leave the build script.

import { readFileSync } from 'node:fs';
import { SCORING_VERSIONS } from './scoring/common.mjs';
import { FORECASTS, OUTLOOKS, STAKES } from './prematch.mjs';

const rights = JSON.parse(readFileSync(new URL('./rights/norway.json', import.meta.url)));

export const ADVICE_CODES = ['full', 'highlights', 'skip'];
const UNITS = ['min', 'lap', 'set', 'part', 'stage', 'leg', 'run']; // part: F1 qualifying; stage, leg: biathlon; run: alpine

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
  if (a.code !== 'skip') return { code: a.code };
  if (!UNITS.includes(a.unit)) throw new Error(`Unknown advice unit: ${a.unit}`);
  const ranges = a.ranges.slice(0, 3).map(([from, to]) => [Math.round(from), Math.round(to)]);
  return { code: 'skip', unit: a.unit, ranges };
}

function base(id, sport, comp, compName, start, scored, rightsKey, ctx) {
  return {
    id,
    sport,
    comp,
    compName,
    start,
    score: scored.score,
    segments: scored.segments.map((s) => Math.max(0, Math.min(3, s | 0))),
    advice: cleanAdvice(scored.advice),
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

// `limited: true` when the score had no xG to go on (FotMob had none or was down): the card says so.
export const publishFootball = (comp, match, scored, { lineups, stakes } = {}) => ({
  ...base(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, scored, comp.key),
  teams: [match.home, match.away],
  ...lineupFields(lineups),
  ...stakesField(stakes),
  ...(scored.limited ? { limited: true } : {}),
});

// Players are sorted by name: ESPN tends to list the winner second.
export const publishTennis = (match, scored) => ({
  ...base(`tn-${match.espnId}`, 'tennis', 'tennis.slam', match.tournament, match.start, scored, 'tennis.slam'),
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

export const upcomingFootball = (comp, match, { lineups, stakes, forecast, outlook } = {}) => ({
  ...upcomingBase(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, match.state === 'in', comp.key),
  teams: [match.home, match.away],
  ...lineupFields(lineups),
  ...stakesField(stakes),
  ...forecastField(forecast),
  ...outlookField(outlook),
});

export const upcomingTennis = (match) => ({
  ...upcomingBase(`tn-${match.espnId}`, 'tennis', 'tennis.slam', match.tournament, match.start, match.live, 'tennis.slam'),
  players: [...match.players].sort((a, b) => a.localeCompare(b)),
  draw: match.draw,
  round: match.round,
});

export const upcomingF1 = (race) => ({
  ...upcomingBase(`f1-${race.sessionKey}`, 'f1', 'f1', race.name, race.start, race.live, 'f1'),
  circuit: race.circuit,
  ...f1Session(race),
});
