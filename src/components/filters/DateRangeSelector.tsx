'use client';

import type { DateRange } from '@/stores/userPreferences.store';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface DateRangeSelectorProps {
  selected: DateRange;
  customDateFrom: string | null;
  customDateTo: string | null;
  onChange: (range: DateRange) => void;
  onCustomChange: (from: string | null, to: string | null) => void;
}

const OPTIONS: { id: DateRange; label: string }[] = [
  { id: 'today',     label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: 'week',      label: 'This week' },
  { id: 'month',     label: 'This month' },
  { id: 'all',       label: 'All time' },
  { id: 'custom',    label: 'Custom' },
];

const todayStr = format(new Date(), 'yyyy-MM-dd');

export function DateRangeSelector({
  selected,
  customDateFrom,
  customDateTo,
  onChange,
  onCustomChange,
}: DateRangeSelectorProps) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {OPTIONS.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              'rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors shrink-0',
              selected === opt.id
                ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {selected === 'custom' && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">From</label>
            <input
              type="date"
              max={customDateTo ?? todayStr}
              value={customDateFrom ?? ''}
              onChange={(e) => onCustomChange(e.target.value || null, customDateTo)}
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">To</label>
            <input
              type="date"
              min={customDateFrom ?? undefined}
              max={todayStr}
              value={customDateTo ?? ''}
              onChange={(e) => onCustomChange(customDateFrom, e.target.value || null)}
              className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-zinc-400"
            />
          </div>
          {(customDateFrom || customDateTo) && (
            <button
              onClick={() => onCustomChange(null, null)}
              className="text-xs text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
