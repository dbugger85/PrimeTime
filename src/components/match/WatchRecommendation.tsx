import { Play, FastForward, Scissors, Zap } from 'lucide-react';
import type { WatchRecommendation as WatchRec } from '@/types/scoring';
import { cn } from '@/lib/utils';

interface WatchRecommendationProps {
  recommendation: WatchRec;
  compact?: boolean;
}

const TYPE_ICONS = {
  full: Play,
  from_minute: FastForward,
  second_half: FastForward,
  final_n_minutes: FastForward,
  highlights_only: Scissors,
};

const TYPE_COLORS = {
  full: 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-900/20 dark:border-emerald-700 dark:text-emerald-300',
  from_minute: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300',
  second_half: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/20 dark:border-blue-700 dark:text-blue-300',
  final_n_minutes: 'bg-violet-50 border-violet-200 text-violet-800 dark:bg-violet-900/20 dark:border-violet-700 dark:text-violet-300',
  highlights_only: 'bg-zinc-50 border-zinc-200 text-zinc-600 dark:bg-zinc-800/50 dark:border-zinc-700 dark:text-zinc-400',
};

export function WatchRecommendation({ recommendation, compact = false }: WatchRecommendationProps) {
  const Icon = TYPE_ICONS[recommendation.type] ?? Zap;
  const colorClass = TYPE_COLORS[recommendation.type];

  if (compact) {
    return (
      <div className={cn('inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium', colorClass)}>
        <Icon className="h-3 w-3" />
        <span>{recommendation.label}</span>
      </div>
    );
  }

  return (
    <div className={cn('rounded-xl border p-4', colorClass)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-4 w-4 shrink-0" />
        <span className="font-semibold text-sm">{recommendation.label}</span>
      </div>
      <p className="text-xs opacity-80 ml-6">{recommendation.subLabel}</p>
    </div>
  );
}
