import type { Match } from '@/types/match';
import type { F1RaceEvent } from '@/lib/scoring/f1.scorer';
import { getServicesForCompetition } from '@/lib/streaming/rights';

// OpenF1 API types
export interface OF1Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  location: string;
  country_name: string;
  circuit_short_name: string;
  meeting_name: string;
  year: number;
}

export interface OF1RaceControl {
  date: string;
  driver_number?: number;
  flag: string;
  lap_number?: number;
  message: string;
  scope: string;
  session_key: number;
}

export interface OF1Position {
  date: string;
  driver_number: number;
  position: number;
  session_key: number;
  lap_number?: number;
}

export function adaptOF1Session(session: OF1Session): Match {
  return {
    id: String(session.session_key),
    sport: 'f1',
    homeTeam: session.meeting_name,
    awayTeam: session.circuit_short_name,
    competition: 'Formula 1',
    competitionId: 'f1-season',
    matchday: session.session_name,
    utcDate: session.date_start,
    status: inferF1Status(session),
    duration: 57, // typical lap count
    streamingServices: getServicesForCompetition('f1-season'),
  };
}

export function adaptOF1RaceControlToEvents(raceControl: OF1RaceControl[]): F1RaceEvent[] {
  const events: F1RaceEvent[] = [];
  // Track what we've already emitted per lap to avoid duplicates
  const emitted = new Set<string>();

  for (const rc of raceControl) {
    if (rc.lap_number == null) continue;
    const type = classifyRaceControlMessage(rc.flag, rc.message);
    if (!type) continue;

    // Deduplicate: only one SC/VSC/RED per lap
    const dedupeKey = `${type}:${rc.lap_number}`;
    if (emitted.has(dedupeKey)) continue;
    emitted.add(dedupeKey);

    events.push({ lap: rc.lap_number, type, detail: rc.message });
  }

  return events;
}

/**
 * Returns a meaningful event type ONLY for the specific deployment/trigger messages.
 * Returns null for everything else (informational, clearings, investigations, penalties, etc.)
 */
function classifyRaceControlMessage(
  flag: string | null,
  message: string
): F1RaceEvent['type'] | null {
  const msg = message.toUpperCase();

  // Red flag — only the actual stoppage, not clearings
  if (flag === 'RED' || msg === 'RED FLAG') return 'RED_FLAG';

  // Safety car — ONLY the deployment message, not "IN THIS LAP", "THROUGH THE PIT LANE",
  // "INFRINGEMENT", "LAPPED CARS MAY OVERTAKE", etc.
  if (msg === 'SAFETY CAR DEPLOYED') return 'SAFETY_CAR';

  // Virtual safety car — only the deployment
  if (msg === 'VIRTUAL SAFETY CAR DEPLOYED') return 'VIRTUAL_SAFETY_CAR';

  // Fastest lap — explicit message
  if (msg.includes('FASTEST LAP')) return 'FASTEST_LAP';

  // DRS disabled during race (not pre-race checks)
  if (msg.includes('DRS DISABLED') && !msg.includes('ZONE')) return 'DRS_DISABLED';

  return null;
}

export function detectLeadChanges(positions: OF1Position[]): F1RaceEvent[] {
  const events: F1RaceEvent[] = [];
  const lapLeaders = new Map<number, number>(); // lap → driver

  for (const pos of positions) {
    if (pos.position === 1 && pos.lap_number) {
      const currentLeader = lapLeaders.get(pos.lap_number);
      if (currentLeader && currentLeader !== pos.driver_number) {
        events.push({ lap: pos.lap_number, type: 'LEAD_CHANGE' });
      }
      lapLeaders.set(pos.lap_number, pos.driver_number);
    }
  }
  return events;
}

function inferF1Status(session: OF1Session): Match['status'] {
  const now = new Date();
  const start = new Date(session.date_start);
  const end = new Date(session.date_end);
  if (now < start) return 'SCHEDULED';
  if (now >= start && now <= end) return 'IN_PLAY';
  return 'FINISHED';
}

