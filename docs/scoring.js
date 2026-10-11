// Football scoring, shared by the bot (src/scoring/football.mjs) and the page ("Custom scoring"
// and "Calibration mode" re-score matches on the phone). Pure, browser-safe: the weights come in
// as a parameter (src/scoring/weights.mjs on the bot; events.json's `footballWeights` on the page).
// The general helpers live here too, so tennis, F1 and winter (via src/scoring/common.mjs) share them.

import { curve, bigMatchFactor } from './live.js';

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const round1 = (x) => Math.round(x * 10) / 10;
// A score that isn't a number would be published as "null": refuse it, so the event is skipped.
export function finalScore(x) {
  if (!Number.isFinite(x)) throw new Error(`score is not a number (${x})`);
  return round1(clamp(x, 0, 10));
}

// Adds up a score and remembers why, for the "Why this score?" spoiler button.
// `keys` (optional) names the weights behind a line, for "Calibration mode": `lines` keeps
// every line with its exact points, its weights and the running total.
export function tally() {
  let total = 0;
  const reasons = [];
  const lines = [];
  return {
    add(points, label, keys = []) {
      if (!Number.isFinite(points)) { // a missing fact: leave this line out rather than break the score
        console.log(`::warning::scoring: "${label}" is not a number (${points}), left out`);
        return;
      }
      total += points;
      if (round1(points)) { // no "+0.0" lines
        reasons.push([round1(points), label]);
        lines.push({ points, label, keys, total });
      }
    },
    get total() { return total; },
    reasons,
    lines,
  };
}

export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
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

// What was at stake before kick-off (src/prematch.mjs works out which).
export const STAKES = {
  title: 'Title race',
  relegation: 'Relegation battle',
  top4: 'Top-4 race',
  top8: 'Top-8 race',
  europe: 'European spots',
  playoff: 'Play-off spots',
  group: 'Top of the group',
  qualify: 'Qualifying race',
};

const SEGMENTS = 6; // 15-minute blocks; extra time counts toward the last one

// Football watchability score (0–10), heat strip and skip advice.
// `f`: the facts from factsFromSummary() in src/sources/espn-football.mjs (or the trimmed copy
// in docs/data/facts.json, which has no shot-by-shot lists: then the strip is left empty).
// `W`: the FOOTBALL weights. `boost`: the page's own points for this competition ("Custom scoring").
export function scoreFootball(f, W, { boost = 0, boostLabel = 'This competition' } = {}) {
  const goals = [...f.goals].sort((a, b) => a.min - b.min);
  const n = goals.length;
  const end = f.extraTime ? 120 : 90;
  const t = tally();

  // Goals: the first four count most.
  t.add(W.goal * Math.min(n, 4) + W.extraGoal * Math.max(0, n - 4), plural(n, 'goal'), ['goal', 'extraGoal']);

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
  t.add(-decided, `${plural(decidedGoals, 'goal')} with one team already 2+ goals up`, ['alreadyDecided', 'nearlyDecided']);
  if (odds) {
    const pct = (x) => `${Math.round(100 * x)}%`;
    t.add(-favCut, `The favorite (${pct(odds[fav])} to win) scoring as expected`, ['favoriteDiscount', 'teamStrength']);
    t.add(dogBonus, `The underdog (${pct(odds[fav === 'home' ? 'away' : 'home'])} to win) scoring`, ['underdogBonus', 'teamStrength']);
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
  t.add(W.closeMatch * (closeMinutes / end), `Within one goal for ${Math.round((100 * closeMinutes) / end)}% of the match`, ['closeMatch']);
  const underdogWon = odds && gap >= 0.15 && diff !== 0 && (diff > 0 ? 'home' : 'away') !== fav;
  // The same for any margin of 3+: a 6–0 is no duller than a 3–0, and its extra goals are still worth seeing.
  if (Math.abs(diff) >= 3 && !underdogWon) t.add(-W.blowout, `One-sided: won by ${Math.abs(diff)} goals`, ['blowout']);

  // Upsets and even matches. `diff` is now the final goal difference, home minus away.
  if (odds) {
    const winner = diff > 0 ? 'home' : diff < 0 ? 'away' : null;
    if (gap >= 0.15 && winner && winner !== fav) t.add(ts * W.upsetWin * Math.min(2 * gap, 1), 'Upset: the underdog won', ['upsetWin', 'teamStrength']);
    else if (gap >= 0.15 && !winner && !f.shootout) t.add(ts * W.upsetDraw * Math.min(2 * gap, 1), 'The underdog held on for a draw', ['upsetDraw', 'teamStrength']);
    else if (gap >= 0.15 && f.shootoutWinner && f.shootoutWinner !== fav) t.add(ts * W.upsetShootout * Math.min(2 * gap, 1), 'Upset: the underdog won on penalties', ['upsetShootout', 'teamStrength']);
    else if (gap >= 0.15 && f.shootout) t.add(ts * W.upsetDraw * Math.min(2 * gap, 1), 'The underdog took the favorite to penalties', ['upsetDraw', 'teamStrength']);
    if (gap < 0.2) t.add(ts * W.evenMatch * (1 - gap / 0.2), 'Evenly matched on paper', ['evenMatch', 'teamStrength']);
  }
  t.add(W.equaliser * equalisers, plural(equalisers, 'equaliser'), ['equaliser']);
  t.add(W.leadChange * Math.min(leadChanges, 3), `The lead changed hands ${times(leadChanges)}`, ['leadChange']);

  // Late drama, but only while the result is still open: within one goal before or after it.
  const margins = [];
  goals.reduce((d, g) => { const next = d + (g.side === 'home' ? 1 : -1); margins.push([d, next]); return next; }, 0);
  const lateGoals = goals.filter((g, i) => g.min >= 75 && Math.min(Math.abs(margins[i][0]), Math.abs(margins[i][1])) <= 1);
  const late = lateGoals.reduce((a, g) => a + (g.min >= 85 ? W.veryLateGoal : W.lateGoal), 0);
  t.add(Math.min(late, W.lateGoalsMax), `${plural(lateGoals.length, 'goal')} after 75'`, ['lateGoal', 'veryLateGoal', 'lateGoalsMax']);
  // A goal from 85' that changes the result: an equaliser, or a winner from level.
  const deciders = goals.filter((g, i) => g.min >= 85 && (margins[i][1] === 0 || margins[i][0] === 0)).length;
  t.add(W.lateDecider * Math.min(deciders, 2), `${plural(deciders, 'goal')} from 85' that changed the result`, ['lateDecider']);

  // Intensity. With xG (from FotMob, optional) the quality of the chances replaces the shot
  // counts: 30 long shots are less exciting than a few big chances.
  const xg = f.xg && Number.isFinite(f.xg.home) && Number.isFinite(f.xg.away) ? f.xg : null;
  const xgTotal = xg ? xg.home + xg.away : 0;
  if (xg) {
    t.add(W.chances * clamp((xgTotal - 1.5) / 2.5, 0, 1), `Chances worth ${xgTotal.toFixed(1)} xG`, ['chances']);
  } else {
    t.add(f.shotsOnTarget >= 10 ? W.shotsOnTarget10 : f.shotsOnTarget >= 7 ? W.shotsOnTarget7 : 0, `${f.shotsOnTarget} shots on target`, ['shotsOnTarget7', 'shotsOnTarget10']);
    if (f.totalShots >= 30) t.add(W.manyShots, `${f.totalShots} shots in total`, ['manyShots']);
  }
  // The result went against the chances: the winner created clearly less (draws already get upsetDraw).
  if (xg && diff !== 0) {
    const winner = diff > 0 ? 'home' : 'away';
    const xgGap = Math.abs(xg.home - xg.away);
    if (xgGap >= 1 && (xg.home >= xg.away ? 'home' : 'away') !== winner) {
      t.add(W.againstTheRun * Math.min(1, 0.5 + 0.5 * (xgGap - 1)), `The ${winner === fav ? 'favorite' : 'winner'} won despite ${xgGap.toFixed(1)} less xG`, ['againstTheRun']);
    }
  }
  // End to end: both teams attacking about as much as each other (shots, from ESPN), rather than
  // one-way traffic. Nothing when one team had under 40% of the other's shots, the full amount from 90%.
  const sb = f.shotsBy;
  if (sb && Number.isFinite(sb.home) && Number.isFinite(sb.away) && Math.max(sb.home, sb.away) >= 6) {
    const balance = Math.min(sb.home, sb.away) / Math.max(sb.home, sb.away);
    t.add(W.endToEnd * clamp((balance - 0.4) / 0.5, 0, 1), `End to end: ${sb.home} shots against ${sb.away}`, ['endToEnd']);
  }
  // FotMob's team stats (optional, like xG): big chances (scored or missed), how much the keepers
  // were tested (xG on target) and how much play there was in the boxes. Totals only, no minutes.
  const stats = f.stats;
  const total = (p) => (p && Number.isFinite(p.home) && Number.isFinite(p.away) ? p.home + p.away : null);
  const big = total(stats?.bigChances), xgot = total(stats?.xgot), touches = total(stats?.touchesInBox);
  if (big != null) t.add(W.bigChances * clamp((big - 3) / 6, 0, 1), plural(big, 'big chance'), ['bigChances']);
  if (xgot != null) t.add(W.shotQuality * clamp((xgot - 2) / 2.5, 0, 1), `Shots on target worth ${xgot.toFixed(1)} xGOT`, ['shotQuality']);
  if (touches != null) t.add(W.boxTouches * clamp((touches - 40) / 50, 0, 1), `${touches} touches in the opposition box`, ['boxTouches']);
  if (n === 0 && (xg ? xgTotal < 1.5 : f.shotsOnTarget <= 4)) {
    t.add(-W.dullGoalless, xg ? `Goalless with chances worth only ${xgTotal.toFixed(1)} xG` : `Goalless with only ${plural(f.shotsOnTarget, 'shot')} on target`, ['dullGoalless']);
  }
  t.add(W.redCard * Math.min(f.reds.length, 2), plural(f.reds.length, 'red card'), ['redCard']);
  t.add(W.penalty * Math.min(f.pens.length, 2), plural(f.pens.length, 'penalty', 'penalties'), ['penalty']);

  // Near misses and heat: goals ruled out by VAR, shots off the woodwork, lots of corners or bookings.
  t.add(W.varDisallowed * Math.min(f.disallowed.length, 2), `${plural(f.disallowed.length, 'goal')} ruled out by VAR`, ['varDisallowed']);
  t.add(W.woodwork * Math.min(f.woodwork.length, 3), `Hit the woodwork ${times(f.woodwork.length)}`, ['woodwork']);
  if (f.corners >= 12) t.add(W.manyCorners, `${f.corners} corners`, ['manyCorners']);
  t.add(f.yellows >= 9 ? W.lotsOfYellows : f.yellows >= 6 ? W.manyYellows : 0, `${f.yellows} yellow cards`, ['manyYellows', 'lotsOfYellows']);

  if (f.stakes) {
    const [points, key] = f.stakes === 'title' ? [W.titleRace, 'titleRace'] : f.stakes === 'relegation' ? [W.relegationBattle, 'relegationBattle'] : [W.otherRace, 'otherRace'];
    t.add(points, `${STAKES[f.stakes] ?? 'Something at stake'} before kick-off`, [key]);
  }

  if (f.extraTime) t.add(W.extraTime, 'Went to extra time', ['extraTime']);
  if (f.shootout) t.add(W.shootout, 'Decided on penalties', ['shootout']);

  // Big match: a thriller between two strong teams is worth more than the same match between
  // two weaker ones. `f.strength` is each team's strength from 0 to 1 (clubs against their own
  // league, national teams on the world scale; see src/sources/ratings.mjs), or null.
  // Two weak teams lose more (`smallMatch`) than two strong ones gain (`bigMatch`).
  const st = f.strength;
  if (st && Number.isFinite(st.home) && Number.isFinite(st.away)) {
    const factor = bigMatchFactor(st, W.bigMatch, W.smallMatch); // from the mean strength, 0.5 = ×1
    const mean = (st.home + st.away) / 2;
    const label = mean >= 0.75 ? 'Big match: two strong teams' : mean >= 0.5 ? 'Slightly above-average teams' : mean > 0.25 ? 'Slightly below-average teams' : 'Two weaker teams';
    t.add(Math.max(0, t.total) * (factor - 1), `${label} (×${factor.toFixed(2)})`, ['bigMatch', 'smallMatch']);
  }

  // The page's own boost for this competition ("Custom scoring"), before the curve.
  if (boost) t.add(boost, `${boostLabel}: your boost`, []);

  // The top end: from `curveFrom` up, each point is worth a bit less than the one before, so
  // the score bends smoothly towards 10 and only a truly extraordinary match gets near it.
  if (t.total > Math.min(W.curveFrom, 9)) t.add(curve(t.total, W.curveFrom) - t.total, 'Higher scores are harder to reach', ['curveFrom']);
  const score = finalScore(t.total);

  // How much happened in each 5-minute slot (extra time folds into the last one).
  const slots = new Array(18).fill(0);
  const add = (min, w) => { slots[Math.min(17, Math.floor(min / 5))] += w; };
  goals.forEach((g) => add(g.min, 3));
  f.pens.forEach((m) => add(m, 1.5));
  f.reds.forEach((m) => add(m, 2));
  (f.vars ?? []).forEach((m) => add(m, 1));
  f.disallowed.forEach((m) => add(m, 2));
  f.woodwork.forEach((m) => add(m, 1));
  // Shots: with xG each adds twice its xG (a 0.2 xG chance is about one shot on target without xG).
  if (xg) (xg.shots ?? []).forEach((s) => add(s.min, 2 * s.xg));
  else {
    (f.shotsOn ?? []).forEach((m) => add(m, 0.4));
    (f.shotsOff ?? []).forEach((m) => add(m, 0.15));
  }

  // The strip on the card uses 15-minute blocks.
  const blocks = new Array(SEGMENTS).fill(0).map((_, b) => slots[b * 3] + slots[b * 3 + 1] + slots[b * 3 + 2]);
  // Full heat needs about a goal's worth (4: a goal and a shot or two) in the block.
  // `limited`: scored without xG (FotMob had none), so from shot counts only. Shown on the card.
  return { score, segments: heat(blocks, { floor: 4 }), advice: footballAdvice(score, slots), reasons: t.reasons, lines: t.lines, result: f.result, limited: !xg };
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

// ── Custom scoring: the page's 10 sliders ───────────────────────────────────
// Each slider multiplies a group of FOOTBALL weights (0 = off, 1 = the standard, 2 = double),
// except `curveFrom`, which sets the top end directly. The live keys (shotOnTarget, shotOffTarget)
// are FOOTBALL_LIVE weights for "Excitement so far". Every FOOTBALL weight belongs to exactly one
// group, or to TWEAK_FIXED (a test checks this): `teamStrength` is already the master dial for
// the other odds weights, and `leagueLevel` is used by the bot before the facts are saved.
export const TWEAK_GROUPS = {
  goals: { label: 'Goals', hint: 'Each goal scored', keys: ['goal', 'extraGoal'] },
  tight: { label: 'Tight match and swings', hint: 'Close all the way, equalisers, the lead changing hands', keys: ['closeMatch', 'equaliser', 'leadChange'] },
  late: { label: 'Late drama', hint: 'Late goals while it was open, extra time, penalty shootouts', keys: ['lateGoal', 'veryLateGoal', 'lateDecider', 'lateGoalsMax', 'extraTime', 'shootout'] },
  chances: { label: 'Chances and intensity', hint: 'xG, big chances, shots, end to end play, corners', keys: ['chances', 'bigChances', 'shotQuality', 'boxTouches', 'endToEnd', 'againstTheRun', 'shotsOnTarget7', 'shotsOnTarget10', 'manyShots', 'manyCorners', 'shotOnTarget', 'shotOffTarget'] },
  cards: { label: 'Cards, penalties and VAR', hint: 'Red cards, penalties, goals ruled out, the woodwork, bookings', keys: ['redCard', 'penalty', 'varDisallowed', 'woodwork', 'manyYellows', 'lotsOfYellows'] },
  oneSided: { label: 'Punish one-sided matches', hint: 'Points taken off for routs and dull 0–0s', keys: ['alreadyDecided', 'nearlyDecided', 'blowout', 'dullGoalless'] },
  upsets: { label: 'Upsets and team strength', hint: 'Underdogs winning or holding on, evenly matched teams', keys: ['teamStrength'] },
  bigMatch: { label: 'Big match', hint: 'Two strong teams count more, two weak ones less', keys: ['bigMatch', 'smallMatch'] },
  stakes: { label: 'What was at stake', hint: 'Title races, relegation battles and other races', keys: ['titleRace', 'relegationBattle', 'otherRace'] },
};
export const TWEAK_FIXED = ['favoriteDiscount', 'underdogBonus', 'upsetWin', 'upsetDraw', 'upsetShootout', 'evenMatch', 'leagueLevel', 'curveFrom'];
const SHARES = ['alreadyDecided', 'nearlyDecided', 'smallMatch']; // parts of 1: never more than all of it
export const SLIDER_STEP = 0.2;
export const CURVE_STEP = 0.5;
export const BOOST_STEP = 0.5;
export const BOOST_MAX = 2;
export const DEFAULT_TWEAKS = {
  on: false,
  sliders: Object.fromEntries(Object.keys(TWEAK_GROUPS).map((k) => [k, 1])),
  curveFrom: null, // null: the standard top end from the weights
  comps: {}, // { 'eng.1': 1 }: points added for that competition
};

const snap = (x, step, lo, hi) => Math.round(clamp(x, lo, hi) / step) * step;
const tidy = (x) => Math.round(x * 100) / 100; // 0.6000000001 -> 0.6

// Any saved or shared tweaks -> a valid set (junk is dropped, numbers snapped to the slider steps).
export function cleanTweaks(x) {
  const out = structuredClone(DEFAULT_TWEAKS);
  if (!x || typeof x !== 'object') return out;
  out.on = x.on === true;
  for (const k of Object.keys(out.sliders)) {
    const v = x.sliders?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) out.sliders[k] = tidy(snap(v, SLIDER_STEP, 0, 2));
  }
  if (typeof x.curveFrom === 'number' && Number.isFinite(x.curveFrom)) out.curveFrom = tidy(snap(x.curveFrom, CURVE_STEP, 0, 9));
  for (const [comp, v] of Object.entries(x.comps && typeof x.comps === 'object' ? x.comps : {})) {
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const b = tidy(snap(v, BOOST_STEP, -BOOST_MAX, BOOST_MAX));
    if (b) out.comps[comp] = b;
  }
  return out;
}

// The weights with the sliders applied: the replay FOOTBALL weights or the live ones alike.
export function applyTweaks(W, tweaks) {
  const out = { ...W };
  for (const [group, { keys }] of Object.entries(TWEAK_GROUPS)) {
    const s = tweaks.sliders[group] ?? 1;
    for (const k of keys) if (k in out) out[k] = SHARES.includes(k) ? Math.min(1, out[k] * s) : out[k] * s;
  }
  if (tweaks.curveFrom != null) out.curveFrom = tweaks.curveFrom;
  return out;
}

// True when the tweaks change nothing (the standard scoring), apart from the switch.
export const isStandard = (tweaks) => Object.values(tweaks.sliders).every((v) => v === 1) && tweaks.curveFrom == null && !Object.keys(tweaks.comps).length;
