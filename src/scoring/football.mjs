// Football watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromSummary() in src/sources/espn-football.mjs.

import { finalScore, heat, quietRuns, tally, plural, times } from './common.mjs';

const SEGMENTS = 6; // 15-minute blocks; extra time counts toward the last one

export function scoreFootball(f) {
  const goals = [...f.goals].sort((a, b) => a.min - b.min);
  const n = goals.length;
  const end = f.extraTime ? 120 : 90;
  const t = tally();

  // Goals: the first four count most.
  t.add(1.2 * Math.min(n, 4) + 0.6 * Math.max(0, n - 4), plural(n, 'goal'));

  // Team strength, from the pre-match odds. `gap` is how much likelier the
  // favorite was to win than the underdog: about 0 for an even match, 0.8 for
  // a big mismatch. Goals the favorite was expected to score count for less,
  // and the underdog's goals count for more.
  const odds = f.odds;
  const fav = odds ? (odds.home >= odds.away ? 'home' : 'away') : null;
  const gap = odds ? Math.abs(odds.home - odds.away) : 0;

  // Walk the goals in order: what each one's worth depends on the score when it went in.
  let lead = { home: 0, away: 0 }, decided = 0, decidedGoals = 0, favCut = 0, dogBonus = 0, counted = 0;
  for (const g of goals) {
    const worth = counted++ < 4 ? 1.2 : 0.6; // what the line above gave it
    const ahead = lead[g.side] - lead[g.side === 'home' ? 'away' : 'home'];
    // Already 3 up: the match is over, and more goals add little. Making it 3–0 matters a bit more.
    const cut = ahead >= 3 ? 0.75 : ahead === 2 ? 0.35 : 0;
    decided += worth * cut;
    if (cut) decidedGoals++;
    const rest = worth * (1 - cut);
    if (fav && g.side === fav) favCut += rest * 0.5 * gap;
    else if (fav) dogBonus += rest * 0.4 * gap;
    lead[g.side]++;
  }
  t.add(-decided, `${plural(decidedGoals, 'goal')} with one team already 2+ goals up`);
  if (odds) {
    const pct = (x) => `${Math.round(100 * x)}%`;
    t.add(-favCut, `The favorite (${pct(odds[fav])} to win) scoring as expected`);
    t.add(dogBonus, `The underdog (${pct(odds[fav === 'home' ? 'away' : 'home'])} to win) scoring`);
  }

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
  t.add(2.0 * (closeMinutes / end), `Within one goal for ${Math.round((100 * closeMinutes) / end)}% of the match`);
  if (Math.abs(diff) >= 3) t.add(-Math.min(1.5 + 1.0 * (Math.abs(diff) - 3), 3.5), `One-sided: won by ${Math.abs(diff)} goals`);

  // Upsets and even matches. `diff` is now the final goal difference, home minus away.
  if (odds) {
    const winner = diff > 0 ? 'home' : diff < 0 ? 'away' : null;
    if (gap >= 0.15 && winner && winner !== fav) t.add(Math.min(3 * gap, 2), 'Upset: the underdog won');
    else if (gap >= 0.15 && !winner && !f.shootout) t.add(Math.min(1.5 * gap, 1), 'The underdog held on for a draw');
    if (gap < 0.2) t.add(0.5 * (1 - gap / 0.2), 'Evenly matched on paper');
  }
  t.add(0.8 * equalisers, plural(equalisers, 'equaliser'));
  t.add(1.0 * Math.min(leadChanges, 3), `The lead changed hands ${times(leadChanges)}`);

  // Late drama, but only while the result is still open: within one goal before or after it.
  const margins = [];
  goals.reduce((d, g) => { const next = d + (g.side === 'home' ? 1 : -1); margins.push([d, next]); return next; }, 0);
  const lateGoals = goals.filter((g, i) => g.min >= 75 && Math.min(Math.abs(margins[i][0]), Math.abs(margins[i][1])) <= 1);
  const late = lateGoals.reduce((a, g) => a + (g.min >= 85 ? 1.0 : 0.5), 0);
  t.add(Math.min(late, 2.5), `${plural(lateGoals.length, 'goal')} after 75'`);

  // Intensity.
  t.add(f.shotsOnTarget >= 10 ? 1.0 : f.shotsOnTarget >= 7 ? 0.5 : 0, `${f.shotsOnTarget} shots on target`);
  if (f.totalShots >= 30) t.add(0.5, `${f.totalShots} shots in total`);
  if (n === 0 && f.shotsOnTarget <= 4) t.add(-0.5, `Goalless with only ${plural(f.shotsOnTarget, 'shot')} on target`);
  t.add(Math.min(0.6 * f.reds.length, 1.2), plural(f.reds.length, 'red card'));
  t.add(Math.min(0.3 * f.pens.length, 0.6), plural(f.pens.length, 'penalty', 'penalties'));

  // Near misses and heat: goals ruled out by VAR, shots off the woodwork, lots of corners or bookings.
  t.add(Math.min(0.6 * f.disallowed.length, 1.2), `${plural(f.disallowed.length, 'goal')} ruled out by VAR`);
  t.add(Math.min(0.4 * f.woodwork.length, 1.2), `Hit the woodwork ${times(f.woodwork.length)}`);
  if (f.corners >= 12) t.add(0.3, `${f.corners} corners`);
  t.add(f.yellows >= 9 ? 0.6 : f.yellows >= 6 ? 0.3 : 0, `${f.yellows} yellow cards`);

  if (f.extraTime) t.add(1.0, 'Went to extra time');
  if (f.shootout) t.add(1.5, 'Decided on penalties');

  const score = finalScore(t.total);

  // How much happened in each 5-minute slot (extra time folds into the last one).
  const slots = new Array(18).fill(0);
  const add = (min, w) => { slots[Math.min(17, Math.floor(min / 5))] += w; };
  goals.forEach((g) => add(g.min, 3));
  f.pens.forEach((m) => add(m, 1.5));
  f.reds.forEach((m) => add(m, 2));
  f.vars.forEach((m) => add(m, 1));
  f.disallowed.forEach((m) => add(m, 2));
  f.woodwork.forEach((m) => add(m, 1));
  f.shotsOn.forEach((m) => add(m, 0.4));
  f.shotsOff.forEach((m) => add(m, 0.15));

  // The strip on the card uses 15-minute blocks.
  const blocks = new Array(SEGMENTS).fill(0).map((_, b) => slots[b * 3] + slots[b * 3 + 1] + slots[b * 3 + 2]);
  return { score, segments: heat(blocks), advice: footballAdvice(score, slots), reasons: t.reasons, result: f.result };
}

// Skip windows in whole minutes. The last 15 minutes are never skipped: whether
// the ending matters is the one thing a skip tip must not give away.
export function footballAdvice(score, slots) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9) return { code: 'full' };
  const runs = quietRuns(slots, { quiet: 0.45, to: 15, minLen: score >= 7 ? 4 : 3 });
  if (!runs.length) return { code: 'full' };
  return { code: 'skip', unit: 'min', ranges: runs.map(([a, b]) => [a * 5, b * 5]) };
}
