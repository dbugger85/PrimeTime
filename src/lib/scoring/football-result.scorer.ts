/**
 * Result-only football scorer — 0 to 100 scale.
 * Used when the API returns the final score but no per-minute events.
 *
 * Uses the same four-component formula as the event scorer:
 *   1. Goal Volume   — diminishing returns per goal
 *   2. Closeness     — bonus/penalty from goal difference
 *   3. Action Volume — 0 (no shot data available from free tier)
 *   4. Drama Factor  — extra time / penalty shootout bonuses
 *
 * Half-time score is used to estimate the distribution bonus.
 * All text is spoiler-free — no goal counts, no score differentials shown.
 */
import type { WatchabilityResult, WatchRecommendation, TimelineSegment, WatchabilityLabel } from '@/types/scoring';

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
  label: 'Quiet',
  keyMomentCount: 0,
  hasData: false,
  recommendation: {
    type: 'highlights_only',
    label: 'No data yet',
    subLabel: 'Event data is not available for this match',
  },
  timelineSegments: [],
  spoilerFreeDescription: 'No event data available',
  contextBullets: [],
  highlightPeriods: [],
};

/** Diminishing returns per goal — mirrors football.scorer.ts */
const GOAL_BRACKETS = [20, 18, 15, 10, 7];
const CLOSENESS_BY_DIFF = [25, 18, 8, 3];
const BLOWOUT_PENALTY = -5;

export function scoreFromResult(result: MatchResult): WatchabilityResult {
  const { fullTimeHome, fullTimeAway, halfTimeHome, halfTimeAway, duration, winner } = result;

  if (fullTimeHome == null || fullTimeAway == null) return NO_DATA_RESULT;

  const totalGoals = fullTimeHome + fullTimeAway;
  const goalDiff = Math.abs(fullTimeHome - fullTimeAway);
  const fhGoals = (halfTimeHome ?? 0) + (halfTimeAway ?? 0);
  const shGoals = totalGoals - fhGoals;
  const isPenalties = duration === 'PENALTY_SHOOTOUT';
  const isExtraTime = duration === 'EXTRA_TIME';

  // ── Component 1: Goal Volume ──
  let pts = 0;
  for (let i = 0; i < totalGoals; i++) {
    pts += i < GOAL_BRACKETS.length ? GOAL_BRACKETS[i] : 5;
  }
  const goalVolume = pts;

  // ── Component 2: Closeness ──
  const closeness = goalDiff >= CLOSENESS_BY_DIFF.length
    ? BLOWOUT_PENALTY
    : CLOSENESS_BY_DIFF[goalDiff];

  // ── Component 3: Action Volume — not available without event data ──
  const actionVolume = 0;

  // ── Component 4: Drama Factor ──
  let drama = 0;
  if (isPenalties) drama += 12;
  else if (isExtraTime) drama += 6;

  // ── Distribution bonus: goals in both halves (from half-time score) ──
  const distribution = fhGoals > 0 && shGoals > 0 ? 5 : 0;

  const rawScore = goalVolume + closeness + actionVolume + drama + distribution;
  const finalScore = Math.round(Math.min(100, Math.max(0, rawScore)));

  const label = scoreToLabel(finalScore);
  const recommendation = buildRecommendation(finalScore, shGoals, fhGoals, isPenalties, isExtraTime);
  const contextBullets = buildContextBullets(totalGoals, goalDiff, fhGoals, shGoals, winner === 'DRAW', isExtraTime, isPenalties);
  const description = buildDescription(finalScore, goalDiff, shGoals, fhGoals, isExtraTime, isPenalties);
  const segments = buildApproximateSegments(fhGoals, shGoals);
  const highlightPeriods = buildApproximateHighlightPeriods(segments, totalGoals);

  return {
    score: finalScore,
    label,
    hasData: true,
    keyMomentCount: totalGoals,
    recommendation,
    timelineSegments: segments,
    spoilerFreeDescription: description,
    contextBullets,
    highlightPeriods,
    peakMinute: shGoals > fhGoals ? 65 : 20,
  };
}

// ─── Approximate timeline ──────────────────────────────────────────────────

/**
 * Distributes goals across time using real-world football goal-minute distributions.
 * Goals cluster toward the end of each half (minutes 35–45, 75–90).
 * This creates a realistic shape even without exact event timestamps.
 */
function buildApproximateSegments(firstHalfGoals: number, secondHalfGoals: number): TimelineSegment[] {
  // Weight per 5-min bucket — loosely based on Opta/Statsbomb goal-minute distributions
  const FH_WEIGHTS = [0.6, 0.7, 0.9, 1.0, 0.9, 1.1, 1.2, 1.3, 1.4]; // 0–45 (9 buckets)
  const SH_WEIGHTS = [0.8, 0.9, 1.1, 1.2, 1.0, 1.1, 1.2, 1.3, 1.5, 1.6]; // 45–95 (10 buckets)

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

/**
 * Derives approximate watch windows from the peak intensity segments.
 * Picks the top N segments (one per goal), creates a ±1-minute window around
 * each, merges overlaps, and prefixes with "~" to signal they are estimates.
 */
function buildApproximateHighlightPeriods(segments: TimelineSegment[], totalGoals: number): string[] {
  if (totalGoals === 0) return [];

  // Pick the highest-intensity segments — one per goal, up to 5
  const peaks = [...segments]
    .sort((a, b) => b.intensity - a.intensity)
    .slice(0, Math.min(totalGoals, 5))
    .sort((a, b) => a.startMinute - b.startMinute);

  // Create watch windows: 1 minute before segment start, 1 minute after segment end
  const windows = peaks.map((seg) => ({
    start: Math.max(0, (seg.startMinute - 1) * 60),
    end: (seg.endMinute + 1) * 60,
  }));

  // Merge overlapping windows
  const merged: Array<{ start: number; end: number }> = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }

  return merged.map((w) => `~${toTimestamp(w.start)} to ${toTimestamp(w.end)}`);
}

function toTimestamp(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Context bullets ───────────────────────────────────────────────────────

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

  if (totalGoals === 0) {
    bullets.push('No goals — very few clear-cut moments throughout');
  } else if (totalGoals >= 6) {
    bullets.push('Relentlessly eventful from start to finish');
  } else if (totalGoals >= 4) {
    bullets.push('High activity level throughout the match');
  } else if (totalGoals >= 2) {
    bullets.push('A decent amount of action across the match');
  } else {
    bullets.push('Largely quiet with one significant moment');
  }

  if (isPenalties) {
    bullets.push('Required a penalty shootout to find a winner');
  } else if (isExtraTime) {
    bullets.push('Needed extra time — still level after 90 minutes');
  } else if (isDraw) {
    bullets.push('Teams level at the final whistle');
  } else if (goalDiff === 1) {
    bullets.push('Decided on the finest of margins');
  } else if (goalDiff >= 4) {
    bullets.push('Result not in serious doubt for much of the match');
  } else {
    bullets.push('Winner emerged with some comfort in the end');
  }

  if (fhGoals > 0 && shGoals > 0) {
    if (shGoals > fhGoals * 1.5) bullets.push('Second half significantly more eventful than the first');
    else if (fhGoals > shGoals * 1.5) bullets.push('First half was the livelier of the two');
    else bullets.push('Action spread reasonably across both halves');
  } else if (shGoals > 0 && fhGoals === 0) {
    bullets.push('Quiet first half — the action all came after the break');
  } else if (fhGoals > 0 && shGoals === 0) {
    bullets.push('Everything happened in the first half — quiet second');
  }

  return bullets.slice(0, 3);
}

// ─── Description ──────────────────────────────────────────────────────────

function buildDescription(
  score: number,
  goalDiff: number,
  shGoals: number,
  fhGoals: number,
  isExtraTime: boolean,
  isPenalties: boolean
): string {
  if (isPenalties) return 'An epic encounter that could not be settled in normal time';
  if (isExtraTime) return 'A tightly contested match that went beyond 90 minutes';
  if (score >= 90) {
    if (shGoals > fhGoals) return 'An exceptional match that built to a frenetic finale';
    return 'High-intensity from the off — action throughout';
  }
  if (score >= 70) {
    if (shGoals > fhGoals) return 'A match that really came alive in the second half';
    return 'An entertaining match with plenty of moments';
  }
  if (score >= 40) {
    if (goalDiff === 0) return 'A competitive match — tight throughout';
    return 'Some good moments but lacking consistency';
  }
  return 'A largely quiet affair with limited excitement';
}

// ─── Label + Recommendation ───────────────────────────────────────────────

function scoreToLabel(score: number): WatchabilityLabel {
  if (score >= 90) return 'Thriller';
  if (score >= 70) return 'Watchable';
  if (score >= 40) return 'Solid';
  return 'Quiet';
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
  if (score >= 90) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'Action throughout — do not miss this one' };
  }
  if (score >= 70 && shGoals > fhGoals * 1.5) {
    return { type: 'second_half', label: 'Watch from half-time', subLabel: 'The second half is where the action is' };
  }
  if (score >= 50) {
    return { type: 'from_minute', startMinute: 45, label: 'Start at half-time', subLabel: 'Second half is the better bet' };
  }
  return { type: 'highlights_only', label: 'Highlights only', subLabel: 'A quiet match — save your time for the recap' };
}
