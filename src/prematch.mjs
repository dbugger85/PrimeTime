// Pre-match hints for upcoming football: a rough forecast from the betting odds,
// and what's at stake from the league table. Both are worked out BEFORE kick-off
// only and then frozen: during a match the odds and the table follow the score.
// Only short codes are published (see publish.mjs), never odds or table numbers.

// "Worth watching live?" from the odds: chances { home, draw, away } (adding up to 1)
// and the expected number of goals. Returns a code, or null when there's nothing to say.
export const FORECASTS = ['even', 'lively', 'one-sided'];
export function forecastOf(odds) {
  if (!odds?.chances) return null;
  const gap = Math.abs(odds.chances.home - odds.chances.away); // 0 = even, 0.8 = big mismatch
  if (gap >= 0.5) return 'one-sided';
  if (gap < 0.4 && odds.goals >= 3.2) return 'lively'; // fairly open, and goals expected
  if (gap < 0.15) return 'even';
  return null;
}

// What's at stake: each competition's places that matter. A rule [code, k] means
// "finishing k-th or better is what counts" (for relegation: k is the last safe place).
// Listed in order of priority; a match gets the first one that applies.
// Tournaments (EURO, World Cup) get none: their groups are too short.
export const STAKES = {
  title: 'Title race',
  relegation: 'Relegation battle',
  top4: 'Top-4 race',
  top8: 'Top-8 race',
  europe: 'European spots',
  playoff: 'Play-off spots',
  group: 'Top of the group',
  qualify: 'Qualifying race',
};

export const STAKES_COMPS = new Set(['eng.1', 'nor.1', 'uefa.champions', 'uefa.nations', 'uefa.euroq', 'fifa.worldq.uefa']);

function rulesFor(compKey, groupName, size) {
  switch (compKey) {
    case 'eng.1': return [['title', 1], ['relegation', 17], ['top4', 4], ['europe', 6]];
    case 'nor.1': return [['title', 1], ['relegation', 13], ['europe', 4]]; // 14th plays a relegation play-off
    case 'uefa.champions': return [['top8', 8], ['playoff', 24]]; // league phase: 1–8 last 16, 9–24 play-offs
    case 'uefa.nations': { // League A and B: the bottom two go down (or to a play-off); C: the bottom one
      const league = /Group ([A-D])/.exec(groupName)?.[1];
      const safe = league === 'A' || league === 'B' ? size - 2 : league === 'C' ? size - 1 : 0;
      return [['group', 1], ...(safe > 0 ? [['relegation', safe]] : [])];
    }
    case 'uefa.euroq':
    case 'fifa.worldq.uefa': return [['group', 1], ['qualify', 2]];
    default: return [];
  }
}

// Leagues (Premier League, Eliteserien, the Champions League table): a team is in a race when
// it's within 6 points (title, relegation) or 3 points (the rest) of the line, and never more
// than it can still win. On the comfortable side of a line (just above the drop zone, just
// outside the top 4) it also has to be within two places of it, so mid-table doesn't count;
// everyone in the drop zone or inside the top 4 who is close on points does. A title race or
// relegation battle needs one team in it; the other races need both.
// Groups (Nations League, qualifiers): in a group of 4 nearly every match matters, so a label
// only appears in the last two rounds, for a head-to-head across the line within 3 points.
const ONE_TEAM = new Set(['title', 'relegation']);
const GROUPS = new Set(['uefa.nations', 'uefa.euroq', 'fifa.worldq.uefa']);

// tables: [{ name, rows: [{ team, rank, points, played }] }] from espn-standings.mjs.
// Returns a STAKES code or null. Leagues need a third of the season played (the CL half).
export function stakesFor(tables, home, away, compKey) {
  const table = tables?.find((t) => t.rows.some((r) => r.team === home) && t.rows.some((r) => r.team === away));
  if (!table) return null;
  const rows = [...table.rows].sort((a, b) => a.rank - b.rank);
  const total = compKey === 'uefa.champions' ? 8 : 2 * (rows.length - 1); // games in the season (or group)
  const [h, a] = [home, away].map((team) => rows.find((r) => r.team === team));
  const left = (r) => total - r.played;
  const rules = rulesFor(compKey, table.name, rows.length).filter(([, k]) => k < rows.length);

  if (GROUPS.has(compKey)) {
    if (left(h) > 2 || left(a) > 2 || left(h) <= 0 || left(a) <= 0) return null;
    for (const [code, k] of rules) {
      const [above, below] = h.rank <= k ? [h, a] : [a, h];
      if (above.rank <= k && below.rank > k && above.points - below.points <= 3) return code;
    }
    return null;
  }

  const played = Math.max(...rows.map((r) => r.played));
  if (played < total / (compKey === 'uefa.champions' ? 2 : 3)) return null;
  const inRace = (r, code, k) => {
    if (left(r) <= 0) return false;
    const comfortable = code === 'relegation' ? r.rank <= k : r.rank > k; // the side that's mostly mid-table
    if (code !== 'title' && comfortable && Math.abs(r.rank - (k + 0.5)) > 2) return false; // within two places of the line
    const margin = Math.min(ONE_TEAM.has(code) ? 6 : 3, 3 * left(r));
    return r.rank <= k ? r.points - rows[k].points <= margin : rows[k - 1].points - r.points <= margin;
  };
  for (const [code, k] of rules) {
    const [hi, ai] = [inRace(h, code, k), inRace(a, code, k)];
    if (ONE_TEAM.has(code) ? hi || ai : hi && ai) return code;
  }
  return null;
}
