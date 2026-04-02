'use client';

import { useUserPreferences } from '@/stores/userPreferences.store';
import { Eye, EyeOff, Settings, X } from 'lucide-react';
import { useState } from 'react';
import { StreamingServiceFilter } from '@/components/filters/StreamingServiceFilter';
import { CompetitionFilter } from '@/components/filters/CompetitionFilter';

export function Header() {
  const {
    spoilerMode, setSpoilerMode,
    subscribedServices, toggleService,
    subscribedCompetitions, toggleCompetition, setAllCompetitions,
    selectedSport,
  } = useUserPreferences();
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <header className="sticky top-0 z-50 bg-white/80 dark:bg-zinc-950/80 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎬</span>
            <span className="font-bold text-lg tracking-tight text-zinc-900 dark:text-zinc-100">
              PrimeTime
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setSpoilerMode(spoilerMode === 'hide' ? 'show' : 'hide')}
              className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              title={spoilerMode === 'hide' ? 'Scores hidden' : 'Scores visible'}
            >
              {spoilerMode === 'hide' ? (
                <><EyeOff className="h-3.5 w-3.5" /> No spoilers</>
              ) : (
                <><Eye className="h-3.5 w-3.5" /> Spoilers on</>
              )}
            </button>

            <button
              onClick={() => setShowSettings((s) => !s)}
              className="rounded-full p-2 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              title="Settings"
            >
              {showSettings ? <X className="h-4 w-4" /> : <Settings className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>

      {/* Settings panel */}
      {showSettings && (
        <div className="bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800">
          <div className="max-w-2xl mx-auto px-4 py-5 space-y-5">
            <StreamingServiceFilter selected={subscribedServices} onToggle={toggleService} />
            <div className="border-t border-zinc-100 dark:border-zinc-800" />
            <CompetitionFilter
              sport={selectedSport}
              selected={subscribedCompetitions}
              onToggle={toggleCompetition}
              onSelectAll={() => setAllCompetitions([])}
            />
          </div>
        </div>
      )}
    </>
  );
}
