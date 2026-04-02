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

export type WatchabilityLabel =
  | 'Must Watch'
  | 'Worth It'
  | 'Selective'
  | 'Highlights'
  | 'Skip';

export interface WatchabilityResult {
  score: number; // 1.0–10.0
  label: WatchabilityLabel;
  keyMomentCount: number;
  recommendation: WatchRecommendation;
  timelineSegments: TimelineSegment[];
  spoilerFreeDescription: string;
  /** Short spoiler-free bullet points explaining the score */
  contextBullets: string[];
  peakMinute?: number;
  /** False when no event data was available — do not show score as fact */
  hasData: boolean;
}
