'use client';

import { SPORTS } from '@/lib/constants/sports';
import type { Sport } from '@/types/match';
import { cn } from '@/lib/utils';

interface SportSelectorProps {
  selected: Sport;
  onChange: (sport: Sport) => void;
}

export function SportSelector({ selected, onChange }: SportSelectorProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
      {SPORTS.map((sport) => (
        <button
          key={sport.id}
          onClick={() => onChange(sport.id)}
          className={cn(
            'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors shrink-0',
            selected === sport.id
              ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
          )}
        >
          <span>{sport.icon}</span>
          <span>{sport.label}</span>
        </button>
      ))}
    </div>
  );
}
