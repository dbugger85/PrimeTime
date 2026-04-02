'use client';

import { useQuery } from '@tanstack/react-query';
import { startOfDay, startOfWeek, startOfMonth, subDays, endOfDay, parseISO } from 'date-fns';
import type { Match, Sport, StreamingServiceId } from '@/types/match';
import type { DateRange } from '@/stores/userPreferences.store';

interface MatchesResponse {
  matches: Match[];
}

async function fetchMatches(sport: Sport): Promise<Match[]> {
  const res = await fetch(`/api/matches?sport=${sport}`);
  if (!res.ok) throw new Error('Failed to fetch matches');
  const data: MatchesResponse = await res.json();
  return data.matches;
}

function getDateBounds(
  range: DateRange,
  customFrom: string | null,
  customTo: string | null
): { from: Date | null; to: Date | null } {
  const now = new Date();
  switch (range) {
    case 'today':
      return { from: startOfDay(now), to: null };
    case 'yesterday':
      return { from: startOfDay(subDays(now, 1)), to: endOfDay(subDays(now, 1)) };
    case 'week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: null };
    case 'month':
      return { from: startOfMonth(now), to: null };
    case 'all':
      return { from: null, to: null };
    case 'custom':
      return {
        from: customFrom ? startOfDay(parseISO(customFrom)) : null,
        to: customTo ? endOfDay(parseISO(customTo)) : null,
      };
  }
}

export function useMatches(
  sport: Sport,
  subscribedServices: StreamingServiceId[],
  subscribedCompetitions: string[],
  dateRange: DateRange,
  customDateFrom: string | null,
  customDateTo: string | null
) {
  const query = useQuery({
    queryKey: ['matches', sport],
    queryFn: () => fetchMatches(sport),
    staleTime: 5 * 60 * 1000,
  });

  const { from, to } = getDateBounds(dateRange, customDateFrom, customDateTo);

  const filtered = (query.data ?? []).filter((match) => {
    const serviceOk =
      subscribedServices.length === 0 ||
      match.streamingServices.some((s) => subscribedServices.includes(s));

    const competitionOk =
      subscribedCompetitions.length === 0 ||
      subscribedCompetitions.includes(match.competitionId);

    const matchDate = new Date(match.utcDate);
    const fromOk = from === null || matchDate >= from;
    const toOk = to === null || matchDate <= to;

    return serviceOk && competitionOk && fromOk && toOk;
  });

  return { ...query, data: filtered };
}
