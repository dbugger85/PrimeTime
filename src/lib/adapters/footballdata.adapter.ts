import type { Match, MatchEvent } from '@/types/match';
import { getServicesForCompetition } from '@/lib/streaming/rights';

// football-data.org API types
interface FDMatch {
  id: number;
  utcDate: string;
  status: string;
  matchday: number;
  stage: string;
  group?: string;
  homeTeam: { shortName: string; name: string };
  awayTeam: { shortName: string; name: string };
  competition: { id: string; code: string; name: string };
}

interface FDEvent {
  minute: number;
  type: string;
  team?: { name: string };
  detail?: string;
  player?: { name: string };
}

export function adaptFDMatch(raw: FDMatch): Match {
  const competitionId = raw.competition.code || String(raw.competition.id);
  return {
    id: String(raw.id),
    sport: 'football',
    homeTeam: raw.homeTeam.shortName || raw.homeTeam.name,
    awayTeam: raw.awayTeam.shortName || raw.awayTeam.name,
    competition: raw.competition.name,
    competitionId,
    matchday: formatMatchday(raw.stage, raw.group, raw.matchday),
    utcDate: raw.utcDate,
    status: mapStatus(raw.status),
    duration: 90,
    streamingServices: getServicesForCompetition(competitionId),
  };
}

export function adaptFDEvents(rawEvents: FDEvent[]): MatchEvent[] {
  return rawEvents.map((e) => ({
    minute: e.minute,
    type: e.type,
    team: e.team?.name,
    detail: e.detail,
  }));
}

function formatMatchday(stage: string, group: string | undefined, matchday: number): string | undefined {
  const STAGE_LABELS: Record<string, string> = {
    GROUP_STAGE:       group ? `Group ${group.replace('GROUP_', '')}` : 'Group Stage',
    ROUND_OF_16:       'Round of 16',
    QUARTER_FINALS:    'Quarter-final',
    SEMI_FINALS:       'Semi-final',
    FINAL:             'Final',
    THIRD_PLACE:       'Third place',
    PLAY_OFF_ROUND_1:  'Play-off',
    PLAY_OFF_ROUND_2:  'Play-off',
    PLAYOFFS:          'Play-off',
    REGULAR_SEASON:    matchday ? `Matchday ${matchday}` : 'Regular Season',
    // Fallback for league stages
  };
  const label = STAGE_LABELS[stage];
  if (label) return label;
  if (matchday) return `Matchday ${matchday}`;
  return undefined;
}

function mapStatus(status: string): Match['status'] {
  const map: Record<string, Match['status']> = {
    SCHEDULED: 'SCHEDULED',
    TIMED: 'SCHEDULED',
    IN_PLAY: 'IN_PLAY',
    PAUSED: 'PAUSED',
    FINISHED: 'FINISHED',
    POSTPONED: 'POSTPONED',
    SUSPENDED: 'POSTPONED',
    CANCELLED: 'POSTPONED',
  };
  return map[status] ?? 'SCHEDULED';
}
