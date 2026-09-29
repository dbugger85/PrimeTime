// ─────────────────────────────────────────────────────────────────────────────
// SCORING WEIGHTS: the points each thing adds to an event's 0–10 score.
//
// How to change one (on github.com):
//   1. Open this file in the repo and click the pencil (✏️ "Edit this file").
//   2. Change a number, keeping the comma at the end of the line.
//   3. Click "Commit changes…". GitHub then re-scores every event with the new
//      weights, and the site updates about 15 minutes later.
//
// Safety net: the tests check every weight is a number from 0 to 5, and that
// known thrillers still beat known dull matches. If a change breaks that, the
// update stops (GitHub emails you), and the site keeps the old scores until
// you change it back. Weights marked "taken off" are subtracted, so keep them
// positive too. Scores above 10 are capped at 10.
// ─────────────────────────────────────────────────────────────────────────────

export const FOOTBALL = {
  // Goals
  goal: 1.2, //               each of the first 4 goals
  extraGoal: 0.6, //          each goal after the 4th
  closeMatch: 2.0, //         if it was within one goal the whole match (less if only part of it)
  equaliser: 0.8, //          each equaliser
  leadChange: 1.0, //         each time the lead changed hands (up to 3 times)
  lateGoal: 0.5, //           each goal from 75' to 85', while the result was still open
  veryLateGoal: 1.0, //       each goal from 85', while the result was still open
  lateGoalsMax: 2.5, //       at most this much for late goals in total

  // One-sided matches
  alreadyDecided: 0.5, //     taken off: share of a goal's points when the team was already 3+ up (0.5 = half)
  nearlyDecided: 0.2, //      taken off: the same, when the team was 2 up
  blowout: 1.5, //            taken off: won by 3 goals (not when the underdog won: that's a shock, not a mismatch)
  blowoutPerGoal: 0.5, //     taken off: for each goal more than 3 in the margin
  blowoutMax: 2.5, //         taken off: at most this much for the margin

  // Team strength, from the pre-match betting odds
  teamStrength: 1.0, //       master dial for everything below: 0 = ignore team strength, 1 = normal, 2 = double
  favoriteDiscount: 0.25, //  taken off: share of the favorite's goals, times how big the mismatch was
  underdogBonus: 0.3, //      extra share for the underdog's goals, times how big the mismatch was
  upsetWin: 3.0, //           the underdog won (the full amount when the favorite was 50+ points likelier to win)
  upsetDraw: 1.5, //          the underdog got a draw (same scale)
  evenMatch: 0.5, //          the teams were evenly matched on paper

  // Intensity and drama
  shotsOnTarget7: 0.5, //     7–9 shots on target
  shotsOnTarget10: 1.0, //    10 or more shots on target
  manyShots: 0.5, //          30 or more shots in total
  dullGoalless: 0.5, //       taken off: 0–0 with 4 or fewer shots on target
  redCard: 0.6, //            each red card (up to 2)
  penalty: 0.3, //            each penalty (up to 2)
  varDisallowed: 0.6, //      each goal ruled out by VAR (up to 2)
  woodwork: 0.4, //           each shot off the post or bar (up to 3)
  manyCorners: 0.3, //        12 or more corners
  manyYellows: 0.3, //        6–8 yellow cards
  lotsOfYellows: 0.6, //      9 or more yellow cards
  extraTime: 1.0, //          went to extra time
  shootout: 1.5, //           decided on penalties
};

export const TENNIS = {
  base: 1.0, //               every match starts with this
  allSets: 3.0, //            went the full distance (3 of 3, or 5 of 5 sets)
  fourSets: 1.5, //           a best-of-5 match that went to four sets
  closeSets: 1.2, //          per close set (a tiebreak or 7-5 counts fully, 6-4 a bit less, 6-1 hardly)
  closeSetsMax: 4.0, //       at most this much for close sets
  tiebreak: 0.8, //           each tiebreak (up to 3)
  decidingTiebreak: 1.0, //   a tiebreak in the final set
  comebackOneSet: 0.5, //     the winner lost the first set
  comebackTwoSets: 1.0, //    the winner lost the first two sets
  quarterfinal: 0.3, //       it's a quarterfinal
  semifinal: 0.5, //          it's a semifinal
  final: 0.8, //              it's the final
};

export const F1 = {
  base: 1.0, //               every race starts with this
  overtakes: 3.0, //          for 60+ clean overtakes on track (fewer give a share of it)
  top5Overtake: 0.1, //       each overtake for a top-5 place (up to 1.5 in total)
  leadChange: 0.8, //         each lead change on track (up to 3)
  safetyCar: 0.7, //          each safety car
  virtualSafetyCar: 0.3, //   each virtual safety car
  redFlag: 1.0, //            each red flag
  neutralisedMax: 2.5, //     at most this much for safety cars and red flags together
  finishUnder1s: 1.5, //      the winner won by less than 1 second
  finishUnder3s: 1.0, //      … by 1–3 seconds
  finishUnder10s: 0.5, //     … by 3–10 seconds
  retirement: 0.2, //         each car that retired (up to 1 in total)
  rain: 0.5, //               it rained during the race
  lateFight: 0.5, //          a fight at the front in the last 20% of the race
};

// F1 qualifying: Q1 and Q2 knock out the slowest cars, and Q3 decides pole.
export const F1_QUALIFYING = {
  base: 1.0, //               every session starts with this
  poleUnder003: 3.0, //       pole by less than 0.03 s
  poleUnder007: 2.2, //       … by 0.03–0.07 s
  poleUnder015: 1.4, //       … by 0.07–0.15 s
  poleUnder030: 0.6, //       … by 0.15–0.3 s
  tightTop10: 1.5, //         the whole top 10 within 0.6 s of pole in Q3
  closeTop10: 0.8, //         … within 0.9 s
  fairlyCloseTop10: 0.3, //   … within 1.2 s
  poleChange: 0.4, //         each time provisional pole changed hands in Q3 (up to 2 in total)
  latePoleChange: 0.6, //     each change in the last 4 minutes of Q3 (up to 1.5 in total)
  knifeEdgeCut: 0.6, //       a knockout in Q1 or Q2 decided by less than 0.02 s (each)
  closeCut: 0.3, //           … by 0.02–0.05 s (each)
  redFlag: 0.6, //            each red flag (up to 2.5 in total)
  redFlagInQ3: 0.5, //        extra for a red flag in Q3
  deletedLapQ3: 0.3, //       each lap deleted in Q3, e.g. for track limits (up to 0.9)
  rain: 1.0, //               it rained during the session
};
