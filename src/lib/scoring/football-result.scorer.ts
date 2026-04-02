/**
 * Scores a football match from result data only (no per-minute events).
 * Used when the football-data.org free tier doesn't return goal/card events.
 * All text must be spoiler-free — no goal counts, no score differential.
 */
import type { WatchabilityResult, WatchRecommendation, TimelineSegment } from '@/types/scoring';

export interface MatchResult {
  fullTimeHome: number;
  fullTimeAway: number;
  halfTimeHome: number;
  halfTimeAway: number;
  /** REGULAR | EXTRA_TIME | PENALTY_SHOOTOUT */
  duration: string;
  winner: string; // HOME_TEAM | AWAY_TEAM | DRAW
}

const NO_DATA_RESULT: WatchabilityResult = {
  score: 0,
  label: 'Skip',
  keyMomentCount: 0,
  hasData: false,
  recommendation: { type: 'highlights_only', label: 'No data yet', subLabel: 'Event data is not available for this match' },
  timelineSegments: [],
  spoilerFreeDescription: 'No event data available',
  contextBullets: [],
};

export function scoreFromResult(result: MatchResult): WatchabilityResult {
  const { fullTimeHome, fullTimeAway, halfTimeHome, halfTimeAway, duration } = result;

  if (fullTimeHome == null || fullTimeAway == null) return NO_DATA_RESULT;

  const totalGoals = fullTimeHome + fullTimeAway;
  const goalDiff = Math.abs(fullTimeHome - fullTimeAway);
  const secondHalfGoals = (fullTimeHome - (halfTimeHome ?? 0)) + (fullTimeAway - (halfTimeAway ?? 0));
  const firstHalfGoals = (halfTimeHome ?? 0) + (halfTimeAway ?? 0);
  const isDraw = result.winner === 'DRAW';
  const isExtraTime = duration === 'EXTRA_TIME';
  const isPenalties = duration === 'PENALTY_SHOOTOUT';

  let rawPoints = totalGoals * 1.1;

  if (goalDiff === 0) rawPoints += 2.0;
  else if (goalDiff === 1) rawPoints += 1.5;
  else if (goalDiff === 2) rawPoints += 0.3;
  else if (goalDiff >= 4) rawPoints -= 1.2;

  if (secondHalfGoals > firstHalfGoals) rawPoints += 0.8;
  if (secondHalfGoals > firstHalfGoals && goalDiff <= 1) rawPoints += 0.7;

  if (isPenalties) rawPoints += 3.5;
  else if (isExtraTime) rawPoints += 2.0;

  if (totalGoals === 0) rawPoints = 1.5;

  const score = Math.min(10, Math.max(1, rawPoints));
  const finalScore = parseFloat(score.toFixed(1));

  const label = scoreToLabel(finalScore);
  const recommendation = buildRecommendation(finalScore, secondHalfGoals, firstHalfGoals, isPenalties, isExtraTime);
  const contextBullets = buildContextBullets(totalGoals, goalDiff, firstHalfGoals, secondHalfGoals, isDraw, isExtraTime, isPenalties);
  const description = buildDescription(finalScore, goalDiff, secondHalfGoals, firstHalfGoals, isExtraTime, isPenalties);
  const segments = buildApproximateSegments(firstHalfGoals, secondHalfGoals);

  return {
    score: finalScore,
    label,
    hasData: true,
    keyMomentCount: totalGoals,
    recommendation,
    timelineSegments: segments,
    spoilerFreeDescription: description,
    contextBullets,
    peakMinute: secondHalfGoals > firstHalfGoals ? 65 : 20,
  };
}

/**
 * Build an approximate timeline using statistically likely goal positions.
 * Goals are NOT distributed evenly — they cluster at realistic football minutes.
 * With N goals per half we create N overlapping peaks at plausible positions.
 * This means the shape reflects reality without being exactly countable.
 */
function buildApproximateSegments(firstHalfGoals: number, secondHalfGoals: number): TimelineSegment[] {
  // Typical goal-minute distribution buckets (5-min blocks, 0-indexed within half)
  // Loosely based on real football data — goals more likely late in each half
  const FH_WEIGHTS = [0.6, 0.7, 0.9, 1.0, 0.9, 1.1, 1.2, 1.3, 1.4]; // 0–5, 5–10, …, 40–45
  const SH_WEIGHTS = [0.8, 0.9, 1.1, 1.2, 1.0, 1.1, 1.2, 1.3, 1.5, 1.6]; // 45–50, …, 90–95

  const segments: TimelineSegment[] = [];

  const sumFH = FH_WEIGHTS.reduce((a, b) => a + b, 0);
  const sumSH = SH_WEIGHTS.reduce((a, b) => a + b, 0);

  for (let i = 0; i < FH_WEIGHTS.length; i++) {
    const intensity = firstHalfGoals > 0 ? (FH_WEIGHTS[i] / sumFH) * firstHalfGoals : 0;
    segments.push({ startMinute: i * 5, endMinute: i * 5 + 5, eventCount: 0, intensity });
  }
  for (let i = 0; i < SH_WEIGHTS.length; i++) {
    const intensity = secondHalfGoals > 0 ? (SH_WEIGHTS[i] / sumSH) * secondHalfGoals : 0;
    segments.push({ startMinute: 45 + i * 5, endMinute: 45 + i * 5 + 5, eventCount: 0, intensity });
  }

  const maxIntensity = Math.max(...segments.map((s) => s.intensity), 0.01);
  return segments.map((s) => ({ ...s, intensity: s.intensity / maxIntensity }));
}

function buildRecommendation(
  score: number,
  shGoals: number,
  fhGoals: number,
  isPenalties: boolean,
  isExtraTime: boolean
): WatchRecommendation {
  if (isPenalties) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'This one went all the way — the full ride is worth it' };
  }
  if (isExtraTime) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'Could not be settled in 90 minutes — do not skip ahead' };
  }
  if (score >= 8.5) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'Action throughout — do not miss this one' };
  }
  if (score >= 6.5 && shGoals > fhGoals * 1.5) {
    return { type: 'second_half', label: 'Watch from half-time', subLabel: 'The second half is where the action is' };
  }
  if (score >= 5) {
    return { type: 'from_minute', startMinute: 45, label: 'Start at half-time', subLabel: 'Second half is the better bet' };
  }
  return { type: 'highlights_only', label: 'Highlights only', subLabel: 'A quiet match — save your time for the recap' };
}

function buildContextBullets(
  totalGoals: number,
  goalDiff: number,
  fhGoals: number,
  shGoals: number,
  isDraw: boolean,
  isExtraTime: boolean,
  isPenalties: boolean
): string[] {
  const bullets: string[] = [];

  // Overall activity level — no numbers
  if (totalGoals === 0) {
    bullets.push('Very few clear-cut moments throughout');
  } else if (totalGoals >= 6) {
    bullets.push('Relentlessly eventful from start to finish');
  } else if (totalGoals >= 4) {
    bullets.push('High activity level throughout the match');
  } else if (totalGoals >= 2) {
    bullets.push('A decent amount of action across the match');
  } else {
    bullets.push('Largely quiet with one significant moment');
  }

  // Closeness — no numbers, just tension level
  if (isPenalties) {
    bullets.push('Required a penalty shootout to find a winner');
  } else if (isExtraTime) {
    bullets.push('Needed extra time — still undecided after 90 minutes');
  } else if (isDraw) {
    bullets.push('Sides were level at the final whistle');
  } else if (goalDiff === 1) {
    bullets.push('Decided on the finest of margins');
  } else if (goalDiff >= 4) {
    bullets.push('Result was not in serious doubt for much of the match');
  } else if (goalDiff === 2 || goalDiff === 3) {
    bullets.push('Winner emerged with some comfort in the end');
  }

  // Half-by-half distribution — framed as pacing, not goal counts
  if (fhGoals > 0 && shGoals > 0) {
    if (shGoals > fhGoals * 1.5) {
      bullets.push('Second half significantly more eventful than the first');
    } else if (fhGoals > shGoals * 1.5) {
      bullets.push('First half was the more eventful of the two');
    } else {
      bullets.push('Action was spread reasonably across both halves');
    }
  } else if (shGoals > 0 && fhGoals === 0) {
    bullets.push('Quiet first half — the action all came after the break');
  } else if (fhGoals > 0 && shGoals === 0) {
    bullets.push('Everything happened in the first half — quiet second');
  }

  return bullets.slice(0, 3);
}

function buildDescription(
  score: number,
  goalDiff: number,
  shGoals: number,
  fhGoals: number,
  isExtraTime: boolean,
  isPenalties: boolean
): string {
  if (isPenalties) return 'An epic encounter that could not be settled in normal time';
  if (isExtraTime) return 'A tightly-contested match that went beyond 90 minutes';
  if (score >= 8.5) {
    if (shGoals > fhGoals) return 'An exceptional match that built to a frenetic finale';
    return 'High-intensity from the off — action throughout';
  }
  if (score >= 7) {
    if (shGoals > fhGoals) return 'A match that really came alive in the second half';
    return 'An entertaining match with plenty of moments';
  }
  if (score >= 5) {
    if (goalDiff <= 1) return 'A competitive match — tight throughout';
    return 'Some good moments but lacking consistency';
  }
  if (score >= 3) return 'A largely quiet affair with limited excitement';
  return 'Very little to get excited about in this one';
}

function scoreToLabel(score: number): WatchabilityResult['label'] {
  if (score >= 8.5) return 'Must Watch';
  if (score >= 6.5) return 'Worth It';
  if (score >= 4.5) return 'Selective';
  if (score >= 2.5) return 'Highlights';
  return 'Skip';
}
