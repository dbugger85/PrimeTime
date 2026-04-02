'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Sport, StreamingServiceId } from '@/types/match';

export type DateRange = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom';

interface UserPreferencesState {
  selectedSport: Sport;
  subscribedServices: StreamingServiceId[];
  /** Empty = all competitions. Non-empty = only show these competition IDs. */
  subscribedCompetitions: string[];
  dateRange: DateRange;
  /** ISO date strings (YYYY-MM-DD) used when dateRange === 'custom' */
  customDateFrom: string | null;
  customDateTo: string | null;
  spoilerMode: 'hide' | 'show';
  setSelectedSport: (sport: Sport) => void;
  toggleService: (id: StreamingServiceId) => void;
  toggleCompetition: (id: string) => void;
  setAllCompetitions: (ids: string[]) => void;
  setDateRange: (range: DateRange) => void;
  setCustomDateRange: (from: string | null, to: string | null) => void;
  setSpoilerMode: (mode: 'hide' | 'show') => void;
}

export const useUserPreferences = create<UserPreferencesState>()(
  persist(
    (set) => ({
      selectedSport: 'football',
      subscribedServices: ['viaplay', 'tv2play'],
      subscribedCompetitions: [],
      dateRange: 'today',
      customDateFrom: null,
      customDateTo: null,
      spoilerMode: 'hide',

      setSelectedSport: (sport) => set({ selectedSport: sport }),

      toggleService: (id) =>
        set((state) => ({
          subscribedServices: state.subscribedServices.includes(id)
            ? state.subscribedServices.filter((s) => s !== id)
            : [...state.subscribedServices, id],
        })),

      toggleCompetition: (id) =>
        set((state) => ({
          subscribedCompetitions: state.subscribedCompetitions.includes(id)
            ? state.subscribedCompetitions.filter((c) => c !== id)
            : [...state.subscribedCompetitions, id],
        })),

      setAllCompetitions: (ids) => set({ subscribedCompetitions: ids }),

      setDateRange: (range) => set({ dateRange: range }),

      setCustomDateRange: (from, to) =>
        set({ dateRange: 'custom', customDateFrom: from, customDateTo: to }),

      setSpoilerMode: (mode) => set({ spoilerMode: mode }),
    }),
    {
      name: 'primetime-user-preferences',
    }
  )
);
