// Tennis watchability score (0–10) and skip advice, from set scores only
// (the free data has no point-by-point or break-point detail).
//
// No heat strip for tennis: the number of blocks would give away how many
// sets were played. For the same reason, skip advice only ever names sets
// that are always played, and never the last of those (set 1 in best-of-3,
// sets 1–2 in best-of-5), so it can't hint at how the match ended.

import { finalScore, tally, plural } from './common.mjs';
import { TENNIS as W } from './weights.mjs';

function closeness({ games: [a, b], tiebreak }) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (tiebreak || (hi === 7 && lo === 6) || (hi >= 7 && hi - lo === 2 && lo >= 6)) return 1.0;
  if (hi - lo === 2) return 0.8; // 7-5, or 8-6 etc. in an advantage final set
  if (lo === 4) return 0.6;
  if (lo === 3) return 0.3;
  return 0.1;
}

const ROUND_BONUS = { Quarterfinal: W.quarterfinal, Semifinal: W.semifinal, Final: W.final };

const setText = (set) => set.games.join('-');

// "Alexander Zverev beat Ben Shelton 6-3 7-6(2) 5-7 6-2", from the winner's side.
export function tennisResult(m) {
  const w = m.winnerIndex, l = 1 - w;
  const sets = m.sets.map((s) => {
    const txt = `${s.games[w]}-${s.games[l]}`;
    const loserTb = s.tbPoints?.[s.games[w] > s.games[l] ? l : w];
    return s.tiebreak && loserTb != null ? `${txt}(${loserTb})` : txt;
  });
  return `${m.players[w]} beat ${m.players[l]} ${sets.join(' ')}${m.retired ? ' (retired)' : ''}`;
}

export function scoreTennis(m) {
  if (m.retired) {
    return { score: 1, segments: [], advice: { code: 'highlights' }, reasons: [[1, 'A player retired during the match']], result: tennisResult(m) };
  }

  const sets = m.sets;
  const close = sets.map(closeness);
  const tiebreaks = sets.filter((s) => s.tiebreak).length;
  const t = tally();
  t.add(W.base, 'Base');

  if (sets.length === m.bestOf) t.add(W.allSets, `Went the full ${m.bestOf} sets`);
  else if (m.bestOf === 5 && sets.length === 4) t.add(W.fourSets, 'Went to four sets');

  t.add(Math.min(close.reduce((a, b) => a + b, 0) * W.closeSets, W.closeSetsMax), `How close the sets were: ${sets.map(setText).join(' ')}`);
  t.add(W.tiebreak * Math.min(tiebreaks, 3), plural(tiebreaks, 'tiebreak'));
  if (sets.length === m.bestOf && sets.at(-1).tiebreak) t.add(W.decidingTiebreak, 'Deciding-set tiebreak');

  // Comebacks: the winner lost the first set (or the first two).
  const lostBy = (set) => set.games[m.winnerIndex] < set.games[1 - m.winnerIndex];
  const winner = m.players[m.winnerIndex];
  if (lostBy(sets[0])) {
    const two = sets[1] && lostBy(sets[1]);
    t.add(two ? W.comebackTwoSets : W.comebackOneSet, `${winner} came back from ${two ? 'two sets' : 'a set'} down to win`);
  }

  t.add(ROUND_BONUS[m.round] ?? 0, `It's a ${m.round.toLowerCase()}`);

  const score = finalScore(t.total);
  return { score, segments: [], advice: tennisAdvice(score, close, m.bestOf), reasons: t.reasons, result: tennisResult(m) };
}

export function tennisAdvice(score, close, bestOf) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9) return { code: 'full' };
  const skippable = bestOf === 5 ? [0, 1] : [0];
  const dull = skippable.filter((i) => close[i] < 0.6);
  if (!dull.length) return { code: 'full' };
  // Consecutive sets become one range: sets 1 and 2 -> [[1, 2]].
  const ranges = [];
  for (const i of dull) {
    const last = ranges.at(-1);
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i + 1, i + 1]);
  }
  return { code: 'skip', unit: 'set', ranges };
}
