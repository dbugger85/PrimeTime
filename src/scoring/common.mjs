// Shared helpers for all scorers.

import { createHash } from 'node:crypto';
import * as WEIGHTS from './weights.mjs';

// Bump FORMULA_VERSION when a scoring formula changes, so old events get re-scored.
// Changing a number in weights.mjs re-scores by itself: the version includes a
// fingerprint of the weights, like "9.3fa2c1d0".
const FORMULA_VERSION = 9;
const fingerprint = createHash('sha1').update(JSON.stringify(WEIGHTS)).digest('hex').slice(0, 8);
export const SCORING_VERSION = `${FORMULA_VERSION}.${fingerprint}`;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round1 = (x) => Math.round(x * 10) / 10;
export const finalScore = (x) => round1(clamp(x, 0, 10));

// Adds up a score and remembers why, for the "Why this score?" spoiler button.
export function tally() {
  let total = 0;
  const reasons = [];
  return {
    add(points, label) {
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
export function heat(values) {
  const max = Math.max(...values, 0.001);
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
