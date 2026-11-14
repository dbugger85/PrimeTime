// Golf: the final round's watchability score (0–10), heat strip and skip tip, from hole-by-hole
// scores (holesFromScoreboard in src/sources/espn-golf.mjs). No names on the card: the reasons and
// the result (spoiler files, behind warnings) may name players.
//
// The leaderboard after each hole is worked out by hole number ("everyone after hole 9"), which is
// close to what you'd see on TV, since the contenders play in the last groups.
//
// Spoiler rules (see "Golf" in CLAUDE.md):
// - The strip always has 6 blocks of 3 holes, from the 72 regulation holes only. A playoff isn't a
//   block of its own (that would give it away): the last block covers the finish.
// - The skip tip is only ever "Start at hole 7", "10" or "13", from holes 1–12 alone, so it never
//   touches the last 6 holes, and can't depend on who won or on a playoff.

import { finalScore, tally, heat, plural } from './common.mjs';
import { GOLF as W } from './weights.mjs';
import { curve } from '../../docs/live.js';

const sum = (a) => a.reduce((x, y) => x + y, 0);
const par = (x) => (x === 0 ? 'E' : x > 0 ? `+${x}` : String(x));
export const BLOCK = 3; // holes per strip block
export const BLOCKS = 6;
const BIG_PURSE = 20e6; // a $20 million purse or more: the signature events and THE PLAYERS
const HIGHLIGHTS_BELOW = 3.5; // a score under this: "Highlights are enough"
const STRIP_FLOOR = 3; // a block needs about this much action to be the hottest colour

// Facts for scoring: the players who finished 72 holes, their total to par before the final round,
// and its 18 holes. `winner` comes from the leaderboard (position 1), `major` and `purse` too.
// ESPN sometimes has no hole-by-hole scores for a whole event (Bermuda 2026 had only the 16th):
// then it's `limited`, scored from the round totals alone, with no strip (the card says so), and the
// full build tries again for 3 days, like football without xG.
export function golfFacts(players, { winner = null, major = false, purse = 0 } = {}) {
  const four = players.filter((p) => p.rounds.every((r) => r != null));
  const withHoles = four.filter((p) => p.holes.every((h) => h != null) && sum(p.holes) === p.rounds[3]);
  const limited = withHoles.length < Math.max(2, four.length / 2);
  return {
    players: (limited ? four : withHoles).map((p) => ({
      name: p.name, before: p.rounds[0] + p.rounds[1] + p.rounds[2], holes: limited ? null : p.holes, total: sum(p.rounds), playoff: p.playoff ?? [],
    })),
    winner, major, purse, ...(limited ? { limited: true } : {}),
  };
}

// The leaderboard after each of the final round's holes: standings[h][i] = player i's total after h holes.
// Without holes (limited): only before the round (0) and after it (18).
const standings = (f) => Array.from({ length: 19 }, (_, h) => f.players.map((p) => (p.holes ? p.before + sum(p.holes.slice(0, h)) : h < 18 ? p.before : p.total)));
const leadersAt = (row) => { const best = Math.min(...row); return row.map((x, i) => (x === best ? i : -1)).filter((i) => i >= 0); };
const newAtTop = (rows, h) => { const before = leadersAt(rows[h - 1]); return leadersAt(rows[h]).some((i) => !before.includes(i)); };

export function scoreGolf(f) {
  if (f.players.length < 2) throw new Error('golf: fewer than two players finished');
  const rows = standings(f);
  const totals = f.players.map((p) => p.total);
  const best = Math.min(...totals);
  const sorted = [...totals].sort((a, b) => a - b);
  const playoff = sorted[1] === best; // level after 72 holes (ESPN's own `score` would include the playoff holes)
  const margin = sorted[1] - best;
  const t = tally();
  t.add(W.base, 'Base: a final round', ['base']);

  // The finish.
  if (playoff) {
    t.add(W.playoff, `Level after 72 holes: a playoff`, ['playoff']);
    t.add(W.oneShot, 'Decided by less than a shot', ['oneShot']);
  } else if (margin === 1) t.add(W.oneShot, 'Won by one shot', ['oneShot']);
  else if (margin === 2) t.add(W.twoShots, 'Won by two shots', ['twoShots']);
  else if (margin === 3) t.add(W.threeShots, 'Won by three shots', ['threeShots']);

  const holes = !f.limited;
  // Players in it at the turn (within 2 shots of the lead after the 9th), beyond the leader.
  const turn = rows[9];
  const inIt = turn.filter((x) => x - Math.min(...turn) <= 2).length - 1;
  if (holes && inIt > 0) t.add(Math.min(inIt * W.inItAtTurn, W.inItAtTurnMax), `${plural(inIt, 'player')} within 2 shots of the lead at the turn, besides the leader`, ['inItAtTurn', 'inItAtTurnMax']);

  // A new name at the top: after a hole, someone leads (alone or level) who didn't before it.
  let changes = 0;
  for (let h = 1; holes && h <= 18; h++) if (newAtTop(rows, h)) changes++;
  if (changes) t.add(Math.min(changes * W.leadChange, W.leadChangesMax), `A new name at the top of the leaderboard ${plural(changes, 'time')} in the final round`, ['leadChange', 'leadChangesMax']);

  // A tight back nine: after how many of holes 10–18 the lead was a shot or less.
  const tight = rows.slice(10).filter((row) => { const r = [...row].sort((a, b) => a - b); return r[1] - r[0] <= 1; }).length;
  if (holes && tight) t.add(W.tightBackNine * tight / 9, `The lead was a shot or less after ${tight} of the 9 back-nine holes`, ['tightBackNine']);

  // A comeback: someone level for the lead after 72 holes started the day 3 or more shots back.
  const startBest = Math.min(...rows[0]);
  const behind = Math.max(...f.players.map((p, i) => (totals[i] === best ? rows[0][i] - startBest : 0)));
  if (behind >= 3) {
    const who = f.players.filter((p, i) => totals[i] === best && rows[0][i] - startBest === behind).map((p) => p.name).join(' and ');
    t.add(Math.min(W.comeback + (behind - 3) * W.comebackPerShot, W.comebackMax), `${who} started the day ${behind} shots back`, ['comeback', 'comebackPerShot', 'comebackMax']);
  }

  // Late eagles (or better) on holes 13–18 by someone within 3 shots of the lead at the time.
  let eagles = 0;
  for (let h = 12; holes && h < 18; h++) {
    const lead = Math.min(...rows[h]);
    eagles += f.players.filter((p, i) => p.holes[h] <= -2 && rows[h][i] - lead <= 3).length;
  }
  if (eagles) t.add(Math.min(eagles * W.lateEagle, W.lateEaglesMax), `${plural(eagles, 'eagle')} on the last six holes by players in contention`, ['lateEagle', 'lateEaglesMax']);

  // The occasion.
  if (f.major) t.add(W.major, 'A major', ['major']);
  else if (f.purse >= BIG_PURSE) t.add(W.bigPurse, 'One of the richest events (a $20 million purse or more)', ['bigPurse']);

  // The top end, as for football: above curveFrom each point counts less, so a 10 stays out of reach.
  if (t.total > W.curveFrom) t.add(curve(t.total, W.curveFrom) - t.total, 'Higher scores are harder to reach', ['curveFrom']);

  const score = finalScore(t.total);
  const values = holes ? blockValues(f, rows) : [];
  const segments = holes ? heat(values, { floor: STRIP_FLOOR }) : [];
  const advice = holes ? golfAdvice(score, values) : { code: score < HIGHLIGHTS_BELOW ? 'highlights' : 'full' };
  return { score, segments, advice, reasons: t.reasons, result: golfResult(f, { playoff, margin }), ...(f.limited ? { limited: true } : {}) };
}

// The strip: how much happened among the players in it, per block of 3 holes. Birdies and bogeys
// (an eagle counts 2) by players within 4 shots of the lead at the start of the block, the closer
// the more, plus lead changes and a lead of a shot or less at the end of the block.
export function blockValues(f, rows = standings(f)) {
  return Array.from({ length: BLOCKS }, (_, b) => {
    const from = b * BLOCK, start = rows[from], lead = Math.min(...start);
    let v = 0;
    f.players.forEach((p, i) => {
      const gap = start[i] - lead;
      const w = gap <= 1 ? 1 : gap <= 2 ? 0.6 : gap <= 4 ? 0.3 : 0;
      v += w * sum(p.holes.slice(from, from + BLOCK).map(Math.abs));
    });
    for (let h = from + 1; h <= from + BLOCK; h++) if (newAtTop(rows, h)) v += W.stripLeadChange;
    const end = [...rows[from + BLOCK]].sort((a, b) => a - b);
    if (end[1] - end[0] <= 1) v += W.stripTight;
    return v;
  });
}
export const golfSegments = (f, rows = standings(f)) => heat(blockValues(f, rows), { floor: STRIP_FLOOR });

// "Start at hole 7, 10 or 13": the quiet blocks at the start, among the first four (holes 1–12) only,
// each judged on its own (not against the rest of the round, which would bring the finish in).
const QUIET = 2; // a block with at most this much action (about two birdies or bogeys among the contenders) is quiet
export function golfAdvice(score, values) {
  if (score < HIGHLIGHTS_BELOW) return { code: 'highlights' };
  let quiet = 0;
  while (quiet < 4 && values[quiet] <= QUIET) quiet++;
  if (quiet < 2) return { code: 'full' };
  return { code: 'skip', unit: 'hole', ranges: [[1, quiet * BLOCK]] };
}

// "Rory McIlroy won at -11, beating Justin Rose in a playoff. 3rd: Patrick Reed -9" (results.json).
export function golfResult(f, { playoff, margin }) {
  const order = f.players.map((p) => ({ name: p.name, total: p.total })).sort((a, b) => a.total - b.total);
  const winner = f.winner && order.some((p) => p.name === f.winner) ? f.winner : order[0].name;
  const w = order.find((p) => p.name === winner);
  const level = order.filter((p) => p.total === w.total && p.name !== winner).map((p) => p.name);
  const rest = order.filter((p) => p.total !== w.total).slice(0, 3).map((p) => `${p.name} ${par(p.total)}`);
  const head = playoff ? `${winner} won at ${par(w.total)}, beating ${level.join(' and ')} in a playoff` : `${winner} won at ${par(w.total)}, by ${plural(margin, 'shot')}`;
  return `${head}. Next: ${rest.join(', ')}`;
}
