'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useMatches } from '@/hooks/useMatches';
import { useUserPreferences } from '@/stores/userPreferences.store';
import { MatchCard } from '@/components/match/MatchCard';
import { MatchCardSkeleton } from '@/components/match/MatchCardSkeleton';
import { SportSelector } from '@/components/filters/SportSelector';
import { DateRangeSelector } from '@/components/filters/DateRangeSelector';
import { cn } from '@/lib/utils';

export function MatchList() {
  const {
    selectedSport, setSelectedSport,
    subscribedServices,
    subscribedCompetitions,
    dateRange, setDateRange,
    customDateFrom, customDateTo, setCustomDateRange,
    spoilerMode,
  } = useUserPreferences();

  const { data: matches, isLoading, isError } = useMatches(
    selectedSport,
    subscribedServices,
    subscribedCompetitions,
    dateRange,
    customDateFrom,
    customDateTo
  );

  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    setIsRefreshing(true);
    await queryClient.invalidateQueries({ refetchType: 'all' });
    setIsRefreshing(false);
  }

  const isFiltered = subscribedServices.length > 0 || subscribedCompetitions.length > 0;

  return (
    <div className="space-y-4">
      {/* Sport filter */}
      <SportSelector selected={selectedSport} onChange={setSelectedSport} />

      {/* Date range filter */}
      <DateRangeSelector
        selected={dateRange}
        customDateFrom={customDateFrom}
        customDateTo={customDateTo}
        onChange={setDateRange}
        onCustomChange={setCustomDateRange}
      />

      {/* Summary + refresh */}
      {!isLoading && !isError && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {matches.length > 0
              ? `${matches.length} match${matches.length !== 1 ? 'es' : ''} available`
              : 'No matches found'}
            {isFiltered && <span className="ml-1 text-xs">· filtered</span>}
          </p>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', isRefreshing && 'animate-spin')} />
            Refresh
          </button>
        </div>
      )}

      {/* Match cards */}
      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <MatchCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-800 p-6 text-center">
          <p className="text-sm text-red-600 dark:text-red-400 mb-2">
            Failed to load matches.
          </p>
          <button
            onClick={handleRefresh}
            className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto"
          >
            <RefreshCw className="h-3 w-3" /> Try again
          </button>
        </div>
      ) : matches.length === 0 ? (
        <div className="rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-10 text-center">
          <p className="text-3xl mb-3">📺</p>
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">No matches to show</p>
          <p className="text-xs text-zinc-400 mt-1">
            {isFiltered
              ? 'No matches match your filters — adjust in settings'
              : 'Try a wider date range or check back later'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {matches.map((match) => (
            <MatchCard
              key={match.id}
              match={match}
              subscribedServices={subscribedServices}
              spoilerMode={spoilerMode}
            />
          ))}
        </div>
      )}
    </div>
  );
}
