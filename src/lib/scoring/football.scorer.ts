/**
 * Event-based football watchability scorer — 0 to 100 scale.
 *
 * Formula has four independent components that sum to a final score:
 *
 *   1. Goal Volume       — diminishing-returns points per goal (max ≈ 83)
 *   2. Match Closeness   — bonus/penalty based on goal difference
 *   3. Action Volume     — points per shot on target (max 15)
 *   4. Drama Factor      — flat bonuses for red cards, penalties, late goals, ET
 *
 * Calibration targets:
 *   • 2-goal match (any result)   → 46–71 ("Solid" or just into "Watchable")
 *   • 2-1 or 1-1                  → 71–79 ("Watchable")
 *   • 3-goal match (tight result) → 79–89 ("Watchable")
 *   • 4+ goals or drama events    → 90+ ("Thriller")
 *   • Blowout 4-0                 → ~58 ("Solid")
 */
import type { NormalizedEvent, TimelineSegment, WatchabilityResult, WatchRecommendation, WatchabilityLabel } from '@/types/scoring';
import type { MatchEvent } from '@/types/match';

const MATCH_DURATION = 95;
const SEGMENT_SIZE = 5;

// ─── Component weights ─────────────────────────────────────────────────────

/** Diminishing returns per goal. Goals beyond index 4 contribute 5 pts each. */
const GOAL_BRACKETS = [20, 18, 15, 10, 7];

/**
 * Closeness bonus/penalty based on absolute goal difference.
 *   0 diff (draw)  → +25
 *   1 diff         → +18
 *   2 diff         → +8
 *   3 diff         → +3
 *   4+ diff        → -5 (blowout penalty)
 */
const CLOSENESS_BY_DIFF = [25, 18, 8, 3];
const BLOWOUT_PENALTY = -5;

const DRAMA_RED_CARD = 8;       // per card, max 2 applied
const DRAMA_PENALTY = 5;        // per penalty, max 2 applied
const DRAMA_LATE_GOAL = 4;      // per goal in min 75+, max 2 applied
const DRAMA_EXTRA_TIME = 6;     // match went to ET
const DRAMA_SHOOTOUT = 12;      // match decided by penalties
const DISTRIBUTION_BONUS = 5;  // goals in both halves

// ─── No-data sentinel ──────────────────────────────────────────────────────

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

// ─── Main export ───────────────────────────────────────────────────────────

/**
 * @param events  Per-minute match events from the API
 * @param goalDiff  Absolute goal difference from the final score (pass when available
 *                  for accurate closeness bonus; defaults to 0 which gives draw bonus)
 */
export function scoreFootballMatch(events: MatchEvent[], goalDiff = 0): WatchabilityResult {
  if (events.length === 0) return NO_DATA_RESULT;

  const normalized = normalizeEvents(events);
  const segments = buildSegments(normalized, MATCH_DURATION);

  // ── Component 1: Goal Volume ──
  const goals = events.filter((e) =>
    ['GOAL', 'OWN_GOAL'].includes(e.type?.toUpperCase() ?? '')
  );
  const goalVolume = computeGoalVolume(goals.length);

  // ── Component 2: Match Closeness ──
  const closeness = computeCloseness(goalDiff);

  // ── Component 3: Action Volume (shots on target) ──
  const shots = events.filter((e) => e.type?.toUpperCase() === 'SHOT_ON_TARGET').length;
  const actionVolume = Math.min(shots, 15);

  // ── Component 4: Drama Factor ──
  const redCards = events.filter((e) =>
    ['RED_CARD', 'YELLOW_RED'].includes(e.type?.toUpperCase() ?? '')
  ).length;
  const penalties = events.filter((e) => e.type?.toUpperCase() === 'PENALTY').length;
  const lateGoals = goals.filter((e) => e.minute >= 75).length;
  const hasExtraTime = events.some((e) => e.minute > 90);
  const hasPenaltyShootout = events.some((e) =>
    e.type?.toUpperCase() === 'PENALTY_SHOOTOUT'
  );

  let drama = 0;
  drama += Math.min(redCards, 2) * DRAMA_RED_CARD;
  drama += Math.min(penalties, 2) * DRAMA_PENALTY;
  drama += Math.min(lateGoals, 2) * DRAMA_LATE_GOAL;
  if (hasPenaltyShootout) drama += DRAMA_SHOOTOUT;
  else if (hasExtraTime) drama += DRAMA_EXTRA_TIME;

  // ── Distribution bonus: goals in both halves ──
  const firstHalfGoals = goals.filter((e) => e.minute <= 45).length;
  const secondHalfGoals = goals.filter((e) => e.minute > 45).length;
  const distribution = firstHalfGoals > 0 && secondHalfGoals > 0 ? DISTRIBUTION_BONUS : 0;

  const rawScore = goalVolume + closeness + actionVolume + drama + distribution;
  const finalScore = Math.round(Math.min(100, Math.max(0, rawScore)));

  const label = scoreToLabel(finalScore);
  const recommendation = buildRecommendation(normalized, segments, finalScore);
  const peakSegment = segments.reduce((a, b) => (a.intensity > b.intensity ? a : b), segments[0]);
  const contextBullets = buildContextBullets(
    normalized, finalScore, goals.length, goalDiff, redCards, penalties,
    lateGoals, firstHalfGoals, secondHalfGoals, hasExtraTime, hasPenaltyShootout
  );

  return {
    score: finalScore,
    label,
    hasData: true,
    keyMomentCount: normalized.filter(
      (e) => e.excitementTier === 'critical' || e.excitementTier === 'high'
    ).length,
    recommendation,
    timelineSegments: segments,
    spoilerFreeDescription: buildDescription(finalScore, goalDiff, lateGoals, firstHalfGoals, secondHalfGoals, hasExtraTime, hasPenaltyShootout),
    contextBullets,
    highlightPeriods: buildHighlightPeriods(events),
    peakMinute: peakSegment?.startMinute,
  };
}

// ─── Scoring helpers ───────────────────────────────────────────────────────

/**
 * Diminishing returns: 1st goal=20, 2nd=18, 3rd=15, 4th=10, 5th+=7 pts.
 *
 * Proof: 2 goals=38, 3 goals=53, 4 goals=63, 5 goals=70, 6 goals=77
 */
function computeGoalVolume(goalCount: number): number {
  let pts = 0;
  for (let i = 0; i < goalCount; i++) {
    pts += i < GOAL_BRACKETS.length ? GOAL_BRACKETS[i] : 5;
  }
  return pts;
}

/**
 * Closeness bonus: tighter scoreline = more points.
 * Blowout (4+) receives a penalty instead.
 */
function computeCloseness(goalDiff: number): number {
  if (goalDiff >= CLOSENESS_BY_DIFF.length) return BLOWOUT_PENALTY;
  return CLOSENESS_BY_DIFF[goalDiff];
}

// ─── Highlight Periods ─────────────────────────────────────────────────────

/**
 * For every Goal, Penalty, Red Card, or Big Chance, create a watch window
 * from 60 seconds before to 15 seconds after the event.
 * Overlapping windows are merged into a single continuous block.
 */
function buildHighlightPeriods(events: MatchEvent[]): string[] {
  const KEY_TYPES = new Set([
    'GOAL', 'OWN_GOAL', 'PENALTY', 'RED_CARD', 'YELLOW_RED', 'BIG_CHANCE',
  ]);

  // Build [start, end] windows in seconds
  const windows = events
    .filter((e) => KEY_TYPES.has(e.type?.toUpperCase() ?? ''))
    .map((e) => ({
      start: Math.max(0, e.minute * 60 - 60), // 60s before
      end: e.minute * 60 + 15,                 // 15s after
    }))
    .sort((a, b) => a.start - b.start);

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

  return merged.map((w) => `${toTimestamp(w.start)} to ${toTimestamp(w.end)}`);
}

function toTimestamp(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ─── Normalised events + segments ─────────────────────────────────────────

// Event weights used only for timeline intensity and keyMomentCount
const TIMELINE_WEIGHTS: Record<string, number> = {
  GOAL: 6,
  OWN_GOAL: 5,
  PENALTY: 4,
  RED_CARD: 4,
  YELLOW_RED: 3,
  BIG_CHANCE: 3,
  VAR: 2,
  YELLOW_CARD: 1,
  SUBSTITUTION: 0.5,
};

function normalizeEvents(events: MatchEvent[]): NormalizedEvent[] {
  return events.map((e) => {
    const type = e.type?.toUpperCase() ?? '';
    const weight = TIMELINE_WEIGHTS[type] ?? 1;
    const isLateGame = e.minute >= 75;

    let excitementTier: NormalizedEvent['excitementTier'] = 'low';
    if (weight >= 5) excitementTier = 'critical';
    else if (weight >= 3) excitementTier = 'high';
    else if (weight >= 1.5) excitementTier = 'medium';

    const categoryMap: Record<string, string> = {
      GOAL: 'Key Moment',
      OWN_GOAL: 'Key Moment',
      RED_CARD: 'Game Changer',
      YELLOW_RED: 'Game Changer',
      PENALTY: 'Penalty',
      BIG_CHANCE: 'Big Chance',
      VAR: 'VAR Review',
      YELLOW_CARD: 'Booking',
      SUBSTITUTION: 'Tactical Change',
    };

    return {
      minute: e.minute,
      weight,
      excitementTier,
      category: categoryMap[type] ?? 'Event',
      isLateGame,
    };
  });
}

function buildSegments(events: NormalizedEvent[], duration: number): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (let start = 0; start < duration; start += SEGMENT_SIZE) {
    const end = Math.min(start + SEGMENT_SIZE, duration);
    const segEvents = events.filter((e) => e.minute >= start && e.minute < end);
    const intensity = segEvents.reduce((sum, e) => sum + e.weight, 0);
    segments.push({ startMinute: start, endMinute: end, eventCount: segEvents.length, intensity });
  }
  const maxIntensity = Math.max(...segments.map((s) => s.intensity), 1);
  return segments.map((s) => ({ ...s, intensity: s.intensity / maxIntensity }));
}

// ─── Context bullets ───────────────────────────────────────────────────────

function buildContextBullets(
  events: NormalizedEvent[],
  score: number,
  goalCount: number,
  goalDiff: number,
  redCards: number,
  penalties: number,
  lateGoals: number,
  fhGoals: number,
  shGoals: number,
  hasExtraTime: boolean,
  hasPenaltyShootout: boolean
): string[] {
  const bullets: string[] = [];

  // Overall activity — no numbers exposed
  if (goalCount === 0) {
    bullets.push('No goals — match decided by other factors');
  } else if (goalCount >= 6) {
    bullets.push('Relentlessly eventful from start to finish');
  } else if (goalCount >= 4) {
    bullets.push('High activity level throughout');
  } else if (goalCount >= 2) {
    bullets.push('A decent amount of action across the match');
  } else {
    bullets.push('Largely quiet with one significant moment');
  }

  // Closeness — no numbers, tension level only
  if (hasPenaltyShootout) {
    bullets.push('Required a penalty shootout to find a winner');
  } else if (hasExtraTime) {
    bullets.push('Needed extra time — still level after 90 minutes');
  } else if (goalDiff === 0) {
    bullets.push('Teams level at the final whistle');
  } else if (goalDiff === 1) {
    bullets.push('Decided on the finest of margins');
  } else if (goalDiff >= 4) {
    bullets.push('Result not in serious doubt for much of the match');
  } else {
    bullets.push('Winner emerged with some comfort in the end');
  }

  // Half distribution
  if (fhGoals > 0 && shGoals > 0) {
    if (shGoals > fhGoals * 1.5) bullets.push('Second half significantly more eventful');
    else if (fhGoals > shGoals * 1.5) bullets.push('First half was the livelier of the two');
    else bullets.push('Action spread fairly across both halves');
  } else if (shGoals > 0 && fhGoals === 0) {
    bullets.push('Quiet first half — action came after the break');
  } else if (fhGoals > 0 && shGoals === 0) {
    bullets.push('Everything happened in the first half');
  }

  // Drama extras
  if (lateGoals >= 1) bullets.push('Late drama changed the picture');
  if (redCards >= 1) bullets.push(`A red card altered the balance of play`);
  if (penalties >= 1) bullets.push('A penalty added to the tension');

  return bullets.slice(0, 4);
}

// ─── Description ──────────────────────────────────────────────────────────

function buildDescription(
  score: number,
  goalDiff: number,
  lateGoals: number,
  fhGoals: number,
  shGoals: number,
  hasExtraTime: boolean,
  hasPenaltyShootout: boolean
): string {
  if (hasPenaltyShootout) return 'An epic encounter that could not be settled in normal time';
  if (hasExtraTime) return 'A tightly contested match that went beyond 90 minutes';
  if (score >= 90) {
    if (lateGoals >= 2) return 'An exceptional match — drama from start to finish with a frenetic finale';
    return 'A high-intensity match packed with action throughout';
  }
  if (score >= 70) {
    if (lateGoals >= 1) return 'An exciting match that really came alive in the final stages';
    if (shGoals > fhGoals) return 'A match that built momentum across both halves';
    return 'A good match with several significant moments';
  }
  if (score >= 40) {
    if (goalDiff === 0) return 'A competitive encounter — neither side could find a winner';
    return 'Some interesting moments but lacking consistent action';
  }
  return 'A quiet affair — limited action throughout';
}

// ─── Label + Recommendation ───────────────────────────────────────────────

function scoreToLabel(score: number): WatchabilityLabel {
  if (score >= 90) return 'Thriller';
  if (score >= 70) return 'Watchable';
  if (score >= 40) return 'Solid';
  return 'Quiet';
}

function buildRecommendation(
  events: NormalizedEvent[],
  segments: TimelineSegment[],
  score: number
): WatchRecommendation {
  if (score >= 90) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'Action throughout — do not miss this one' };
  }

  const firstHalfIntensity = segments
    .filter((s) => s.startMinute < 45)
    .reduce((sum, s) => sum + s.intensity, 0);
  const secondHalfIntensity = segments
    .filter((s) => s.startMinute >= 45)
    .reduce((sum, s) => sum + s.intensity, 0);
  const final20Events = events.filter((e) => e.minute >= 70);
  const highLateEvents = final20Events.filter(
    (e) => e.excitementTier === 'critical' || e.excitementTier === 'high'
  );

  if (score >= 70 && highLateEvents.length >= 2 && firstHalfIntensity < secondHalfIntensity * 0.45) {
    return { type: 'second_half', label: 'Watch from half-time', subLabel: 'The second half is where the action is' };
  }

  if (highLateEvents.length >= 2 && score >= 50) {
    const startMinute = Math.max(60, (final20Events[0]?.minute ?? 70) - 5);
    return {
      type: 'final_n_minutes',
      startMinute,
      label: `Jump to minute ${startMinute}`,
      subLabel: `Key moments in the final stretch`,
    };
  }

  if (score >= 40) {
    let bestStart = 0;
    let bestSum = 0;
    for (const seg of segments) {
      const windowSum = segments
        .filter((s) => s.startMinute >= seg.startMinute && s.startMinute < seg.startMinute + 20)
        .reduce((sum, s) => sum + s.intensity, 0);
      if (windowSum > bestSum) { bestSum = windowSum; bestStart = seg.startMinute; }
    }
    const startMinute = Math.max(0, bestStart - 5);
    return { type: 'from_minute', startMinute, label: `Start at minute ${startMinute}`, subLabel: 'Most of the action is from here' };
  }

  return { type: 'highlights_only', label: 'Highlights only', subLabel: 'A quiet match — save your time for the recap' };
}
