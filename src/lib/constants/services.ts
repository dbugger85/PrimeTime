import type { StreamingService } from '@/types/match';

export const STREAMING_SERVICES: StreamingService[] = [
  { id: 'viaplay', label: 'Viaplay', color: '#0066FF' },
  { id: 'tv2play', label: 'TV 2 Play', color: '#E4001B' },
  { id: 'max', label: 'Max', color: '#002BE7' },
  { id: 'discovery', label: 'Discovery+', color: '#0063DB' },
  { id: 'nrk', label: 'NRK TV', color: '#323232' },
  { id: 'amazon', label: 'Prime Video', color: '#00A8E1' },
] as const;

export const SERVICES_BY_ID = Object.fromEntries(
  STREAMING_SERVICES.map((s) => [s.id, s])
) as Record<string, StreamingService>;
