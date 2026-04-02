'use client';

import { STREAMING_SERVICES } from '@/lib/constants/services';
import type { StreamingServiceId } from '@/types/match';
import { cn } from '@/lib/utils';

interface StreamingServiceFilterProps {
  selected: StreamingServiceId[];
  onToggle: (id: StreamingServiceId) => void;
}

export function StreamingServiceFilter({ selected, onToggle }: StreamingServiceFilterProps) {
  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-3">
        My streaming services
      </p>
      <div className="flex flex-wrap gap-2">
        {STREAMING_SERVICES.map((service) => {
          const active = selected.includes(service.id);
          return (
            <button
              key={service.id}
              onClick={() => onToggle(service.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                active
                  ? 'bg-zinc-900 border-zinc-900 text-white dark:bg-white dark:border-white dark:text-zinc-900'
                  : 'border-zinc-200 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400 hover:border-zinc-300'
              )}
            >
              {service.label}
            </button>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="text-xs text-zinc-400 mt-2">
          Select your services to filter matches to what you can watch
        </p>
      )}
    </div>
  );
}
