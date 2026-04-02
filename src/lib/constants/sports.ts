import type { Sport } from '@/types/match';

export const SPORTS: { id: Sport; label: string; icon: string }[] = [
  { id: 'football', label: 'Football', icon: '⚽' },
  { id: 'f1', label: 'Formula 1', icon: '🏎️' },
  { id: 'basketball', label: 'Basketball', icon: '🏀' },
  { id: 'tennis', label: 'Tennis', icon: '🎾' },
];
