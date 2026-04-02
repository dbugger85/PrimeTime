'use client';

import { useQuery } from '@tanstack/react-query';
import type { WatchabilityResult } from '@/types/scoring';

async function fetchMatchScore(sport: string, id: string): Promise<WatchabilityResult> {
  const res = await fetch(`/api/score/${sport}/${id}`);
  if (!res.ok) throw new Error('Failed to fetch match score');
  return res.json();
}

export function useMatchScore(sport: string, id: string, enabled = true) {
  return useQuery({
    queryKey: ['matchScore', sport, id],
    queryFn: () => fetchMatchScore(sport, id),
    // 1 hour for finished matches — long enough to avoid re-fetching on every mount
    // but not Infinity so manual refresh via invalidateQueries actually works
    staleTime: 60 * 60 * 1000,
    retry: 1,
    enabled,
  });
}
