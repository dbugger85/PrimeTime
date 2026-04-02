import { NextRequest, NextResponse } from 'next/server';
import type { Sport } from '@/types/match';
import { MOCK_FOOTBALL_MATCHES, MOCK_F1_SESSIONS } from '@/lib/mock/matches';
import { adaptFDMatch } from '@/lib/adapters/footballdata.adapter';
import { adaptOF1Session } from '@/lib/adapters/openf1.adapter';

const FOOTBALL_DATA_API = 'https://api.football-data.org/v4';
const OPENF1_API = 'https://api.openf1.org/v1';

// Club competitions — fetch recent finished matches
const CLUB_COMPETITIONS = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'CL', 'EL'];

// International competitions — fetch both finished and upcoming (tournaments are infrequent)
const INTERNATIONAL_COMPETITIONS = ['EC', 'WC'];

export async function GET(request: NextRequest) {
  const sport = (request.nextUrl.searchParams.get('sport') ?? 'football') as Sport;
  const useMock = !process.env.FOOTBALL_DATA_API_KEY;

  try {
    if (sport === 'football') {
      if (useMock) {
        return NextResponse.json({ matches: MOCK_FOOTBALL_MATCHES });
      }
      const matches = await fetchFootballMatches();
      return NextResponse.json({ matches }, { headers: cacheHeaders(300) });
    }

    if (sport === 'f1') {
      const sessions = await fetchF1Sessions();
      return NextResponse.json({ matches: sessions }, { headers: cacheHeaders(300) });
    }

    return NextResponse.json({ matches: [] });
  } catch (err) {
    console.error('Matches API error:', err);
    // Fall back to mock data on error
    if (sport === 'football') {
      return NextResponse.json({ matches: MOCK_FOOTBALL_MATCHES });
    }
    return NextResponse.json({ matches: MOCK_F1_SESSIONS });
  }
}

async function fetchFootballMatches() {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY!;
  const allMatches = [];

  // Club competitions: recent finished matches
  for (const comp of CLUB_COMPETITIONS) {
    const res = await fetch(`${FOOTBALL_DATA_API}/competitions/${comp}/matches?status=FINISHED&limit=5`, {
      headers: { 'X-Auth-Token': apiKey },
      next: { revalidate: 300 },
    });
    if (!res.ok) continue;
    const data = await res.json();
    allMatches.push(...(data.matches ?? []).map(adaptFDMatch));
  }

  // International: finished + upcoming (tournaments are rare, show both)
  for (const comp of INTERNATIONAL_COMPETITIONS) {
    // Finished
    const finRes = await fetch(`${FOOTBALL_DATA_API}/competitions/${comp}/matches?status=FINISHED&limit=10`, {
      headers: { 'X-Auth-Token': apiKey },
      next: { revalidate: 300 },
    });
    if (finRes.ok) {
      const data = await finRes.json();
      allMatches.push(...(data.matches ?? []).map(adaptFDMatch));
    }
    // Upcoming (next 30 days)
    const dateFrom = new Date().toISOString().split('T')[0];
    const dateTo = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const upRes = await fetch(
      `${FOOTBALL_DATA_API}/competitions/${comp}/matches?status=SCHEDULED&dateFrom=${dateFrom}&dateTo=${dateTo}`,
      { headers: { 'X-Auth-Token': apiKey }, next: { revalidate: 300 } }
    );
    if (upRes.ok) {
      const data = await upRes.json();
      allMatches.push(...(data.matches ?? []).map(adaptFDMatch));
    }
  }

  // Sort by date descending, deduplicate by id
  const seen = new Set<string>();
  return allMatches
    .filter((m) => { if (seen.has(m.id)) return false; seen.add(m.id); return true; })
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime());
}

async function fetchF1Sessions() {
  const year = new Date().getFullYear();
  const res = await fetch(
    `${OPENF1_API}/sessions?session_type=Race&year=${year}`,
    { next: { revalidate: 300 } }
  );

  if (!res.ok) return MOCK_F1_SESSIONS;

  const data = await res.json();
  const sessions = (data as Parameters<typeof adaptOF1Session>[0][]).map(adaptOF1Session);

  // Only past races
  return sessions
    .filter((s) => new Date(s.utcDate) <= new Date())
    .sort((a, b) => new Date(b.utcDate).getTime() - new Date(a.utcDate).getTime())
    .slice(0, 10);
}

function cacheHeaders(seconds: number) {
  return { 'Cache-Control': `s-maxage=${seconds}, stale-while-revalidate=60` };
}
