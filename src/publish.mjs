// The spoiler guard. Everything published to the website goes through here,
// and only the fields listed below can get out. Results, goal minutes, set
// scores, winners and match length never leave the build script.

import { readFileSync } from 'node:fs';
import { SCORING_VERSION } from './scoring/common.mjs';

const rights = JSON.parse(readFileSync(new URL('./rights/norway.json', import.meta.url)));

export const ADVICE_CODES = ['full', 'from', 'highlights', 'fromSet', 'startThen'];

const servicesFor = (rightsKey) => rights.competitions[rightsKey]?.services ?? [];

function cleanAdvice(a) {
  if (!ADVICE_CODES.includes(a?.code)) throw new Error(`Unknown advice code: ${a?.code}`);
  const out = { code: a.code };
  if (a.code === 'from') out.min = a.min;
  if (a.code === 'fromSet') out.set = a.set;
  if (a.code === 'startThen') out.lap = a.lap;
  return out;
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
    v: SCORING_VERSION,
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

export const publishF1 = (race, scored) => ({
  ...base(`f1-${race.sessionKey}`, 'f1', 'f1', race.name, race.start, scored, 'f1'),
  circuit: race.circuit,
});

// Rights entries that run out within `days` days (or already have).
export function expiringRights(now = new Date(), days = 60) {
  return Object.entries(rights.competitions)
    .filter(([, r]) => new Date(r.validTo).getTime() - now.getTime() < days * 864e5)
    .map(([key, r]) => `${key} (valid to ${r.validTo})`);
}
