export type Sport = 'football' | 'f1' | 'basketball' | 'tennis';

export type StreamingServiceId =
  | 'viaplay'
  | 'tv2play'
  | 'max'
  | 'discovery'
  | 'nrk'
  | 'amazon';

export interface StreamingService {
  id: StreamingServiceId;
  label: string;
  color: string;
  logo?: string;
}

export interface Match {
  id: string;
  sport: Sport;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  competitionId: string;
  matchday?: string;
  utcDate: string; // ISO string
  status: 'SCHEDULED' | 'IN_PLAY' | 'PAUSED' | 'FINISHED' | 'POSTPONED';
  duration?: number; // total minutes (90 for football, varies for F1)
  streamingServices: StreamingServiceId[];
  /** Final score — only present for FINISHED matches */
  result?: { home: number | null; away: number | null };
}

export interface MatchEvent {
  minute: number;
  type: string; // raw type from API
  team?: string;
  detail?: string;
}
