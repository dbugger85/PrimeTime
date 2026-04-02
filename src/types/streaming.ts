import type { StreamingServiceId, Sport } from './match';

export interface RightsEntry {
  competitionId: string;
  competitionName: string;
  sport: Sport;
  services: StreamingServiceId[];
}
