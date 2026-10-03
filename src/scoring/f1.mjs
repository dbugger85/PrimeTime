// F1 watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromRace() in src/sources/openf1.mjs.

import { finalScore, heat, quietRuns, tally, plural } from './common.mjs';
import { F1 as W } from './weights.mjs';

const SEGMENTS = 10; // equal slices of the race, so the strip doesn't reveal the lap count

// A sprint is about a third of a Grand Prix (100 km instead of 300), so its
// overtakes count three times and its winning-margin limits are a third as big.
// Without that, every sprint would look dull next to a full race.
const SPRINT_SHARE = 1 / 3;

export function scoreF1(f, { sprint = false } = {}) {
  const share = sprint ? SPRINT_SHARE : 1;
  const top5 = f.overtakes.filter((o) => o.position <= 5);
  const t = tally();
  t.add(W.base, 'Base');

  t.add((Math.min(f.overtakes.length / share, 60) / 60) * W.overtakes, `${plural(f.overtakes.length, 'overtake')} on track (pit stops not counted)`);
  t.add(Math.min(W.top5Overtake * (top5.length / share), W.top5OvertakesMax), `${plural(top5.length, 'overtake')} for a top-5 place`);
  // Fights for the top 3: lead changes and passes for 2nd and 3rd count the same, so the
  // score doesn't depend on whether the leader (often the pole-sitter) stayed in front.
  const front = f.leadChanges.length + f.overtakes.filter((o) => o.position === 2 || o.position === 3).length;
  t.add(Math.min(W.frontFight * front, W.frontFightsMax), `${plural(front, 'pass', 'passes')} for a top-3 place`);
  const neutralised = [
    f.safetyCars.length && plural(f.safetyCars.length, 'safety car'),
    f.vscs.length && plural(f.vscs.length, 'virtual safety car'),
    f.redFlags.length && plural(f.redFlags.length, 'red flag'),
  ].filter(Boolean).join(', ');
  t.add(Math.min(W.safetyCar * f.safetyCars.length + W.virtualSafetyCar * f.vscs.length + W.redFlag * f.redFlags.length, W.neutralisedMax), neutralised);
  const gap = f.gapP2 == null ? null : f.gapP2 / share;
  if (gap != null) t.add(gap < 1 ? W.finishUnder1s : gap < 3 ? W.finishUnder3s : gap < 10 ? W.finishUnder10s : 0, `Won by ${f.gapP2.toFixed(1)} s`);
  t.add(Math.min(W.retirement * f.dnfs, W.retirementsMax), plural(f.dnfs, 'retirement'));
  if (f.rain) t.add(W.rain, 'Rain during the race');
  const lateFrom = f.totalLaps * 0.8;
  if (top5.some((o) => o.lap > lateFrom) || f.leadChanges.some((l) => l > lateFrom)) t.add(W.lateFight, 'Fights at the front in the last laps');

  const score = finalScore(t.total);

  const perLap = new Array(f.totalLaps + 1).fill(0);
  const add = (lap, w) => { perLap[Math.min(Math.max(lap, 1), f.totalLaps)] += w; };
  // A pass for the lead weighs like any top-5 pass, so the strip doesn't point at it. Lead changes
  // come from the lap-by-lap order (OpenF1's overtakes miss some), so its overtakes for 1st are skipped.
  f.overtakes.forEach((o) => o.position > 1 && add(o.lap, o.position <= 5 ? 2 : 1));
  f.leadChanges.forEach((l) => add(l, 2));
  f.safetyCars.forEach((l) => add(l, 3));
  f.vscs.forEach((l) => add(l, 1.5));
  f.redFlags.forEach((l) => add(l, 4));

  const values = new Array(SEGMENTS).fill(0);
  for (let lap = 1; lap <= f.totalLaps; lap++) {
    values[Math.min(SEGMENTS - 1, Math.floor(((lap - 1) / f.totalLaps) * SEGMENTS))] += perLap[lap];
  }

  return { score, segments: heat(values), advice: f1Advice(score, perLap, f.totalLaps, { redFlag: f.redFlags.length > 0 }), reasons: t.reasons, result: f.result };
}

// Skip windows in laps. The start (laps 1–3) and the last 15% of the race are
// always kept: a tip must not hint at whether the finish was exciting.
// After a red flag there are no windows: the race may have been cut short, and
// "the last 15%" of the laps actually driven would hint at how many there were.
export function f1Advice(score, perLap, totalLaps, { redFlag = false } = {}) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9) return { code: 'full' };
  if (redFlag) return { code: score >= 5 ? 'full' : 'highlights' };
  const to = Math.floor(totalLaps * 0.85) + 1; // perLap[0] is unused, lap n is index n
  const minLen = Math.max(5, Math.round(totalLaps * (score >= 7 ? 0.15 : 0.1)));
  const runs = quietRuns(perLap, { quiet: 1, from: 4, to, minLen, lead: 1 });
  if (!runs.length) return { code: 'full' };
  return { code: 'skip', unit: 'lap', ranges: runs.map(([a, b]) => [a, b - 1]) }; // laps a..b-1 inclusive
}

// Qualifying is published without a score, strip or tips: the owner found that how
// exciting qualifying was gives the grid away. Only the result is kept, for "Show the result".
export function scoreQuali(f) {
  return { score: null, segments: [], advice: null, reasons: [], result: f.result };
}
