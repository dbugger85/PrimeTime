'use client';

import { getCompetitionsForSport } from '@/lib/streaming/rights';
import type { Sport } from '@/types/match';
import { cn } from '@/lib/utils';

interface CompetitionFilterProps {
  sport: Sport;
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}

export function CompetitionFilter({ sport, selected, onToggle, onSelectAll }: CompetitionFilterProps) {
  const competitions = getCompetitionsForSport(sport);
  const allSelected = selected.length === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide">
          Competitions
        </p>
        {!allSelected && (
          <button
            onClick={onSelectAll}
            className="text-xs text-blue-500 hover:text-blue-600 dark:text-blue-400"
          >
            Show all
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {competitions.map((comp) => {
          const active = allSelected || selected.includes(comp.competitionId);

          return (
            <button
              key={comp.competitionId}
              onClick={() => onToggle(comp.competitionId)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                active
                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-white dark:border-white dark:text-zinc-900'
                  : 'border-zinc-200 text-zinc-400 dark:border-zinc-700 dark:text-zinc-500 hover:border-zinc-300'
              )}
            >
              {comp.competitionName}
            </button>
          );
        })}
      </div>
      {allSelected && (
        <p className="text-xs text-zinc-400 mt-2">
          Tap to show only selected competitions
        </p>
      )}
    </div>
  );
}
