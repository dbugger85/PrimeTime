// Football watchability score (0–10), heat strip and skip advice.
// Input: the facts from factsFromSummary() in src/sources/espn-football.mjs.

import { finalScore, heat, quietRuns, tally, plural, times } from './common.mjs';
import { FOOTBALL as W } from './weights.mjs';
import { STAKES } from '../prematch.mjs';

const SEGMENTS = 6; // 15-minute blocks; extra time counts toward the last one

export function scoreFootball(f) {
  const goals = [...f.goals].sort((a, b) => a.min - b.min);
  const n = goals.length;
  const end = f.extraTime ? 120 : 90;
  const t = tally();

  // Goals: the first four count most.
  t.add(W.goal * Math.min(n, 4) + W.extraGoal * Math.max(0, n - 4), plural(n, 'goal'));

  // Team strength, from the pre-match odds. `gap` is how much likelier the
  // favorite was to win than the underdog: about 0 for an even match, 0.8 for
  // a big mismatch. Goals the favorite was expected to score count for less,
  // and the underdog's goals count for more.
  const odds = f.odds;
  const fav = odds ? (odds.home >= odds.away ? 'home' : 'away') : null;
  const gap = odds ? Math.abs(odds.home - odds.away) : 0;
  const ts = W.teamStrength;

  // Walk the goals in order: what each one's worth depends on the score when it went in.
  let lead = { home: 0, away: 0 }, decided = 0, decidedGoals = 0, favCut = 0, dogBonus = 0, counted = 0;
  for (const g of goals) {
    const worth = counted++ < 4 ? W.goal : W.extraGoal; // what the line above gave it
    const ahead = lead[g.side] - lead[g.side === 'home' ? 'away' : 'home'];
    // Already 3 up: the match is over, and more goals add little. Making it 3–0 matters a bit more.
    // An underdog 2 or 3 up against a clear favorite isn't a finished match, it's a shock.
    const shock = fav && g.side !== fav && gap >= 0.15;
    const cut = shock ? 0 : ahead >= 3 ? W.alreadyDecided : ahead === 2 ? W.nearlyDecided : 0;
    decided += worth * cut;
    if (cut) decidedGoals++;
    const rest = worth * (1 - cut);
    if (fav && g.side === fav) favCut += rest * W.favoriteDiscount * gap * ts;
    else if (fav) dogBonus += rest * W.underdogBonus * gap * ts;
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
  t.add(W.closeMatch * (closeMinutes / end), `Within one goal for ${Math.round((100 * closeMinutes) / end)}% of the match`);
  const underdogWon = odds && gap >= 0.15 && diff !== 0 && (diff > 0 ? 'home' : 'away') !== fav;
  if (Math.abs(diff) >= 3 && !underdogWon) t.add(-Math.min(W.blowout + W.blowoutPerGoal * (Math.abs(diff) - 3), W.blowoutMax), `One-sided: won by ${Math.abs(diff)} goals`);

  // Upsets and even matches. `diff` is now the final goal difference, home minus away.
  if (odds) {
    const winner = diff > 0 ? 'home' : diff < 0 ? 'away' : null;
    if (gap >= 0.15 && winner && winner !== fav) t.add(ts * W.upsetWin * Math.min(2 * gap, 1), 'Upset: the underdog won');
    else if (gap >= 0.15 && !winner && !f.shootout) t.add(ts * W.upsetDraw * Math.min(2 * gap, 1), 'The underdog held on for a draw');
    if (gap < 0.2) t.add(ts * W.evenMatch * (1 - gap / 0.2), 'Evenly matched on paper');
  }
  t.add(W.equaliser * equalisers, plural(equalisers, 'equaliser'));
  t.add(W.leadChange * Math.min(leadChanges, 3), `The lead changed hands ${times(leadChanges)}`);

  // Late drama, but only while the result is still open: within one goal before or after it.
  const margins = [];
  goals.reduce((d, g) => { const next = d + (g.side === 'home' ? 1 : -1); margins.push([d, next]); return next; }, 0);
  const lateGoals = goals.filter((g, i) => g.min >= 75 && Math.min(Math.abs(margins[i][0]), Math.abs(margins[i][1])) <= 1);
  const late = lateGoals.reduce((a, g) => a + (g.min >= 85 ? W.veryLateGoal : W.lateGoal), 0);
  t.add(Math.min(late, W.lateGoalsMax), `${plural(lateGoals.length, 'goal')} after 75'`);

  // Intensity.
  t.add(f.shotsOnTarget >= 10 ? W.shotsOnTarget10 : f.shotsOnTarget >= 7 ? W.shotsOnTarget7 : 0, `${f.shotsOnTarget} shots on target`);
  if (f.totalShots >= 30) t.add(W.manyShots, `${f.totalShots} shots in total`);
  if (n === 0 && f.shotsOnTarget <= 4) t.add(-W.dullGoalless, `Goalless with only ${plural(f.shotsOnTarget, 'shot')} on target`);
  t.add(W.redCard * Math.min(f.reds.length, 2), plural(f.reds.length, 'red card'));
  t.add(W.penalty * Math.min(f.pens.length, 2), plural(f.pens.length, 'penalty', 'penalties'));

  // Near misses and heat: goals ruled out by VAR, shots off the woodwork, lots of corners or bookings.
  t.add(W.varDisallowed * Math.min(f.disallowed.length, 2), `${plural(f.disallowed.length, 'goal')} ruled out by VAR`);
  t.add(W.woodwork * Math.min(f.woodwork.length, 3), `Hit the woodwork ${times(f.woodwork.length)}`);
  if (f.corners >= 12) t.add(W.manyCorners, `${f.corners} corners`);
  t.add(f.yellows >= 9 ? W.lotsOfYellows : f.yellows >= 6 ? W.manyYellows : 0, `${f.yellows} yellow cards`);

  if (f.stakes) {
    const points = f.stakes === 'title' ? W.titleRace : f.stakes === 'relegation' ? W.relegationBattle : W.otherRace;
    t.add(points, `${STAKES[f.stakes] ?? 'Something at stake'} before kick-off`);
  }

  if (f.extraTime) t.add(W.extraTime, 'Went to extra time');
  if (f.shootout) t.add(W.shootout, 'Decided on penalties');

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
