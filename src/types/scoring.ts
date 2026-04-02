export type ExcitementTier = 'critical' | 'high' | 'medium' | 'low';

export interface NormalizedEvent {
  minute: number;
  excitementTier: ExcitementTier;
  /** Spoiler-free category label, e.g. "Key Moment", "Game Changer" */
  category: string;
  /** Numeric weight for scoring */
  weight: number;
  isLateGame: boolean;
}

export interface TimelineSegment {
  startMinute: number;
  endMinute: number;
  eventCount: number;
  /** 0–1 normalized intensity */
  intensity: number;
}

export type WatchRecommendationType =
  | 'full'
  | 'from_minute'
  | 'second_half'
  | 'final_n_minutes'
  | 'highlights_only';

export interface WatchRecommendation {
  type: WatchRecommendationType;
  startMinute?: number;
  label: string;
  subLabel: string;
}

/**
 * Four verbal tiers mapped from the 0–100 score:
 *   90–100 → Thriller
 *   70–89  → Watchable
 *   40–69  → Solid
 *    0–39  → Quiet
 */
export type WatchabilityLabel = 'Thriller' | 'Watchable' | 'Solid' | 'Quiet';

export interface WatchabilityResult {
  /** 0–100 integer watchability score */
  score: number;
  label: WatchabilityLabel;
  keyMomentCount: number;
  recommendation: WatchRecommendation;
  timelineSegments: TimelineSegment[];
  spoilerFreeDescription: string;
  /** Short spoiler-free bullet points explaining the score */
  contextBullets: string[];
  /**
   * Fast-forward guide: merged time windows (e.g. ["12:15 to 13:30"])
   * around every Goal, Penalty, Red Card and Big Chance.
   * Empty when exact event times are not available.
   */
  highlightPeriods: string[];
  peakMinute?: number;
  /** False when no event data was available — do not show score as fact */
  hasData: boolean;
}
