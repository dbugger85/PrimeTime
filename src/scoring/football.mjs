// Football watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromSummary() in src/sources/espn-football.mjs.

import { finalScore, heat, firstWorthWatching } from './common.mjs';

const SEGMENTS = 6; // 15-minute blocks; extra time counts toward the last one

export function scoreFootball(f) {
  const goals = [...f.goals].sort((a, b) => a.min - b.min);
  const n = goals.length;
  const end = f.extraTime ? 120 : 90;
  let s = 0;

  // Goals: the first four count most.
  s += 1.2 * Math.min(n, 4) + 0.6 * Math.max(0, n - 4);

  // Balance and swings: walk through the match tracking the goal difference.
  let diff = 0, prevMin = 0, closeMinutes = 0, equalisers = 0, leadChanges = 0, leader = 0;
  for (const g of goals) {
    const min = Math.min(g.min, end);
    if (Math.abs(diff) <= 1) closeMinutes += min - prevMin;
    prevMin = min;
    diff += g.side === 'home' ? 1 : -1;
    if (diff === 0) equalisers++;
    const now = Math.sign(diff);
    if (now !== 0 && leader !== 0 && now !== leader) leadChanges++;
    if (now !== 0) leader = now;
  }
  if (Math.abs(diff) <= 1) closeMinutes += end - prevMin;
  s += 2.0 * (closeMinutes / end);
  if (Math.abs(diff) >= 3) s -= 1.5;
  s += 0.8 * equalisers + 1.0 * Math.min(leadChanges, 3);

  // Late drama.
  const late = goals.reduce((a, g) => a + (g.min >= 90 ? 1.0 : g.min >= 75 ? 0.5 : 0), 0);
  s += Math.min(late, 2.5);

  // Intensity.
  if (f.shotsOnTarget >= 10) s += 1.0;
  else if (f.shotsOnTarget >= 7) s += 0.5;
  if (f.totalShots >= 30) s += 0.5;
  if (n === 0 && f.shotsOnTarget <= 4) s -= 0.5;
  s += Math.min(0.6 * f.reds.length, 1.2);
  s += Math.min(0.3 * f.pens.length, 0.6);

  // Near misses and heat: goals ruled out by VAR, shots off the woodwork, lots of corners or bookings.
  s += Math.min(0.6 * f.disallowed.length, 1.2);
  s += Math.min(0.4 * f.woodwork.length, 1.2);
  if (f.corners >= 12) s += 0.3;
  s += f.yellows >= 9 ? 0.6 : f.yellows >= 6 ? 0.3 : 0;

  if (f.extraTime) s += 1.0;
  if (f.shootout) s += 1.5;

  const score = finalScore(s);

  // How much happened in each 15-minute block.
  const values = new Array(SEGMENTS).fill(0);
  const add = (min, w) => { values[Math.min(SEGMENTS - 1, Math.floor(min / 15))] += w; };
  goals.forEach((g) => add(g.min, 3));
  f.pens.forEach((m) => add(m, 1.5));
  f.reds.forEach((m) => add(m, 2));
  f.vars.forEach((m) => add(m, 1));
  f.disallowed.forEach((m) => add(m, 2));
  f.woodwork.forEach((m) => add(m, 1));
  f.shotsOn.forEach((m) => add(m, 0.4));
  f.shotsOff.forEach((m) => add(m, 0.15));

  return { score, segments: heat(values), advice: footballAdvice(score, values) };
}

export function footballAdvice(score, values) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 7.5) return { code: 'full' };
  const start = firstWorthWatching(values);
  if (start === 0) return { code: 'full' };
  // Never suggest starting later than 75' (that would hint something happened at the very end).
  return { code: 'from', min: Math.min(start, 5) * 15 };
}
