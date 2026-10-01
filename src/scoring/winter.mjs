// Winter sports scores (0–10), heat strips and skip advice.
//   Biathlon: facts from factsFromRace() in src/sources/ibu.mjs
//   Alpine and cross-country: facts from src/sources/fis.mjs
//
// Spoiler rules for the strip: its length only depends on the race type
// (biathlon: one block per shooting plus the finish, or one per relay leg;
// alpine two-run races: one per run), never on what happened. Cross-country
// and one-run alpine races have no strip (FIS has no split times, and a strip
// by start number would hint at a late starter).

import { finalScore, heat, tally, plural, times } from './common.mjs';
import { BIATHLON as B, ALPINE as A, CROSS_COUNTRY as C } from './weights.mjs';

const ordinal = (n) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

export function scoreBiathlon(f) {
  const t = tally();
  t.add(B.base, 'Base');
  const g = f.gapP2;
  if (g != null) {
    const pts = f.h2h
      ? (g < 1 ? B.photoFinish : g < 3 ? B.closeFinish : g < 8 ? B.fairlyCloseFinish : g < 15 ? B.someFight : 0)
      : (g < 2 ? B.clockUnder2 : g < 5 ? B.clockUnder5 : g < 10 ? B.clockUnder10 : g < 20 ? B.clockUnder20 : 0);
    t.add(pts, `Won by ${g.toFixed(1)} s`);
  }
  if (f.gapP3 != null && f.gapP3 < (f.h2h ? 5 : 10)) t.add(B.closePodium, `Third place ${f.gapP3.toFixed(1)} s behind`);
  if (!f.h2h) t.add(f.within30 >= 6 ? B.openRace : f.within30 >= 4 ? B.fairlyOpenRace : 0, `${f.within30} within 30 s of the winner`);
  if (f.h2h && f.within10 >= 4) t.add(B.bigGroup, `${f.within10} ${f.relay ? 'teams' : 'athletes'} within 10 s at the finish`);
  if (f.h2h) {
    t.add(Math.min(B.leadChange * f.leadChanges, B.leadChangesMax), `The lead changed ${times(f.leadChanges)}`);
    if (f.lastShootingLeaderWon === false) t.add(B.lastShootingTwist, f.relay ? 'The leader at the last handover didn\'t win' : 'The leader after the last shooting didn\'t win');
  }
  if (f.winnerStart >= 11) t.add(B.bigComebackPursuit, `Won from ${ordinal(f.winnerStart)} at the start`);
  else if (f.winnerStart >= 6) t.add(B.comebackPursuit, `Won from ${ordinal(f.winnerStart)} at the start`);
  if (f.format === 'MS' && f.winnerWorst >= 8) t.add(B.comebackMassStart, `The winner was ${ordinal(f.winnerWorst)} after one shooting`);
  const lastRange = f.missesByStage.at(-1) ?? 0;
  if (f.h2h && lastRange >= (f.relay ? 3 : 5)) t.add(B.chaosAtRange, f.relay ? `${plural(lastRange, 'penalty loop')} for the top 5 on the last leg` : `${plural(lastRange, 'miss', 'misses')} by the top 10 at the last shooting`);
  const score = finalScore(t.total);

  // Strip: relays one block per leg; others one per shooting, plus the finish.
  const blocks = f.relay ? f.missesByStage.map((m) => m * 1.5) : [...f.missesByStage.map((m) => m * 0.5), 0];
  const route = f.leaders ?? [];
  route.forEach((id, i) => { if (i && id !== route[i - 1]) blocks[i] += 3; });
  const finishPts = t.reasons.find(([, l]) => l.startsWith('Won by'))?.[0] ?? 0;
  blocks[blocks.length - 1] += 2 * finishPts + (f.lastShootingLeaderWon === false ? 3 : 0);
  return { score, segments: heat(blocks), advice: biathlonAdvice(score, blocks, f), reasons: t.reasons, result: f.result };
}

// Head-to-head races: skip quiet early shootings (or relay legs). The last
// shooting, the finish and the last leg are never skipped. Races against the
// clock get "Watch it all" or "Highlights are enough".
export function biathlonAdvice(score, blocks, f) {
  if (score < 3) return { code: 'highlights' };
  if (score >= 9 || !f.h2h) return { code: score >= 5 ? 'full' : 'highlights' };
  const skippable = f.relay ? blocks.length - 1 : blocks.length - 2; // not the last leg; not the last shooting or the finish
  let k = 0;
  while (k < skippable && blocks[k] < 2) k++;
  if (!k) return { code: 'full' };
  return { code: 'skip', unit: f.relay ? 'leg' : 'stage', ranges: [[1, k]] };
}

export function scoreAlpine(f) {
  const t = tally();
  t.add(A.base, 'Base');
  const g = f.gapP2;
  if (g != null) t.add(g < 0.05 ? A.under005 : g < 0.15 ? A.under015 : g < 0.3 ? A.under030 : g < 0.6 ? A.under060 : 0, `Won by ${g.toFixed(2)} s`);
  if (f.gapP5 != null) t.add(f.gapP5 < 0.5 ? A.tightTop5 : f.gapP5 < 1 ? A.closeTop5 : 0, `Top 5 within ${f.gapP5.toFixed(2)} s`);
  if (f.runs === 2) {
    if (f.winnerRun1 >= 8) t.add(A.bigComeback, `Won from ${ordinal(f.winnerRun1)} after run 1`);
    else if (f.winnerRun1 >= 4) t.add(A.comeback, `Won from ${ordinal(f.winnerRun1)} after run 1`);
    if (f.winnerRun1 > 1 && f.run1LeaderFinish !== 1) t.add(A.leaderLost, `The leader after run 1 finished ${f.run1LeaderFinish ? ordinal(f.run1LeaderFinish) : 'out of the result'}`);
    if (f.bigMover) t.add(A.bigMoverTop10, 'Someone climbed 10 or more places into the top 10');
  } else if (f.lateBibPodium) {
    t.add(A.lateBibPodium, 'A late starter (bib 30+) reached the podium');
  }
  const score = finalScore(t.total);
  // Two-run races: one block per run. Run 2 carries the finish.
  const segments = f.runs === 2 ? heat([f.run1Spread != null ? Math.max(0, 1.5 - f.run1Spread) : 0.5, 1 + (t.total - A.base)]) : [];
  // "Skip run 1" only looks at run 1 (a big spread at the top), never at who won:
  // whether the run-1 leader won is exactly what someone who saw run 1 mustn't learn.
  const advice = score < 3 ? { code: 'highlights' }
    : f.runs === 2 && score < 9 && (f.run1Spread ?? 0) > 1 ? { code: 'skip', unit: 'run', ranges: [[1, 1]] }
    : { code: score >= 5 ? 'full' : 'highlights' };
  return { score, segments, advice, reasons: t.reasons, result: f.result };
}

export function scoreCrossCountry(f) {
  const t = tally();
  t.add(C.base, 'Base');
  const g = f.gapP2;
  if (f.sprint) {
    if (f.gapP3 != null) t.add(f.gapP3 < 1 ? C.sprintFinal : f.gapP3 < 2 ? C.sprintTight : 0, `Top 3 in the final within ${f.gapP3.toFixed(1)} s`);
  } else if (g != null) {
    const pts = f.massStart
      ? (g < 0.5 ? C.photoFinish : g < 2 ? C.closeFinish : g < 6 ? C.fairlyCloseFinish : 0)
      : (g < 3 ? C.clockUnder3 : g < 8 ? C.clockUnder8 : g < 15 ? C.clockUnder15 : 0);
    t.add(pts, `Won by ${g.toFixed(1)} s`);
    if (f.gapP3 != null && f.gapP3 < (f.massStart ? 2 : 10)) t.add(C.closePodium, `Third place ${f.gapP3.toFixed(1)} s behind`);
    if (f.massStart) t.add(f.within5 >= 6 ? C.bigGroup : f.within5 >= 3 ? C.groupFinish : 0, `${f.within5} within 5 s at the finish`);
  }
  const score = finalScore(t.total);
  return { score, segments: [], advice: { code: score >= 5 ? 'full' : 'highlights' }, reasons: t.reasons, result: f.result };
}
