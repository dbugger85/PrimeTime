// Shared helpers for all scorers.

// Bump this when a scoring formula changes, so old events get re-scored.
export const SCORING_VERSION = 2;

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round1 = (x) => Math.round(x * 10) / 10;
export const finalScore = (x) => round1(clamp(x, 0, 10));

// Raw action per segment -> a coarse 0–3 "heat" level for the strip on each card.
export function heat(values) {
  const max = Math.max(...values, 0.001);
  return values.map((v) => (v <= 0.05 ? 0 : v < max * 0.34 ? 1 : v < max * 0.67 ? 2 : 3));
}

// Index of the first segment you should start watching at, so that
// everything skipped holds less than `share` of the total action.
export function firstWorthWatching(values, share = 0.2) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return 0;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (sum >= total * share) return i;
  }
  return 0;
}
