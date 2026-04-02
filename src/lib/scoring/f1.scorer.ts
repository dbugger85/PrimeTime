/**
 * F1 race watchability scorer — 0 to 100 scale.
 *
 * Points per event type:
 *   Red flag:       30 pts (massive stoppage, guaranteed drama)
 *   Safety car:     20 pts (strategy shakeup, field bunches)
 *   Virtual SC:     10 pts (less impactful but still notable)
 *   Lead change:    15 pts (on-track narrative shifts)
 *   Overtake:        8 pts
 *   Incident:        6 pts
 *   Yellow flag:     3 pts
 *   Fastest lap:     2 pts
 *
 * Bonus: +15 if 2+ safety cars (chaotic race)
 * Late-lap drama bonus: +5 per high-tier event in final 15% of laps
 *
 * Calibration targets:
 *   Boring race (1 SC, no lead changes) → ~20 ("Quiet")
 *   Standard race (1 SC, 2 lead changes) → ~50 ("Solid")
 *   Exciting race (2 SC, 3 lead changes, overtakes) → ~80 ("Watchable")
 *   Epic race (3 red flags, multiple SCs) → capped at 100 ("Thriller")
 */
import type { NormalizedEvent, TimelineSegment, WatchabilityResult, WatchRecommendation, WatchabilityLabel } from '@/types/scoring';

export interface F1RaceEvent {
  lap?: number;
  minute?: number; // fallback
  type: 'SAFETY_CAR' | 'VIRTUAL_SAFETY_CAR' | 'RED_FLAG' | 'YELLOW_FLAG' | 'OVERTAKE' | 'FASTEST_LAP' | 'DRS_DISABLED' | 'LEAD_CHANGE' | 'INCIDENT';
  detail?: string;
}

const TOTAL_RACE_LAPS_DEFAULT = 57;
const SEGMENT_SIZE = 5; // laps per segment

const NO_DATA_RESULT: WatchabilityResult = {
  score: 0,
  label: 'Quiet',
  keyMomentCount: 0,
  hasData: false,
  recommendation: {
    type: 'highlights_only',
    label: 'No data yet',
    subLabel: 'Event data is not available for this race',
  },
  timelineSegments: [],
  spoilerFreeDescription: 'No event data available',
  contextBullets: [],
  highlightPeriods: [],
};

// Points per event type
const EVENT_PTS: Record<string, number> = {
  RED_FLAG: 30,
  SAFETY_CAR: 20,
  VIRTUAL_SAFETY_CAR: 10,
  LEAD_CHANGE: 15,
  OVERTAKE: 8,
  INCIDENT: 6,
  DRS_DISABLED: 4,
  YELLOW_FLAG: 3,
  FASTEST_LAP: 2,
};

export function scoreF1Race(events: F1RaceEvent[], totalLaps = TOTAL_RACE_LAPS_DEFAULT): WatchabilityResult {
  if (events.length === 0) return NO_DATA_RESULT;

  const scCount = events.filter((e) => e.type === 'SAFETY_CAR').length;
  const vscCount = events.filter((e) => e.type === 'VIRTUAL_SAFETY_CAR').length;
  const redFlagCount = events.filter((e) => e.type === 'RED_FLAG').length;
  const leadChanges = events.filter((e) => e.type === 'LEAD_CHANGE').length;
  const overtakes = events.filter((e) => e.type === 'OVERTAKE').length;
  const incidents = events.filter((e) => e.type === 'INCIDENT').length;

  let score = 0;
  score += Math.min(redFlagCount * EVENT_PTS.RED_FLAG, 60);
  score += Math.min(scCount * EVENT_PTS.SAFETY_CAR, 60);
  score += Math.min(vscCount * EVENT_PTS.VIRTUAL_SAFETY_CAR, 20);
  score += Math.min(leadChanges * EVENT_PTS.LEAD_CHANGE, 45);
  score += Math.min(overtakes * EVENT_PTS.OVERTAKE, 24);
  score += Math.min(incidents * EVENT_PTS.INCIDENT, 18);

  // Multiple SC bonus — chaotic race
  if (scCount >= 2) score += 15;

  // Late-lap drama bonus (final 15% of race)
  const lateLapThreshold = Math.floor(totalLaps * 0.85);
  const lateHighEvents = events.filter(
    (e) => (e.lap ?? e.minute ?? 0) >= lateLapThreshold &&
    ['RED_FLAG', 'SAFETY_CAR', 'LEAD_CHANGE'].includes(e.type)
  );
  score += Math.min(lateHighEvents.length * 5, 15);

  const finalScore = Math.round(Math.min(100, Math.max(0, score)));

  const normalized = normalizeEvents(events, totalLaps);
  const segments = buildSegments(normalized, totalLaps);
  const recommendation = buildRecommendation(normalized, segments, finalScore, totalLaps);
  const label = scoreToLabel(finalScore);
  const peakSegment = segments.reduce((a, b) => (a.intensity > b.intensity ? a : b), segments[0]);

  return {
    score: finalScore,
    label,
    hasData: true,
    keyMomentCount: normalized.filter(
      (e) => e.excitementTier === 'critical' || e.excitementTier === 'high'
    ).length,
    recommendation,
    timelineSegments: segments,
    spoilerFreeDescription: buildDescription(finalScore, scCount, redFlagCount),
    contextBullets: buildF1ContextBullets(events, normalized, scCount, vscCount, redFlagCount, leadChanges, overtakes),
    highlightPeriods: [],
    peakMinute: peakSegment?.startMinute,
  };
}

// ─── Context bullets ───────────────────────────────────────────────────────

function buildF1ContextBullets(
  events: F1RaceEvent[],
  normalized: NormalizedEvent[],
  scCount: number,
  vscCount: number,
  redFlags: number,
  leadChanges: number,
  overtakes: number
): string[] {
  const bullets: string[] = [];
  const lateEvents = normalized.filter((e) => e.isLateGame && (e.excitementTier === 'critical' || e.excitementTier === 'high'));

  if (redFlags > 0) bullets.push(`Race stopped ${redFlags > 1 ? `${redFlags} times` : 'once'} under red flag`);
  if (scCount >= 2) bullets.push(`${scCount} safety car periods kept the field bunched`);
  else if (scCount === 1) bullets.push('One safety car period shook up the strategy');
  if (vscCount > 0) bullets.push(`${vscCount} virtual safety car period${vscCount > 1 ? 's' : ''}`);
  if (leadChanges >= 3) bullets.push(`${leadChanges} lead changes — positions were never settled`);
  else if (leadChanges > 0) bullets.push(`${leadChanges} lead change${leadChanges > 1 ? 's' : ''} during the race`);
  if (overtakes >= 3) bullets.push(`${overtakes} on-track overtakes`);
  if (lateEvents.length >= 2) bullets.push('Dramatic final laps with significant incidents');

  return bullets.slice(0, 4);
}

// ─── Normalize + segments ──────────────────────────────────────────────────

// Timeline weights (separate from scoring pts — used for visual intensity only)
const TIMELINE_WEIGHTS: Record<string, number> = {
  RED_FLAG: 7.0,
  SAFETY_CAR: 4.5,
  VIRTUAL_SAFETY_CAR: 2.5,
  LEAD_CHANGE: 3.5,
  OVERTAKE: 2.5,
  YELLOW_FLAG: 1.0,
  INCIDENT: 2.0,
  DRS_DISABLED: 1.5,
  FASTEST_LAP: 1.5,
};

function normalizeEvents(events: F1RaceEvent[], totalLaps: number): NormalizedEvent[] {
  return events.map((e) => {
    const weight = TIMELINE_WEIGHTS[e.type] ?? 1.0;
    const lap = e.lap ?? e.minute ?? 0;
    const isLateGame = lap >= totalLaps * 0.75;

    let excitementTier: NormalizedEvent['excitementTier'] = 'low';
    if (weight >= 5) excitementTier = 'critical';
    else if (weight >= 3) excitementTier = 'high';
    else if (weight >= 1.5) excitementTier = 'medium';

    const categoryMap: Record<string, string> = {
      RED_FLAG: 'Red Flag',
      SAFETY_CAR: 'Safety Car',
      VIRTUAL_SAFETY_CAR: 'Virtual SC',
      LEAD_CHANGE: 'Lead Change',
      OVERTAKE: 'Overtake',
      YELLOW_FLAG: 'Yellow Flag',
      INCIDENT: 'Incident',
      DRS_DISABLED: 'DRS Disabled',
      FASTEST_LAP: 'Fastest Lap',
    };

    return {
      minute: lap,
      weight,
      excitementTier,
      category: categoryMap[e.type] ?? 'Event',
      isLateGame,
    };
  });
}

function buildSegments(events: NormalizedEvent[], totalLaps: number): TimelineSegment[] {
  const segments: TimelineSegment[] = [];
  for (let start = 0; start < totalLaps; start += SEGMENT_SIZE) {
    const end = Math.min(start + SEGMENT_SIZE, totalLaps);
    const segEvents = events.filter((e) => e.minute >= start && e.minute < end);
    const intensity = segEvents.reduce((sum, e) => sum + e.weight, 0);
    segments.push({ startMinute: start, endMinute: end, eventCount: segEvents.length, intensity });
  }
  const maxIntensity = Math.max(...segments.map((s) => s.intensity), 1);
  return segments.map((s) => ({ ...s, intensity: s.intensity / maxIntensity }));
}

// ─── Description ──────────────────────────────────────────────────────────

function buildDescription(score: number, scCount: number, redFlags: number): string {
  if (redFlags > 0) return `Race interrupted by ${redFlags > 1 ? 'multiple stoppages' : 'a red flag'} — high drama`;
  if (scCount >= 2) return 'Multiple safety car periods kept the field bunched and strategies open';
  if (score >= 90) return 'Intense race with position battles from lights out to the chequered flag';
  if (score >= 70) return 'Eventful race — safety cars and strategy calls kept it interesting';
  if (score >= 40) return 'Some exciting moments but mainly settled after the first stint';
  return 'Largely processional — winner led from early on';
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
  score: number,
  totalLaps: number
): WatchRecommendation {
  if (score >= 90) {
    return { type: 'full', label: 'Watch the full race', subLabel: 'Drama from lights out to chequered flag' };
  }

  const finalThird = events.filter((e) => e.minute >= totalLaps * 0.66);
  const highFinalEvents = finalThird.filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high');

  if (highFinalEvents.length >= 2) {
    const startLap = Math.max(1, (finalThird[0]?.minute ?? Math.floor(totalLaps * 0.66)) - 3);
    return {
      type: 'final_n_minutes',
      startMinute: startLap,
      label: `Jump to lap ${startLap}`,
      subLabel: `Key events in the final laps`,
    };
  }

  if (score >= 40) {
    let bestStart = 0;
    let bestSum = 0;
    for (const seg of segments) {
      const windowSum = segments
        .filter((s) => s.startMinute >= seg.startMinute && s.startMinute < seg.startMinute + 15)
        .reduce((sum, s) => sum + s.intensity, 0);
      if (windowSum > bestSum) { bestSum = windowSum; bestStart = seg.startMinute; }
    }
    return {
      type: 'from_minute',
      startMinute: Math.max(1, bestStart - 2),
      label: `Start at lap ${Math.max(1, bestStart - 2)}`,
      subLabel: 'Peak action period from here',
    };
  }

  return { type: 'highlights_only', label: 'Highlights only', subLabel: 'A processional race — 10-min recap is enough' };
}
