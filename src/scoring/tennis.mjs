// Tennis watchability score (0–10) and skip advice, from set scores only
// (the free data has no point-by-point or break-point detail).
//
// No heat strip for tennis: the number of blocks would give away how many
// sets were played. For the same reason, skip advice never goes past a set
// that is always played (set 2 in best-of-3, set 3 in best-of-5).

import { finalScore } from './common.mjs';

function closeness({ games: [a, b], tiebreak }) {
  const hi = Math.max(a, b), lo = Math.min(a, b);
  if (tiebreak || (hi === 7 && lo === 6) || (hi >= 7 && hi - lo === 2 && lo >= 6)) return 1.0;
  if (hi - lo === 2) return 0.8; // 7-5, or 8-6 etc. in an advantage final set
  if (lo === 4) return 0.6;
  if (lo === 3) return 0.3;
  return 0.1;
}

const ROUND_BONUS = { Quarterfinal: 0.3, Semifinal: 0.5, Final: 0.8 };

export function scoreTennis(m) {
  if (m.retired) return { score: 1, segments: [], advice: { code: 'highlights' } };

  const sets = m.sets;
  const close = sets.map(closeness);
  const tiebreaks = sets.filter((s) => s.tiebreak).length;
  let s = 1.0;

  if (sets.length === m.bestOf) s += 3.0;
  else if (m.bestOf === 5 && sets.length === 4) s += 1.5;

  s += Math.min(close.reduce((a, b) => a + b, 0) * 1.2, 4);
  s += Math.min(0.8 * tiebreaks, 2.4);
  if (sets.length === m.bestOf && sets.at(-1).tiebreak) s += 1.0;

  // Comebacks: the winner lost the first set (or the first two).
  const lostBy = (set) => set.games[m.winnerIndex] < set.games[1 - m.winnerIndex];
  if (lostBy(sets[0])) s += sets[1] && lostBy(sets[1]) ? 1.0 : 0.5;

  s += ROUND_BONUS[m.round] ?? 0;

  const score = finalScore(s);
  return { score, segments: [], advice: tennisAdvice(score, close, m.bestOf) };
}

export function tennisAdvice(score, close, bestOf) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 7.5) return { code: 'full' };
  const maxStart = bestOf === 5 ? 2 : 1;
  let start = close.findIndex((c) => c >= 0.6);
  if (start < 0) start = maxStart;
  start = Math.min(start, maxStart);
  return start === 0 ? { code: 'full' } : { code: 'fromSet', set: start + 1 };
}
