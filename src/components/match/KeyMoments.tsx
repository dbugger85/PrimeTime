'use client';

import { useState } from 'react';
import type { NormalizedEvent } from '@/types/scoring';
import { cn } from '@/lib/utils';

interface KeyMomentsProps {
  events: NormalizedEvent[];
  spoilerMode: 'hide' | 'show';
  sport?: string;
}

const TIER_ICONS: Record<string, string> = {
  'Key Moment': '⚡',
  'Game Changer': '🟥',
  'Penalty': '🎯',
  'VAR Review': '📺',
  'Booking': '🟨',
  'Tactical Change': '🔄',
  'Red Flag': '🚨',
  'Safety Car': '🚗',
  'Lead Change': '🔀',
  'Overtake': '💨',
  'Fastest Lap': '⏱️',
};

export function KeyMoments({ events, spoilerMode, sport = 'football' }: KeyMomentsProps) {
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());

  const xLabel = sport === 'f1' ? 'Lap' : "'";
  const noteworthy = events
    .filter((e) => e.excitementTier === 'critical' || e.excitementTier === 'high')
    .sort((a, b) => a.minute - b.minute);

  if (noteworthy.length === 0) return null;

  const toggle = (i: number) =>
    setRevealedIndices((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });

  return (
    <div>
      <p className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wide mb-2">
        {noteworthy.length} Key Moment{noteworthy.length !== 1 ? 's' : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        {noteworthy.map((event, i) => {
          const revealed = spoilerMode === 'show' || revealedIndices.has(i);
          const icon = ICON_FOR_EVENT[event.category] ?? '⚡';

          return (
            <button
              key={i}
              onClick={() => toggle(i)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                event.excitementTier === 'critical'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
              )}
            >
              <span>{icon}</span>
              <span>
                {revealed ? `${event.category} ${event.minute}${xLabel}` : `${event.minute}${xLabel}`}
              </span>
            </button>
          );
        })}
      </div>
      {spoilerMode === 'hide' && revealedIndices.size === 0 && (
        <p className="text-xs text-zinc-400 mt-1.5">Tap a moment for details (no scores revealed)</p>
      )}
    </div>
  );
}

const ICON_FOR_EVENT: Record<string, string> = TIER_ICONS;
