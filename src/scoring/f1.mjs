// F1 watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromRace() in src/sources/openf1.mjs.

import { finalScore, heat, firstWorthWatching } from './common.mjs';

const SEGMENTS = 10; // equal slices of the race, so the strip doesn't reveal the lap count

export function scoreF1(f) {
  const top5 = f.overtakes.filter((o) => o.position <= 5);
  let s = 1.0;

  s += (Math.min(f.overtakes.length, 60) / 60) * 3;
  s += Math.min(0.1 * top5.length, 1.5);
  s += Math.min(0.8 * f.leadChanges.length, 2.4);
  s += Math.min(0.7 * f.safetyCars.length + 0.3 * f.vscs.length + 1.0 * f.redFlags.length, 2.5);
  if (f.gapP2 != null) s += f.gapP2 < 1 ? 1.5 : f.gapP2 < 3 ? 1.0 : f.gapP2 < 10 ? 0.5 : 0;
  s += Math.min(0.2 * f.dnfs, 1);
  if (f.rain) s += 0.5;
  const lateFrom = f.totalLaps * 0.8;
  if (top5.some((o) => o.lap > lateFrom) || f.leadChanges.some((l) => l > lateFrom)) s += 0.5;

  const score = finalScore(s);

  const perLap = new Array(f.totalLaps + 1).fill(0);
  const add = (lap, w) => { perLap[Math.min(Math.max(lap, 1), f.totalLaps)] += w; };
  f.overtakes.forEach((o) => add(o.lap, o.position <= 5 ? 2 : 1));
  f.leadChanges.forEach((l) => add(l, 3));
  f.safetyCars.forEach((l) => add(l, 3));
  f.vscs.forEach((l) => add(l, 1.5));
  f.redFlags.forEach((l) => add(l, 4));

  const values = new Array(SEGMENTS).fill(0);
  for (let lap = 1; lap <= f.totalLaps; lap++) {
    values[Math.min(SEGMENTS - 1, Math.floor(((lap - 1) / f.totalLaps) * SEGMENTS))] += perLap[lap];
  }

  return { score, segments: heat(values), advice: f1Advice(score, perLap) };
}

// The start (laps 1–3) is always worth watching; after that, skip the quiet stretch.
export function f1Advice(score, perLap) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 7.5) return { code: 'full' };
  const afterStart = perLap.slice(4); // index 0 = lap 4
  const lap = Math.floor((firstWorthWatching(afterStart) + 4) / 5) * 5;
  return lap <= 10 ? { code: 'full' } : { code: 'startThen', lap };
}
