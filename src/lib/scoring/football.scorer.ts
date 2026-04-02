import type { NormalizedEvent, TimelineSegment, WatchabilityResult, WatchRecommendation } from '@/types/scoring';
import type { MatchEvent } from '@/types/match';

const MATCH_DURATION = 95;
const SEGMENT_SIZE = 5;

// Recalibrated weights:
// Targets: 1-goal game ≈ 1.5–2, 2-1 ≈ 3–4, 3-2 ≈ 5–6, 4-goal thriller ≈ 7–8, 6+ goals + drama ≈ 9–10
const EVENT_WEIGHTS: Record<string, number> = {
  GOAL: 6.0,
  OWN_GOAL: 5.0,
  PENALTY: 2.5,      // scored or saved — still high drama
  RED_CARD: 3.5,     // game-changing but doesn't add excitement like a goal
  YELLOW_RED: 2.0,
  VAR: 1.2,
  YELLOW_CARD: 0.3,
  SUBSTITUTION: 0.1,
};

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

export function scoreFootballMatch(events: MatchEvent[]): WatchabilityResult {
  if (events.length === 0) return NO_DATA_RESULT;

  const normalized = normalizeEvents(events);
  const segments = buildSegments(normalized, MATCH_DURATION);

  let rawPoints = normalized.reduce((sum, e) => sum + e.weight, 0);

  const firstHalfEvents = normalized.filter((e) => e.minute <= 45);
  const secondHalfEvents = normalized.filter((e) => e.minute > 45);
  const lateEvents = normalized.filter((e) => e.minute >= 75);
  const extraTimeEvents = normalized.filter((e) => e.minute > 90);

  // Distribution bonus — action spread across both halves (max +1.5)
  const firstHalfScore = firstHalfEvents.reduce((s, e) => s + e.weight, 0);
  const secondHalfScore = secondHalfEvents.reduce((s, e) => s + e.weight, 0);
  const totalHalfScore = firstHalfScore + secondHalfScore;
  const balance = totalHalfScore > 0
    ? 1 - Math.abs(firstHalfScore - secondHalfScore) / totalHalfScore
    : 0;
  rawPoints += balance * 1.5;

  // Late drama bonus (max +2.5)
  const lateDramaBonus = Math.min(
    lateEvents.reduce((s, e) => s + e.weight * 0.12, 0),
    2.5
  );
  rawPoints += lateDramaBonus;

  // Extra time bonus
  rawPoints += extraTimeEvents.length * 1.2;

  // Dead stretch penalty: gap > 25 minutes with no meaningful events
  const sortedMinutes = normalized
    .filter((e) => e.weight >= 1.0)
    .map((e) => e.minute)
    .sort((a, b) => a - b);
  let deadStretchPenalty = 0;
  for (let i = 1; i < sortedMinutes.length; i++) {
    if (sortedMinutes[i] - sortedMinutes[i - 1] > 25) deadStretchPenalty += 0.5;
  }
  rawPoints -= deadStretchPenalty;

  // Normalize: factor 4.5 → a 4-goal well-distributed match ≈ 7, needs 6+ goals + drama for 9+
  const normalizationFactor = 4.5;
  const score = Math.min(10, Math.max(1, rawPoints / normalizationFactor));
  const finalScore = parseFloat(score.toFixed(1));

  const recommendation = buildRecommendation(normalized, segments, finalScore);
  const label = scoreToLabel(finalScore);
  const peakSegment = segments.reduce((a, b) => (a.intensity > b.intensity ? a : b), segments[0]);
  const contextBullets = buildContextBullets(normalized, finalScore, firstHalfEvents, secondHalfEvents, lateEvents, extraTimeEvents);

  return {
    score: finalScore,
    label,
    hasData: true,
    keyMomentCount: normalized.filter(
      (e) => e.excitementTier === 'critical' || e.excitementTier === 'high'
    ).length,
    recommendation,
    timelineSegments: segments,
    spoilerFreeDescription: buildDescription(normalized, finalScore, lateEvents, firstHalfEvents),
    contextBullets,
    peakMinute: peakSegment?.startMinute,
  };
}

function normalizeEvents(events: MatchEvent[]): NormalizedEvent[] {
  return events.map((e) => {
    const type = e.type?.toUpperCase() || '';
    const weight = EVENT_WEIGHTS[type] ?? 0.3;
    const isLateGame = e.minute >= 75;

    let excitementTier: NormalizedEvent['excitementTier'] = 'low';
    if (weight >= 5) excitementTier = 'critical';
    else if (weight >= 2.5) excitementTier = 'high';
    else if (weight >= 1) excitementTier = 'medium';

    const categoryMap: Record<string, string> = {
      GOAL: 'Key Moment',
      OWN_GOAL: 'Key Moment',
      RED_CARD: 'Game Changer',
      YELLOW_RED: 'Game Changer',
      PENALTY: 'Penalty',
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

function buildContextBullets(
  events: NormalizedEvent[],
  score: number,
  firstHalf: NormalizedEvent[],
  secondHalf: NormalizedEvent[],
  lateEvents: NormalizedEvent[],
  extraTime: NormalizedEvent[]
): string[] {
  const bullets: string[] = [];

  const keyMoments = events.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high');
  const gameChangers = events.filter((e) => e.category === 'Game Changer');
  const penalties = events.filter((e) => e.category === 'Penalty');
  const varReviews = events.filter((e) => e.category === 'VAR Review');
  const lateKeyMoments = lateEvents.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high');

  // Key moments count
  if (keyMoments.length === 0) {
    bullets.push('Very few significant events in this match');
  } else if (keyMoments.length === 1) {
    bullets.push('Only 1 key moment in the entire match');
  } else {
    bullets.push(`${keyMoments.length} key moments across the match`);
  }

  // Action distribution
  const fhKey = firstHalf.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high').length;
  const shKey = secondHalf.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high').length;
  if (fhKey > 0 && shKey > 0) {
    if (fhKey > shKey * 2) bullets.push('Most of the action came in the first half');
    else if (shKey > fhKey * 2) bullets.push('Second half significantly more eventful than the first');
    else bullets.push('Action spread fairly across both halves');
  } else if (fhKey > 0) {
    bullets.push('All major events happened in the first half');
  } else if (shKey > 0) {
    bullets.push('First half was quiet — second half delivered the action');
  }

  // Late drama
  if (extraTime.length > 0) {
    bullets.push(`Drama continued into extra time (${extraTime.length} event${extraTime.length > 1 ? 's' : ''})`);
  } else if (lateKeyMoments.length >= 2) {
    bullets.push(`${lateKeyMoments.length} key moments in the final 15 minutes`);
  } else if (lateKeyMoments.length === 1) {
    bullets.push('A key moment in the final 15 minutes changed the game');
  }

  // Game changers (red cards)
  if (gameChangers.length >= 2) {
    bullets.push(`${gameChangers.length} game-changing events altered the balance of play`);
  } else if (gameChangers.length === 1) {
    bullets.push('A game-changing event shifted the dynamic');
  }

  // Penalties
  if (penalties.length >= 2) {
    bullets.push(`${penalties.length} penalties were awarded`);
  } else if (penalties.length === 1) {
    bullets.push('A penalty added to the tension');
  }

  // VAR
  if (varReviews.length >= 2) {
    bullets.push(`${varReviews.length} VAR reviews added controversy`);
  } else if (varReviews.length === 1) {
    bullets.push('A VAR review caused a stoppage');
  }

  return bullets.slice(0, 4); // cap at 4 bullets
}

function buildRecommendation(
  events: NormalizedEvent[],
  segments: TimelineSegment[],
  score: number
): WatchRecommendation {
  if (score >= 8.5) {
    return { type: 'full', label: 'Watch the full match', subLabel: 'Action throughout — do not miss this one' };
  }

  const firstHalfIntensity = segments.filter((s) => s.startMinute < 45).reduce((sum, s) => sum + s.intensity, 0);
  const secondHalfIntensity = segments.filter((s) => s.startMinute >= 45).reduce((sum, s) => sum + s.intensity, 0);
  const final20Events = events.filter((e) => e.minute >= 70);
  const highLateEvents = final20Events.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high');

  if (score >= 6.5 && highLateEvents.length >= 2 && firstHalfIntensity < secondHalfIntensity * 0.45) {
    return { type: 'second_half', label: 'Watch from half-time', subLabel: 'The second half is where the action is' };
  }

  if (highLateEvents.length >= 2 && score >= 5.5) {
    const startMinute = Math.max(60, (final20Events[0]?.minute ?? 70) - 5);
    return {
      type: 'final_n_minutes',
      startMinute,
      label: `Jump to minute ${startMinute}`,
      subLabel: `${highLateEvents.length} key moments in the final stretch`,
    };
  }

  if (score >= 5) {
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

function buildDescription(
  events: NormalizedEvent[],
  score: number,
  lateEvents: NormalizedEvent[],
  firstHalfEvents: NormalizedEvent[]
): string {
  const criticalCount = events.filter((e) => e.excitementTier === 'critical').length;
  const lateKey = lateEvents.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high').length;

  if (score >= 8.5) {
    if (lateKey >= 2) return 'An exceptional match — drama from start to finish with a frenetic finale';
    return 'A high-intensity match packed with action throughout';
  }
  if (score >= 7) {
    if (lateKey >= 2) return 'An exciting match that really came alive in the final stages';
    if (firstHalfEvents.filter((e) => e.excitementTier === 'critical').length >= 2)
      return 'Plenty of early action, with the match settled before the end';
    return 'A good match with several significant moments';
  }
  if (score >= 5.5) {
    if (lateKey >= 1) return 'A slow burner — quiet early on but livened up towards the end';
    return 'Some interesting passages of play but not consistently exciting';
  }
  if (score >= 3.5) {
    if (criticalCount >= 1) return 'A largely quiet match with one moment of real significance';
    return 'A forgettable match with limited action throughout';
  }
  return 'A very quiet affair — nothing much to write home about';
}

function scoreToLabel(score: number): WatchabilityResult['label'] {
  if (score >= 8.5) return 'Must Watch';
  if (score >= 6.5) return 'Worth It';
  if (score >= 4.5) return 'Selective';
  if (score >= 2.5) return 'Highlights';
  return 'Skip';
}
