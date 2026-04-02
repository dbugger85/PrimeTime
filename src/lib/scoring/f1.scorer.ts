import type { NormalizedEvent, TimelineSegment, WatchabilityResult, WatchRecommendation } from '@/types/scoring';

export interface F1RaceEvent {
  lap?: number;
  minute?: number; // fallback
  type: 'SAFETY_CAR' | 'VIRTUAL_SAFETY_CAR' | 'RED_FLAG' | 'YELLOW_FLAG' | 'OVERTAKE' | 'FASTEST_LAP' | 'DRS_DISABLED' | 'LEAD_CHANGE' | 'INCIDENT';
  detail?: string;
}

const EVENT_WEIGHTS: Record<string, number> = {
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

const TOTAL_RACE_LAPS_DEFAULT = 57;
const SEGMENT_SIZE = 5; // laps per segment

const NO_DATA_RESULT: WatchabilityResult = {
  score: 0,
  label: 'Skip',
  keyMomentCount: 0,
  hasData: false,
  recommendation: { type: 'highlights_only', label: 'No data yet', subLabel: 'Event data is not available for this race' },
  timelineSegments: [],
  spoilerFreeDescription: 'No event data available',
  contextBullets: [],
};

export function scoreF1Race(events: F1RaceEvent[], totalLaps = TOTAL_RACE_LAPS_DEFAULT): WatchabilityResult {
  if (events.length === 0) return NO_DATA_RESULT;

  const normalized = normalizeEvents(events, totalLaps);
  const segments = buildSegments(normalized, totalLaps);

  let rawPoints = normalized.reduce((sum, e) => sum + e.weight, 0);

  // Last-lap drama bonus
  const lastLapEvents = normalized.filter((e) => e.minute >= totalLaps - 3);
  rawPoints += lastLapEvents.length * 1.5;

  // Multiple safety cars = chaotic race
  const scCount = events.filter((e) => e.type === 'SAFETY_CAR').length;
  if (scCount >= 2) rawPoints += 3.0;

  const normalizationFactor = 3.5;
  const score = Math.min(10, Math.max(1, rawPoints / normalizationFactor));
  const finalScore = parseFloat(score.toFixed(1));

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
    spoilerFreeDescription: buildDescription(normalized, finalScore, events),
    contextBullets: buildF1ContextBullets(events, normalized),
    peakMinute: peakSegment?.startMinute,
  };
}

function buildF1ContextBullets(events: F1RaceEvent[], normalized: NormalizedEvent[]): string[] {
  const bullets: string[] = [];
  const scCount = events.filter((e) => e.type === 'SAFETY_CAR').length;
  const vscCount = events.filter((e) => e.type === 'VIRTUAL_SAFETY_CAR').length;
  const redFlags = events.filter((e) => e.type === 'RED_FLAG').length;
  const leadChanges = events.filter((e) => e.type === 'LEAD_CHANGE').length;
  const overtakes = events.filter((e) => e.type === 'OVERTAKE').length;
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

function normalizeEvents(events: F1RaceEvent[], totalLaps: number): NormalizedEvent[] {
  return events.map((e) => {
    const weight = EVENT_WEIGHTS[e.type] ?? 1.0;
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

function buildRecommendation(
  events: NormalizedEvent[],
  segments: TimelineSegment[],
  score: number,
  totalLaps: number
): WatchRecommendation {
  if (score >= 8.5) {
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
      subLabel: `${highFinalEvents.length} key events in the final laps`,
    };
  }

  if (score >= 5) {
    let bestStart = 0;
    let bestSum = 0;
    for (const seg of segments) {
      const windowSum = segments
        .filter((s) => s.startMinute >= seg.startMinute && s.startMinute < seg.startMinute + 15)
        .reduce((sum, s) => sum + s.intensity, 0);
      if (windowSum > bestSum) {
        bestSum = windowSum;
        bestStart = seg.startMinute;
      }
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

function buildDescription(events: NormalizedEvent[], score: number, rawEvents: F1RaceEvent[]): string {
  const scCount = rawEvents.filter((e) => e.type === 'SAFETY_CAR').length;
  const redFlags = rawEvents.filter((e) => e.type === 'RED_FLAG').length;

  if (redFlags > 0) return `Race interrupted — high drama with ${redFlags > 1 ? 'multiple stoppages' : 'a red flag'}`;
  if (scCount >= 2) return 'Multiple safety car periods kept the field bunched';
  if (score >= 8) return 'Intense race with position battles throughout';
  if (score >= 6) return 'Some exciting moments — mainly in the pit stop phase';
  return 'Largely processional — winner led from early on';
}

function scoreToLabel(score: number): WatchabilityResult['label'] {
  if (score >= 8.5) return 'Must Watch';
  if (score >= 7) return 'Worth It';
  if (score >= 5) return 'Selective';
  if (score >= 3) return 'Highlights';
  return 'Skip';
}
