// Shared helpers for all scorers.

import { createHash } from 'node:crypto';
import * as WEIGHTS from './weights.mjs';

// Each sport has its own version, so changing one sport doesn't re-fetch the
// others (F1 is slow to re-fetch). Bump a sport's number in FORMULA_VERSIONS
// when its formula changes. Changing a number in weights.mjs re-scores that
// sport by itself: the version includes a fingerprint of its weights, like "10.3fa2c1d0".
// Also bump it when the published fields change (football 11: line-ups), so older events get them.
// Football 12: upsets on penalties. Winter 2: run-1 order counts skiers who went out in run 2.
const FORMULA_VERSIONS = { football: 12, tennis: 9, f1: 10, winter: 2 };
const SPORT_WEIGHTS = {
  football: WEIGHTS.FOOTBALL,
  tennis: WEIGHTS.TENNIS,
  f1: { race: WEIGHTS.F1, qualifying: WEIGHTS.F1_QUALIFYING },
  winter: { biathlon: WEIGHTS.BIATHLON, alpine: WEIGHTS.ALPINE, crossCountry: WEIGHTS.CROSS_COUNTRY },
};
export const fingerprint = (x) => createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 8);
export const SCORING_VERSIONS = Object.fromEntries(
  Object.entries(FORMULA_VERSIONS).map(([sport, n]) => [sport, `${n}.${fingerprint(SPORT_WEIGHTS[sport])}`]),
);

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round1 = (x) => Math.round(x * 10) / 10;
// A score that isn't a number would be published as "null": refuse it, so the event is skipped.
export function finalScore(x) {
  if (!Number.isFinite(x)) throw new Error(`score is not a number (${x})`);
  return round1(clamp(x, 0, 10));
}

// Adds up a score and remembers why, for the "Why this score?" spoiler button.
export function tally() {
  let total = 0;
  const reasons = [];
  return {
    add(points, label) {
      if (!Number.isFinite(points)) { // a missing fact: leave this line out rather than break the score
        console.log(`::warning::scoring: "${label}" is not a number (${points}), left out`);
        return;
      }
      total += points;
      if (round1(points)) reasons.push([round1(points), label]); // no "+0.0" lines
    },
    get total() { return total; },
    reasons,
  };
}

const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export { plural };
export const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

// Raw action per segment -> a coarse 0–3 "heat" level for the strip on each card.
// Levels are relative to the busiest block, but `floor` sets how much action a block
// needs before it can be the hottest colour (otherwise a dull 0–0 looks red-hot somewhere).
export function heat(values, { floor = 0.001 } = {}) {
  const max = Math.max(...values, floor);
  return values.map((v) => (v <= 0.05 ? 0 : v < max * 0.34 ? 1 : v < max * 0.67 ? 2 : 3));
}

// Finds stretches worth skipping: runs of quiet slots (value <= quiet) inside
// [from, to). Each run stops `lead` slots before the action that ends it, so
// you get a little build-up, and must still be at least `minLen` slots long.
// Returns up to `max` runs as [start, end) slot indexes, longest kept, in order.
export function quietRuns(values, { quiet, from = 0, to = values.length, minLen, lead = 1, max = 3 }) {
  const runs = [];
  let i = from;
  while (i < to) {
    if (values[i] > quiet) { i++; continue; }
    let j = i;
    while (j < to && values[j] <= quiet) j++;
    const end = j < to ? j - lead : j; // action follows: resume a little early
    if (end - i >= minLen) runs.push([i, end]);
    i = j;
  }
  return runs.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0])).slice(0, max).sort((a, b) => a[0] - b[0]);
}
