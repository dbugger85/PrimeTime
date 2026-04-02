import type { Match } from '@/types/match';
import type { MatchEvent } from '@/types/match';
import type { F1RaceEvent } from '@/lib/scoring/f1.scorer';

const today = new Date();
const yesterday = new Date(today);
yesterday.setDate(yesterday.getDate() - 1);
const twoDaysAgo = new Date(today);
twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
const tomorrow = new Date(today);
tomorrow.setDate(tomorrow.getDate() + 1);

export const MOCK_FOOTBALL_MATCHES: Match[] = [
  {
    id: 'mock-1',
    sport: 'football',
    homeTeam: 'Arsenal',
    awayTeam: 'Man City',
    competition: 'Premier League',
    competitionId: 'PL',
    matchday: 'Matchday 32',
    utcDate: yesterday.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['viaplay'],
  },
  {
    id: 'mock-2',
    sport: 'football',
    homeTeam: 'Real Madrid',
    awayTeam: 'Barcelona',
    competition: 'La Liga',
    competitionId: 'PD',
    matchday: 'Matchday 30',
    utcDate: twoDaysAgo.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['viaplay'],
  },
  {
    id: 'mock-3',
    sport: 'football',
    homeTeam: 'Bayern Munich',
    awayTeam: 'Dortmund',
    competition: 'Bundesliga',
    competitionId: 'BL1',
    matchday: 'Matchday 28',
    utcDate: yesterday.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['viaplay'],
  },
  {
    id: 'mock-4',
    sport: 'football',
    homeTeam: 'Liverpool',
    awayTeam: 'Chelsea',
    competition: 'Premier League',
    competitionId: 'PL',
    matchday: 'Matchday 32',
    utcDate: tomorrow.toISOString(),
    status: 'SCHEDULED',
    duration: 90,
    streamingServices: ['viaplay'],
  },
  {
    id: 'mock-5',
    sport: 'football',
    homeTeam: 'Inter Milan',
    awayTeam: 'AC Milan',
    competition: 'Champions League',
    competitionId: 'CL',
    matchday: 'Quarter-final',
    utcDate: yesterday.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['tv2play'],
  },
  {
    id: 'mock-6',
    sport: 'football',
    homeTeam: 'Rosenborg',
    awayTeam: 'Molde',
    competition: 'Eliteserien',
    competitionId: 'PPL',
    matchday: 'Matchday 5',
    utcDate: yesterday.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['tv2play'],
  },
  {
    id: 'mock-7',
    sport: 'football',
    homeTeam: 'Norway',
    awayTeam: 'Sweden',
    competition: 'European Championship',
    competitionId: 'EC',
    matchday: 'Group A',
    utcDate: twoDaysAgo.toISOString(),
    status: 'FINISHED',
    duration: 90,
    streamingServices: ['nrk', 'tv2play'],
  },
  {
    id: 'mock-8',
    sport: 'football',
    homeTeam: 'Norway',
    awayTeam: 'Brazil',
    competition: 'World Cup',
    competitionId: 'WC',
    matchday: 'Group Stage',
    utcDate: tomorrow.toISOString(),
    status: 'SCHEDULED',
    duration: 90,
    streamingServices: ['nrk', 'tv2play'],
  },
];

export const MOCK_FOOTBALL_EVENTS: Record<string, MatchEvent[]> = {
  'mock-7': [
    // Norway vs Sweden — tense
    { minute: 18, type: 'GOAL' },
    { minute: 44, type: 'YELLOW_CARD' },
    { minute: 67, type: 'GOAL' },
    { minute: 82, type: 'PENALTY' },
    { minute: 90, type: 'GOAL' },
  ],
  'mock-1': [
    // Arsenal vs Man City — a cracker
    { minute: 12, type: 'GOAL' },
    { minute: 23, type: 'YELLOW_CARD' },
    { minute: 34, type: 'GOAL' },
    { minute: 41, type: 'GOAL' },
    { minute: 54, type: 'VAR' },
    { minute: 61, type: 'RED_CARD' },
    { minute: 67, type: 'GOAL' },
    { minute: 72, type: 'PENALTY' },
    { minute: 78, type: 'GOAL' },
    { minute: 87, type: 'GOAL' },
    { minute: 90, type: 'GOAL' },
    { minute: 93, type: 'GOAL' },
  ],
  'mock-2': [
    // El Clasico — dramatic
    { minute: 8, type: 'GOAL' },
    { minute: 22, type: 'YELLOW_CARD' },
    { minute: 39, type: 'GOAL' },
    { minute: 45, type: 'PENALTY' },
    { minute: 63, type: 'GOAL' },
    { minute: 75, type: 'RED_CARD' },
    { minute: 88, type: 'GOAL' },
    { minute: 90, type: 'VAR' },
  ],
  'mock-3': [
    // Der Klassiker — one-sided
    { minute: 5, type: 'GOAL' },
    { minute: 20, type: 'GOAL' },
    { minute: 33, type: 'GOAL' },
    { minute: 51, type: 'SUBSTITUTION' },
    { minute: 66, type: 'GOAL' },
    { minute: 80, type: 'YELLOW_CARD' },
  ],
  'mock-5': [
    // Inter vs Milan UCL — tense
    { minute: 28, type: 'GOAL' },
    { minute: 44, type: 'VAR' },
    { minute: 59, type: 'RED_CARD' },
    { minute: 71, type: 'PENALTY' },
    { minute: 83, type: 'GOAL' },
    { minute: 89, type: 'GOAL' },
    { minute: 94, type: 'GOAL' },
  ],
  'mock-6': [
    // Rosenborg vs Molde — quiet
    { minute: 36, type: 'GOAL' },
    { minute: 72, type: 'YELLOW_CARD' },
    { minute: 85, type: 'SUBSTITUTION' },
  ],
};

export const MOCK_F1_SESSIONS: Match[] = [
  {
    id: 'f1-mock-1',
    sport: 'f1',
    homeTeam: 'Bahrain Grand Prix',
    awayTeam: 'Bahrain International Circuit',
    competition: 'Formula 1',
    competitionId: 'f1-season',
    matchday: 'Race',
    utcDate: twoDaysAgo.toISOString(),
    status: 'FINISHED',
    duration: 57,
    streamingServices: ['viaplay', 'nrk'],
  },
  {
    id: 'f1-mock-2',
    sport: 'f1',
    homeTeam: 'Saudi Arabian Grand Prix',
    awayTeam: 'Jeddah Corniche Circuit',
    competition: 'Formula 1',
    competitionId: 'f1-season',
    matchday: 'Race',
    utcDate: yesterday.toISOString(),
    status: 'FINISHED',
    duration: 50,
    streamingServices: ['viaplay', 'nrk'],
  },
];

export const MOCK_F1_EVENTS: Record<string, F1RaceEvent[]> = {
  'f1-mock-1': [
    // Bahrain — chaotic
    { lap: 3, type: 'SAFETY_CAR' },
    { lap: 12, type: 'LEAD_CHANGE' },
    { lap: 18, type: 'YELLOW_FLAG' },
    { lap: 23, type: 'SAFETY_CAR' },
    { lap: 31, type: 'RED_FLAG' },
    { lap: 35, type: 'LEAD_CHANGE' },
    { lap: 44, type: 'OVERTAKE' },
    { lap: 48, type: 'OVERTAKE' },
    { lap: 52, type: 'LEAD_CHANGE' },
    { lap: 55, type: 'FASTEST_LAP' },
    { lap: 57, type: 'OVERTAKE' },
  ],
  'f1-mock-2': [
    // Saudi — processional
    { lap: 5, type: 'YELLOW_FLAG' },
    { lap: 19, type: 'VIRTUAL_SAFETY_CAR' },
    { lap: 38, type: 'FASTEST_LAP' },
    { lap: 45, type: 'DRS_DISABLED' },
  ],
};
