import { NextRequest, NextResponse } from 'next/server';
import { scoreFootballMatch } from '@/lib/scoring/football.scorer';
import { scoreFromResult, type MatchResult } from '@/lib/scoring/football-result.scorer';
import { scoreF1Race } from '@/lib/scoring/f1.scorer';
import { MOCK_FOOTBALL_EVENTS, MOCK_F1_EVENTS } from '@/lib/mock/matches';
import { adaptFDEvents } from '@/lib/adapters/footballdata.adapter';
import { fetchAPIFootballEvents, findAPIFootballFixtureId } from '@/lib/adapters/apifootball.adapter';
import { adaptOF1RaceControlToEvents } from '@/lib/adapters/openf1.adapter';

const FOOTBALL_DATA_API = 'https://api.football-data.org/v4';
const OPENF1_API = 'https://api.openf1.org/v1';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sport: string; id: string }> }
) {
  const { sport, id } = await params;

  try {
    if (sport === 'football') {
      const result = await getFootballScore(id);
      return NextResponse.json(result, { headers: cacheHeaders() });
    }

    if (sport === 'f1') {
      const events = await getF1Events(id);
      const result = scoreF1Race(events);
      return NextResponse.json(result, { headers: cacheHeaders() });
    }

    return NextResponse.json({ error: 'Unknown sport' }, { status: 400 });
  } catch (err) {
    console.error(`Score API error [${sport}/${id}]:`, err);
    return NextResponse.json({ error: 'Failed to compute score' }, { status: 500 });
  }
}

async function getFootballScore(id: string) {
  // Mock data path
  if (!process.env.FOOTBALL_DATA_API_KEY || id.startsWith('mock-')) {
    const events = MOCK_FOOTBALL_EVENTS[id] ?? [];
    return scoreFootballMatch(events);
  }

  // Fetch the match from football-data.org for score + meta
  const res = await fetch(`${FOOTBALL_DATA_API}/matches/${id}`, {
    headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_API_KEY },
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    console.error(`football-data.org ${res.status} for match ${id}`);
    return scoreFootballMatch([]);
  }

  const data = await res.json();

  const s = data.score;
  const goalDiff = s?.fullTime
    ? Math.abs((s.fullTime.home ?? 0) - (s.fullTime.away ?? 0))
    : 0;

  // Best case: football-data.org paid tier returns per-minute events
  const goals: unknown[] = data.goals ?? [];
  const bookings: unknown[] = data.bookings ?? [];
  if (goals.length > 0 || bookings.length > 0) {
    const events = adaptFDEvents([...goals, ...bookings] as Parameters<typeof adaptFDEvents>[0]);
    return scoreFootballMatch(events, goalDiff);
  }

  if (!s?.fullTime) return scoreFootballMatch([]);

  // Second choice: try API-Football for exact event minutes (if key configured)
  if (process.env.APIFOOTBALL_API_KEY) {
    // football-data.org and API-Football use different fixture IDs — cross-reference by team + date
    const fixtureId = await findAPIFootballFixtureId(
      data.homeTeam?.name ?? '',
      data.awayTeam?.name ?? '',
      data.utcDate ?? ''
    );
    if (fixtureId) {
      const apiFootballEvents = await fetchAPIFootballEvents(fixtureId);
      if (apiFootballEvents && apiFootballEvents.length > 0) {
        return scoreFootballMatch(apiFootballEvents, goalDiff);
      }
    }
  }

  // Fallback: derive score from result data only (no per-minute events)
  const matchResult: MatchResult = {
    fullTimeHome: s.fullTime.home ?? 0,
    fullTimeAway: s.fullTime.away ?? 0,
    halfTimeHome: s.halfTime?.home ?? 0,
    halfTimeAway: s.halfTime?.away ?? 0,
    duration: s.duration ?? 'REGULAR',
    winner: s.winner ?? 'DRAW',
  };

  return scoreFromResult(matchResult);
}

async function getF1Events(id: string) {
  if (id.startsWith('f1-mock-')) return MOCK_F1_EVENTS[id] ?? [];

  const sessionKey = parseInt(id, 10);
  if (isNaN(sessionKey)) return [];

  const res = await fetch(
    `${OPENF1_API}/race_control?session_key=${sessionKey}`,
    { next: { revalidate: 3600 } }
  );

  if (!res.ok) return MOCK_F1_EVENTS[id] ?? [];

  const data = await res.json();
  return adaptOF1RaceControlToEvents(data);
}

function cacheHeaders() {
  return { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=60' };
}
