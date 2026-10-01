// League tables from ESPN's public (unofficial) API, one request per competition:
//   standings  -> every group (one for a league, 14 for the Nations League)
// Used only for "what's at stake" before kick-off (src/prematch.mjs).

import { getJson } from '../http.mjs';

// Returns [{ name: 'Group A1', rows: [{ team, rank, points, played }] }].
// There's no season parameter: ESPN returns its current season, which for the qualifiers
// can be the last, finished campaign. That's harmless (everyone has played every game, so
// nothing is at stake), and the season is logged so it's easy to spot.
export async function fetchTables(compKey) {
  const data = await getJson(`https://site.api.espn.com/apis/v2/sports/soccer/${compKey}/standings`);
  console.log(`standings ${compKey}: ${data.season?.displayName ?? data.season?.year ?? 'season unknown'}`);
  return tablesFrom(data);
}

export function tablesFrom(data) {
  return (data.children ?? []).map((g) => ({
    name: g.name ?? '',
    rows: (g.standings?.entries ?? []).map((e) => {
      const stat = (name) => Number(e.stats?.find((s) => s.name === name)?.value ?? 0);
      return { team: e.team?.displayName, rank: stat('rank'), points: stat('points'), played: stat('gamesPlayed') };
    }).filter((r) => r.team && r.rank > 0),
  }));
}
