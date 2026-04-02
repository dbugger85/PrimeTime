import type { RightsEntry } from '@/types/streaming';
import type { Sport } from '@/types/match';

/**
 * Norwegian streaming rights as of 2025–2026 season.
 * Competition IDs match football-data.org / OpenF1 identifiers.
 * Update this file when rights deals change.
 */
export const STREAMING_RIGHTS: RightsEntry[] = [
  // --- Football ---
  { competitionId: 'PL',  competitionName: 'Premier League',   sport: 'football', services: ['viaplay'] },
  { competitionId: 'PD',  competitionName: 'La Liga',           sport: 'football', services: ['viaplay'] },
  { competitionId: 'BL1', competitionName: 'Bundesliga',        sport: 'football', services: ['viaplay'] },
  { competitionId: 'SA',  competitionName: 'Serie A',           sport: 'football', services: ['viaplay'] },
  { competitionId: 'FL1', competitionName: 'Ligue 1',           sport: 'football', services: ['viaplay'] },
  { competitionId: 'CL',  competitionName: 'Champions League',  sport: 'football', services: ['tv2play'] },
  { competitionId: 'EL',  competitionName: 'Europa League',     sport: 'football', services: ['viaplay'] },
  { competitionId: 'ECL', competitionName: 'Conference League', sport: 'football', services: ['viaplay'] },
  { competitionId: 'ELC', competitionName: 'Championship',      sport: 'football', services: ['viaplay'] },
  { competitionId: 'PPL', competitionName: 'Eliteserien',       sport: 'football', services: ['tv2play'] },
  { competitionId: 'FAC', competitionName: 'FA Cup',            sport: 'football', services: ['viaplay', 'tv2play'] },
  // --- International ---
  { competitionId: 'EC',  competitionName: 'European Championship', sport: 'football', services: ['nrk', 'tv2play'] },
  { competitionId: 'WC',  competitionName: 'World Cup',             sport: 'football', services: ['nrk', 'tv2play'] },
  { competitionId: 'UCL', competitionName: 'UEFA Nations League',   sport: 'football', services: ['nrk', 'tv2play'] },
  // --- Formula 1 ---
  { competitionId: 'f1-season',  competitionName: 'Formula 1',  sport: 'f1',         services: ['viaplay', 'nrk'] },
  // --- Basketball ---
  { competitionId: 'nba',        competitionName: 'NBA',         sport: 'basketball', services: ['tv2play', 'max'] },
  // --- Tennis ---
  { competitionId: 'atp',        competitionName: 'ATP Tour',    sport: 'tennis',     services: ['discovery'] },
  { competitionId: 'wta',        competitionName: 'WTA Tour',    sport: 'tennis',     services: ['discovery'] },
  { competitionId: 'grand-slam', competitionName: 'Grand Slams', sport: 'tennis',     services: ['discovery', 'nrk'] },
];

export const RIGHTS_BY_COMPETITION_ID = Object.fromEntries(
  STREAMING_RIGHTS.map((r) => [r.competitionId, r])
);

export function getServicesForCompetition(competitionId: string) {
  return RIGHTS_BY_COMPETITION_ID[competitionId]?.services ?? [];
}

export function getCompetitionsForSport(sport: Sport): RightsEntry[] {
  return STREAMING_RIGHTS.filter((r) => r.sport === sport);
}
