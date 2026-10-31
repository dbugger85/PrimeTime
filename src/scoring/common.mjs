// Shared helpers for all scorers.

import { createHash } from 'node:crypto';
import * as WEIGHTS from './weights.mjs';

// Each sport has its own version, so changing one sport doesn't re-fetch the
// others (F1 is slow to re-fetch). Bump a sport's number in FORMULA_VERSIONS
// when its formula changes. Changing a number in weights.mjs re-scores that
// sport by itself: the version includes a fingerprint of its weights, like "10.3fa2c1d0".
// Also bump it when the published fields change (football 11: line-ups), so older events get them.
// Football 12: upsets on penalties. Winter 2: run-1 order counts skiers who went out in run 2.
// Winter 3: "Watch bibs 1–20" tips (bibs of the top 3) and run-2 "last 15 starters".
// Football 13: xG (optional, from FotMob), and points above 7 count less. 14: "xG" in the reasons.
// Football 15: the one-sided penalty no longer grows with the margin.
// Football 16: big match (team Elo ratings, `strength`), and a smooth curve instead of "points above 7 count less".
// Football 17: FotMob team stats (touches in the box, big chances, xG on target), a lighter one-sided
//   penalty, and the big-match factor cuts weak pairs more than it lifts strong ones (`smallMatch`).
//   Also "end to end" (shots per team), late goals that change the result, and a stricter curve.
// Football 18: the match facts are published (docs/data/facts.json) for custom scoring on the page; scores unchanged.
// F1 11: qualifying unrated; lead changes count like other top-3 passes, and not at the start.
const FORMULA_VERSIONS = { football: 21, tennis: 9, f1: 11, winter: 3 };
const SPORT_WEIGHTS = {
  football: WEIGHTS.FOOTBALL,
  tennis: WEIGHTS.TENNIS,
  f1: WEIGHTS.F1,
  winter: { biathlon: WEIGHTS.BIATHLON, alpine: WEIGHTS.ALPINE, crossCountry: WEIGHTS.CROSS_COUNTRY },
};
export const fingerprint = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 8);
export const SCORING_VERSIONS = Object.fromEntries(
  Object.entries(FORMULA_VERSIONS).map(([sport, n]) => [sport, `${n}.${fingerprint(SPORT_WEIGHTS[sport])}`]),
);

// The general helpers are shared with the page (docs/scoring.js has no node:crypto).
export { clamp, round1, finalScore, tally, plural, times, heat, quietRuns } from '../../docs/scoring.js';
