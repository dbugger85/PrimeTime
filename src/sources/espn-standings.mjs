// League tables from ESPN's public (unofficial) API, one request per competition:
//   standings  -> every group (one for a league, 14 for the Nations League)
// Used for "what's at stake" before kick-off (src/prematch.mjs), the Elo ratings, and the
// league tables in the Team view (docs/data/standings.json, via publishStandings()).

import { getJson } from '../http.mjs';

// Returns [{ name: 'Group A1', rows: [{ team, rank, points, played, won, drawn, lost, gf, ga, gd, note }] }].
// There's no season parameter: ESPN returns its current season, which for the qualifiers
// can be the last, finished campaign. That's harmless (everyone has played every game, so
// nothing is at stake), and the season is logged so it's easy to spot.
export async function fetchTables(compKey) {
  return (await fetchStandings(compKey)).groups;
}

// The same, with the season's name: { season: '2026-27 English Premier League', groups }.
export async function fetchStandings(compKey) {
  const data = await getJson(`https://site.api.espn.com/apis/v2/sports/soccer/${compKey}/standings`);
  const season = data.season?.displayName ?? String(data.season?.year ?? '');
  console.log(`standings ${compKey}: ${season || 'season unknown'}`);
  return { season, groups: tablesFrom(data) };
}

export function tablesFrom(data) {
  return (data.children ?? []).map((g) => ({
    name: g.name ?? '',
    rows: (g.standings?.entries ?? []).map((e) => {
      const stat = (name) => Number(e.stats?.find((s) => s.name === name)?.value ?? 0);
      return { team: e.team?.displayName, rank: stat('rank'), points: stat('points'), played: stat('gamesPlayed'),
        won: stat('wins'), drawn: stat('ties'), lost: stat('losses'), gf: stat('pointsFor'), ga: stat('pointsAgainst'),
        gd: stat('pointDifferential'), note: e.note?.description ?? '' };
    }).filter((r) => r.team && r.rank > 0),
  }));
}
