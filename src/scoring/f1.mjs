// F1 watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromRace() in src/sources/openf1.mjs.

import { finalScore, heat, quietRuns, tally, plural, times } from './common.mjs';

const SEGMENTS = 10; // equal slices of the race, so the strip doesn't reveal the lap count

export function scoreF1(f) {
  const top5 = f.overtakes.filter((o) => o.position <= 5);
  const t = tally();
  t.add(1.0, 'Base');

  t.add((Math.min(f.overtakes.length, 60) / 60) * 3, `${plural(f.overtakes.length, 'overtake')} on track (pit stops not counted)`);
  t.add(Math.min(0.1 * top5.length, 1.5), `${plural(top5.length, 'overtake')} for a top-5 place`);
  t.add(Math.min(0.8 * f.leadChanges.length, 2.4), `The lead changed ${times(f.leadChanges.length)}`);
  const neutralised = [
    f.safetyCars.length && plural(f.safetyCars.length, 'safety car'),
    f.vscs.length && plural(f.vscs.length, 'virtual safety car'),
    f.redFlags.length && plural(f.redFlags.length, 'red flag'),
  ].filter(Boolean).join(', ');
  t.add(Math.min(0.7 * f.safetyCars.length + 0.3 * f.vscs.length + 1.0 * f.redFlags.length, 2.5), neutralised);
  if (f.gapP2 != null) t.add(f.gapP2 < 1 ? 1.5 : f.gapP2 < 3 ? 1.0 : f.gapP2 < 10 ? 0.5 : 0, `Won by ${f.gapP2.toFixed(1)} s`);
  t.add(Math.min(0.2 * f.dnfs, 1), plural(f.dnfs, 'retirement'));
  if (f.rain) t.add(0.5, 'Rain during the race');
  const lateFrom = f.totalLaps * 0.8;
  if (top5.some((o) => o.lap > lateFrom) || f.leadChanges.some((l) => l > lateFrom)) t.add(0.5, 'Fights at the front in the last laps');

  const score = finalScore(t.total);

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

  return { score, segments: heat(values), advice: f1Advice(score, perLap, f.totalLaps), reasons: t.reasons };
}

// Skip windows in laps. The start (laps 1–3) and the last 15% of the race are
// always kept: a tip must not hint at whether the finish was exciting.
export function f1Advice(score, perLap, totalLaps) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9) return { code: 'full' };
  const to = Math.floor(totalLaps * 0.85) + 1; // perLap[0] is unused, lap n is index n
  const minLen = Math.max(5, Math.round(totalLaps * (score >= 7 ? 0.15 : 0.1)));
  const runs = quietRuns(perLap, { quiet: 1, from: 4, to, minLen, lead: 1 });
  if (!runs.length) return { code: 'full' };
  return { code: 'skip', unit: 'lap', ranges: runs.map(([a, b]) => [a, b - 1]) }; // laps a..b-1 inclusive
}
