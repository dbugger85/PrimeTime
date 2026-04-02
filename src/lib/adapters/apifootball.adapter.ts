/**
 * Adapter for API-Football (api-football.com via RapidAPI).
 * Free tier: 100 requests/day. Returns match events with exact minutes.
 * Set APIFOOTBALL_API_KEY in .env.local to enable.
 *
 * Register at: https://dashboard.api-football.com/register
 */
import type { MatchEvent } from '@/types/match';

interface APIFootballEvent {
  time: { elapsed: number; extra: number | null };
  type: string;   // "Goal" | "Card" | "subst" | "Var"
  detail: string; // "Normal Goal" | "Penalty" | "Own Goal" | "Yellow Card" | "Red Card" …
}

interface APIFootballFixture {
  fixture: { id: number };
  events: APIFootballEvent[];
}

/**
 * Map API-Football event type/detail to our internal event type strings
 * (which match the football-data.org conventions used in the scorer).
 */
function mapEventType(type: string, detail: string): string | null {
  const t = type.toLowerCase();
  const d = detail.toLowerCase();

  if (t === 'goal') {
    if (d.includes('own goal')) return 'OWN_GOAL';
    if (d.includes('penalty')) return 'PENALTY';
    return 'GOAL';
  }
  if (t === 'card') {
    if (d.includes('red')) return 'RED_CARD';
    if (d.includes('yellow') && d.includes('red')) return 'YELLOW_RED';
    return 'YELLOW_CARD';
  }
  if (t === 'var') return 'VAR';
  if (t === 'subst') return 'SUBSTITUTION';
  return null;
}

export function adaptAPIFootballEvents(events: APIFootballEvent[]): MatchEvent[] {
  return events
    .map((e) => {
      const type = mapEventType(e.type, e.detail);
      if (!type) return null;
      return {
        minute: e.time.elapsed + (e.time.extra ?? 0),
        type,
      };
    })
    .filter((e): e is MatchEvent => e !== null);
}

/**
 * Fetch match events from API-Football.
 * Returns null if the key is missing or the request fails.
 */
export async function fetchAPIFootballEvents(fixtureId: string): Promise<MatchEvent[] | null> {
  const apiKey = process.env.APIFOOTBALL_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures/events?fixture=${fixtureId}`,
      {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io',
        },
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) return null;

    const data: { response: APIFootballEvent[] } = await res.json();
    const events = data.response ?? [];
    if (events.length === 0) return null;

    return adaptAPIFootballEvents(events);
  } catch {
    return null;
  }
}

/**
 * Look up the API-Football fixture ID matching a football-data.org match.
 * We use the date + team names to search, since IDs differ between providers.
 */
export async function findAPIFootballFixtureId(
  homeTeam: string,
  awayTeam: string,
  utcDate: string
): Promise<string | null> {
  const apiKey = process.env.APIFOOTBALL_API_KEY;
  if (!apiKey) return null;

  try {
    const date = utcDate.split('T')[0];
    const res = await fetch(
      `https://v3.football.api-sports.io/fixtures?date=${date}`,
      {
        headers: {
          'x-rapidapi-key': apiKey,
          'x-rapidapi-host': 'v3.football.api-sports.io',
        },
        next: { revalidate: 3600 },
      }
    );

    if (!res.ok) return null;

    const data: { response: APIFootballFixture[] } = await res.json();
    // Match by normalised team name substring
    const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const home = normalise(homeTeam);
    const away = normalise(awayTeam);

    const match = (data.response ?? []).find((f: { teams?: { home?: { name?: string }; away?: { name?: string } }; fixture?: { id?: number } }) => {
      const h = normalise(f.teams?.home?.name ?? '');
      const a = normalise(f.teams?.away?.name ?? '');
      return (h.includes(home) || home.includes(h)) && (a.includes(away) || away.includes(a));
    });

    return match?.fixture?.id != null ? String(match.fixture.id) : null;
  } catch {
    return null;
  }
}
