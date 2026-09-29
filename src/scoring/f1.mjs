// F1 watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromRace() in src/sources/openf1.mjs.

import { finalScore, heat, quietRuns, tally, plural, times } from './common.mjs';
import { F1 as W, F1_QUALIFYING as Q } from './weights.mjs';

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
  t.add(Math.min(W.top5Overtake * (top5.length / share), 1.5), `${plural(top5.length, 'overtake')} for a top-5 place`);
  t.add(W.leadChange * Math.min(f.leadChanges.length, 3), `The lead changed ${times(f.leadChanges.length)}`);
  const neutralised = [
    f.safetyCars.length && plural(f.safetyCars.length, 'safety car'),
    f.vscs.length && plural(f.vscs.length, 'virtual safety car'),
    f.redFlags.length && plural(f.redFlags.length, 'red flag'),
  ].filter(Boolean).join(', ');
  t.add(Math.min(W.safetyCar * f.safetyCars.length + W.virtualSafetyCar * f.vscs.length + W.redFlag * f.redFlags.length, W.neutralisedMax), neutralised);
  const gap = f.gapP2 == null ? null : f.gapP2 / share;
  if (gap != null) t.add(gap < 1 ? W.finishUnder1s : gap < 3 ? W.finishUnder3s : gap < 10 ? W.finishUnder10s : 0, `Won by ${f.gapP2.toFixed(1)} s`);
  t.add(Math.min(W.retirement * f.dnfs, 1), plural(f.dnfs, 'retirement'));
  if (f.rain) t.add(W.rain, 'Rain during the race');
  const lateFrom = f.totalLaps * 0.8;
  if (top5.some((o) => o.lap > lateFrom) || f.leadChanges.some((l) => l > lateFrom)) t.add(W.lateFight, 'Fights at the front in the last laps');

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

  return { score, segments: heat(values), advice: f1Advice(score, perLap, f.totalLaps), reasons: t.reasons, result: f.result };
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

// Qualifying: a score, a strip of exactly 3 blocks (Q1, Q2, Q3) and skip advice.
// Input: the facts from factsFromQuali() in src/sources/openf1.mjs.
export function scoreQuali(f) {
  const t = tally();
  t.add(Q.base, 'Base');
  const g = f.poleGap;
  if (g != null) {
    t.add(g < 0.03 ? Q.poleUnder003 : g < 0.07 ? Q.poleUnder007 : g < 0.15 ? Q.poleUnder015 : g < 0.3 ? Q.poleUnder030 : 0, `Pole by ${g.toFixed(3)} s`);
  }
  const s10 = f.top10Spread;
  if (s10 != null) {
    t.add(s10 < 0.6 ? Q.tightTop10 : s10 < 0.9 ? Q.closeTop10 : s10 < 1.2 ? Q.fairlyCloseTop10 : 0, `Top 10 within ${s10.toFixed(2)} s in Q3`);
  }
  t.add(Math.min(Q.poleChange * f.poleChanges, 2), `Provisional pole changed hands ${times(f.poleChanges)} in Q3`);
  t.add(Math.min(Q.latePoleChange * f.latePoleChanges, 1.5), `${times(f.latePoleChanges)} in the last 4 minutes`);
  const cut = (m) => (m == null ? 0 : m < 0.02 ? Q.knifeEdgeCut : m < 0.05 ? Q.closeCut : 0);
  t.add(cut(f.q1Cut), `Knocked out of Q1 by ${f.q1Cut?.toFixed(3)} s`);
  t.add(cut(f.q2Cut), `Knocked out of Q2 by ${f.q2Cut?.toFixed(3)} s`);
  t.add(Math.min(Q.redFlag * f.redFlags.length, 2.5), plural(f.redFlags.length, 'red flag'));
  if (f.redFlags.includes(3)) t.add(Q.redFlagInQ3, 'A red flag in Q3');
  t.add(Math.min(Q.deletedLapQ3 * f.deletedLaps[2], 0.9), `${plural(f.deletedLaps[2], 'lap')} deleted in Q3`);
  if (f.rain) t.add(Q.rain, 'Rain during the session');
  const score = finalScore(t.total);

  // How much happened in each part. Q3 is where pole is decided, so it's never skipped.
  const parts = [1, 2, 3].map((q) => 2 * f.redFlags.filter((x) => x === q).length + Math.min(0.1 * f.deletedLaps[q - 1], 0.5));
  parts[0] += 3 * cut(f.q1Cut);
  parts[1] += 3 * cut(f.q2Cut);
  parts[2] += 2 * (t.reasons.find(([, l]) => l.startsWith('Pole by'))?.[0] ?? 0) + f.poleChanges * 0.5 + f.latePoleChanges;
  return { score, segments: heat(parts), advice: qualiAdvice(score, parts), reasons: t.reasons, result: f.result };
}

// Skip Q1 and/or Q2 when little happened there; Q3 is always kept.
export function qualiAdvice(score, parts) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9) return { code: 'full' };
  const quiet = [0, 1].filter((i) => parts[i] < 1);
  if (!quiet.length) return { code: 'full' };
  return { code: 'skip', unit: 'part', ranges: quiet.length === 2 ? [[1, 2]] : [[quiet[0] + 1, quiet[0] + 1]] };
}
