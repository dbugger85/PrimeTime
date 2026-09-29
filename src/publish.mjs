// The spoiler guard. Everything published to the website goes through here,
// and only the fields listed below can get out. Results, goal minutes, set
// scores, winners and match length never leave the build script.

import { readFileSync } from 'node:fs';
import { SCORING_VERSIONS } from './scoring/common.mjs';

const rights = JSON.parse(readFileSync(new URL('./rights/norway.json', import.meta.url)));

export const ADVICE_CODES = ['full', 'highlights', 'skip'];
const UNITS = ['min', 'lap', 'set', 'part']; // part: Q1, Q2, Q3 of F1 qualifying

const servicesFor = (rightsKey) => rights.competitions[rightsKey]?.services ?? [];

function cleanAdvice(a) {
  if (!ADVICE_CODES.includes(a?.code)) throw new Error(`Unknown advice code: ${a?.code}`);
  if (a.code !== 'skip') return { code: a.code };
  if (!UNITS.includes(a.unit)) throw new Error(`Unknown advice unit: ${a.unit}`);
  const ranges = a.ranges.slice(0, 3).map(([from, to]) => [Math.round(from), Math.round(to)]);
  return { code: 'skip', unit: a.unit, ranges };
}

function base(id, sport, comp, compName, start, scored, rightsKey) {
  return {
    id,
    sport,
    comp,
    compName,
    start,
    score: scored.score,
    segments: scored.segments.map((s) => Math.max(0, Math.min(3, s | 0))),
    advice: cleanAdvice(scored.advice),
    services: servicesFor(rightsKey),
    v: SCORING_VERSIONS[sport],
  };
}

export const publishFootball = (comp, match, scored) => ({
  ...base(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, scored, comp.key),
  teams: [match.home, match.away],
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

// Rights entries that run out within `days` days (or already have).
export function expiringRights(now = new Date(), days = 60) {
  return Object.entries(rights.competitions)
    .filter(([, r]) => new Date(r.validTo).getTime() - now.getTime() < days * 864e5)
    .map(([key, r]) => `${key} (valid to ${r.validTo})`);
}

// Upcoming and live events: when and where to watch, no score of any kind.
const upcomingBase = (id, sport, comp, compName, start, live, rightsKey) => ({
  id, sport, comp, compName, start, status: live ? 'live' : 'upcoming', services: servicesFor(rightsKey),
});

export const upcomingFootball = (comp, match) => ({
  ...upcomingBase(`fb-${match.espnId}`, 'football', comp.key, comp.name, match.start, match.state === 'in', comp.key),
  teams: [match.home, match.away],
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
