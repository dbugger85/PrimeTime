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
  alreadyDecided: 0.35, //    taken off: share of a goal's points when the team was already 3+ up (0.5 = half)
  nearlyDecided: 0.14, //     taken off: the same, when the team was 2 up
  blowout: 1.5, //            taken off: won by 3 or more goals, whatever the margin (not when the underdog won: that's a shock, not a mismatch)

  // Team strength, from the pre-match betting odds
  teamStrength: 1.0, //       master dial for everything below: 0 = ignore team strength, 1 = normal, 2 = double
  favoriteDiscount: 0.25, //  taken off: share of the favorite's goals, times how big the mismatch was
  underdogBonus: 0.3, //      extra share for the underdog's goals, times how big the mismatch was
  upsetWin: 3.0, //           the underdog won (the full amount when the favorite was 50+ points likelier to win)
  upsetDraw: 1.5, //          the underdog got a draw, or took the favorite to penalties (same scale)
  upsetShootout: 2.0, //      the underdog won on penalties (same scale)
  evenMatch: 0.5, //          the teams were evenly matched on paper

  // Intensity and drama
  chances: 1.5, //            with xG: an open match full of good chances (nothing under 1.5 expected goals in total, the full amount at 4.0)
  againstTheRun: 1.0, //      with xG: the winner created the worse chances (half at 1 expected goal less, the full amount at 2)
  shotsOnTarget7: 0.5, //     without xG only: 7–9 shots on target
  shotsOnTarget10: 1.0, //    without xG only: 10 or more shots on target
  manyShots: 0.5, //          without xG only: 30 or more shots in total
  dullGoalless: 0.5, //       taken off: 0–0 with chances worth under 1.5 expected goals (without xG: 4 or fewer shots on target)
  redCard: 0.6, //            each red card (up to 2)
  penalty: 0.3, //            each penalty (up to 2)
  varDisallowed: 0.6, //      each goal ruled out by VAR (up to 2)
  woodwork: 0.4, //           each shot off the post or bar (up to 3)
  manyCorners: 0.3, //        12 or more corners
  manyYellows: 0.3, //        6–8 yellow cards
  lotsOfYellows: 0.6, //      9 or more yellow cards
  extraTime: 1.0, //          went to extra time
  shootout: 1.5, //           decided on penalties

  // What was at stake, from the league table before kick-off (only for matches
  // seen in "Coming up" before they started)
  titleRace: 0.5, //          a title race
  relegationBattle: 0.4, //   a relegation battle
  otherRace: 0.2, //          top-4, top-8, European spots, play-off spots, top of the group, qualifying

  // Big match, from the teams' Elo ratings (not the odds): clubs are compared with the rest of
  // their own league, national teams with the whole world
  bigMatch: 0.2, //           two of the strongest teams: all points ×1.2; two of the weakest: ×0.8; an average pair: ×1 (0 = off)

  // The top end
  curveFrom: 5, //            above this, each point counts a bit less than the one before, so scores bend towards 10 and a 10 is almost impossible (lower = stricter; from 0 to 9)
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

export const F1 = { // races and sprints (qualifying has no score)
  base: 1.0, //               every race starts with this
  overtakes: 3.0, //          for 60+ clean overtakes on track (fewer give a share of it)
  top5Overtake: 0.1, //       each overtake for a top-5 place
  top5OvertakesMax: 1.5, //   at most this much for top-5 overtakes in total
  frontFight: 0.5, //         each pass for 1st, 2nd or 3rd on track (not at the start)
  frontFightsMax: 2.0, //     at most this much for top-3 passes in total
  safetyCar: 0.7, //          each safety car
  virtualSafetyCar: 0.3, //   each virtual safety car
  redFlag: 1.0, //            each red flag
  neutralisedMax: 2.5, //     at most this much for safety cars and red flags together
  finishUnder1s: 1.5, //      the winner won by less than 1 second
  finishUnder3s: 1.0, //      … by 1–3 seconds
  finishUnder10s: 0.5, //     … by 3–10 seconds
  retirement: 0.2, //         each car that retired
  retirementsMax: 1.0, //     at most this much for retirements in total
  rain: 0.5, //               it rained during the race
  lateFight: 0.5, //          a fight at the front in the last 20% of the race
};

// Biathlon. "Head-to-head" races (pursuit, mass start, relays) are ones where
// the first across the line wins; in the others (sprint, individual) skiers
// start one by one and race the clock.
export const BIATHLON = {
  base: 2.0, //               every race starts with this (biathlon is rarely dull to watch)
  photoFinish: 3.0, //        head-to-head: won by less than 1 s
  closeFinish: 2.2, //        … by 1–3 s
  fairlyCloseFinish: 1.4, //  … by 3–8 s
  someFight: 0.6, //          … by 8–15 s
  clockUnder2: 2.5, //        against the clock: won by less than 2 s
  clockUnder5: 1.8, //        … by 2–5 s
  clockUnder10: 1.0, //       … by 5–10 s
  clockUnder20: 0.4, //       … by 10–20 s
  closePodium: 0.8, //        third place close too (5 s head-to-head, 10 s against the clock)
  openRace: 1.2, //           against the clock: 6 or more within 30 s of the winner
  fairlyOpenRace: 0.6, //     … 4–5 within 30 s
  bigGroup: 0.8, //           head-to-head: 4 or more within 10 s at the finish
  leadChange: 0.5, //         each time the lead changed after a shooting (up to 2.5)
  leadChangesMax: 2.5, //     at most this much for lead changes in total
  lastShootingTwist: 1.5, //  the leader after the last shooting (or handover) didn't win
  comebackPursuit: 1.0, //    pursuit won from 6th or further back at the start
  bigComebackPursuit: 1.5, // … from 11th or further back
  comebackMassStart: 0.8, //  mass start won by someone who was 8th or worse after a shooting
  chaosAtRange: 0.6, //       head-to-head: 5+ misses by the top 10 at the last shooting (3+ penalty loops in relays)
};

// Alpine skiing. Slalom and giant slalom have two runs; downhill and super-G one.
export const ALPINE = {
  base: 2.5, //               every race starts with this
  under005: 3.0, //           won by less than 0.05 s
  under015: 2.3, //           … by 0.05–0.15 s
  under030: 1.6, //           … by 0.15–0.30 s
  under060: 0.8, //           … by 0.30–0.60 s
  tightTop5: 1.2, //          top 5 within 0.5 s
  closeTop5: 0.6, //          … within 1.0 s
  comeback: 1.2, //           two runs: won from 4th or worse after run 1
  bigComeback: 1.8, //        … from 8th or worse
  leaderLost: 1.0, //         two runs: the leader after run 1 didn't win
  lateBibPodium: 0.8, //      one run: someone starting 30th or later reached the podium
  bigMoverTop10: 0.5, //      two runs: someone climbed 10+ places into the top 10
};

// Cross-country skiing (FIS publishes only finish times, no split times).
export const CROSS_COUNTRY = {
  base: 2.5, //               every race starts with this
  photoFinish: 3.0, //        mass start or pursuit: won by less than 0.5 s
  closeFinish: 2.2, //        … by 0.5–2 s
  fairlyCloseFinish: 1.2, //  … by 2–6 s
  clockUnder3: 2.5, //        interval start: won by less than 3 s
  clockUnder8: 1.6, //        … by 3–8 s
  clockUnder15: 0.8, //       … by 8–15 s
  bigGroup: 1.2, //           mass start or pursuit: 6 or more within 5 s at the finish
  groupFinish: 0.6, //        … 3–5 within 5 s
  closePodium: 0.8, //        third place within 2 s (mass start) or 10 s (interval start)
  sprintFinal: 2.0, //        sprints: the final was close (top 3 within 1 s)
  sprintTight: 1.0, //        … within 2 s
};

// The "Promising" / "Could be quiet" outlook on upcoming football (src/prematch.mjs), from the
// odds before kick-off. A rough guess on purpose: tested on 130 matches, excitement is hard to
// predict. These don't change any score, so editing them doesn't re-score anything.
export const FOOTBALL_OUTLOOK = {
  expectedGoals: 0.4, //      per goal the bookmakers expect above 2.8 (or below: then taken off)
  mismatch: 1.8, //           taken off: times how much likelier the favorite is to win (0–1)
};
