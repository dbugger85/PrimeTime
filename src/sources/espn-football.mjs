// Football from ESPN's public (unofficial) API. No key needed.
//   scoreboard?dates=YYYYMMDD  -> the matches of one day in one competition
//   summary?event=ID           -> goals, cards, shots etc. for one match

import { getJson } from '../http.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

export async function fetchDay(compKey, yyyymmdd) {
  const data = await getJson(`${BASE}/${compKey}/scoreboard?dates=${yyyymmdd}`);
  return (data.events ?? []).map((e) => {
    const c = e.competitions?.[0] ?? {};
    const team = (side) => c.competitors?.find((t) => t.homeAway === side)?.team?.displayName ?? '?';
    return {
      espnId: e.id,
      start: e.date,
      home: team('home'),
      away: team('away'),
      finished: Boolean(e.status?.type?.completed),
      state: e.status?.type?.state, // 'pre' (not started), 'in' (playing now) or 'post'
    };
  });
}

export const fetchSummary = (compKey, espnId) => getJson(`${BASE}/${compKey}/summary?event=${espnId}`);

// Match minute, with stoppage time kept inside its own half (45+3' counts as 44.9, not 48).
const PERIOD_SPAN = { 1: [0, 45], 2: [45, 90], 3: [90, 105], 4: [105, 120] };
const minuteOf = (e) => {
  const [lo, hi] = PERIOD_SPAN[e.period?.number] ?? [0, 120];
  return Math.min(Math.max((e.clock?.value ?? 0) / 60, lo), hi - 0.1);
};

// Pre-match win chances from the betting odds ESPN shows (American "moneyline"
// odds: +250 pays 250 on 100, -340 means stake 340 to win 100). The bookmaker's
// margin makes the raw chances add up to more than 1, so they're scaled back.
// Returns { home, draw, away } adding up to 1, or null without odds.
export function winChances(summary) {
  const o = (summary.pickcenter ?? summary.odds ?? [])[0];
  const lines = [o?.homeTeamOdds?.moneyLine, o?.drawOdds?.moneyLine, o?.awayTeamOdds?.moneyLine];
  if (!lines.every((m) => Number.isFinite(m) && m !== 0)) return null;
  const raw = lines.map((m) => (m > 0 ? 100 / (m + 100) : -m / (-m + 100)));
  const sum = raw.reduce((a, b) => a + b, 0);
  const [home, draw, away] = raw.map((p) => p / sum);
  return { home, draw, away };
}

// Turns an ESPN summary into the plain facts the scorer needs.
export function factsFromSummary(summary) {
  const comp = summary.header.competitions[0];
  const sides = Object.fromEntries(comp.competitors.map((t) => [t.team.id, t.homeAway]));
  const finalScore = Object.fromEntries(comp.competitors.map((t) => [t.homeAway, Number(t.score)]));
  const status = comp.status.type.name;
  const inPlay = (e) => (e.period?.number ?? 1) <= 4; // period 5 = penalty shootout

  const events = (summary.keyEvents ?? []).filter(inPlay);
  const goals = events
    .filter((e) => e.scoringPlay)
    .map((e) => ({
      min: minuteOf(e),
      side: sides[e.team?.id] ?? 'home',
      own: /own goal/i.test(e.type.text),
      pen: /^penalty/i.test(e.type.text),
      clock: (e.clock?.displayValue ?? '').replace("'+", '+'), // "45'+2'" -> "45+2'"
      name: e.participants?.[0]?.athlete?.displayName,
    }));
  // ESPN is inconsistent about which team an own goal is credited to; check against the final score.
  const count = (side) => goals.filter((g) => g.side === side).length;
  if (count('home') !== finalScore.home || count('away') !== finalScore.away) {
    for (const g of goals) if (g.own) g.side = g.side === 'home' ? 'away' : 'home';
  }

  const plays = (summary.commentary ?? []).map((c) => c.play).filter((p) => p && inPlay(p));
  const typed = (re) => plays.filter((p) => re.test(p.type?.text ?? '')).map((p) => minuteOf(p));
  const stat = (name) =>
    (summary.boxscore?.teams ?? []).reduce(
      (sum, t) => sum + Number(t.statistics?.find((s) => s.name === name)?.displayValue ?? 0), 0);

  const team = (side) => comp.competitors.find((t) => t.homeAway === side);
  const [home, away] = [team('home'), team('away')];
  let result = `${home.team.displayName} ${home.score}–${away.score} ${away.team.displayName}`;
  if (home.shootoutScore != null) result += ` (${home.shootoutScore}–${away.shootoutScore} on penalties)`;
  else if (status === 'STATUS_FINAL_AET') result += ' (after extra time)';

  // One line per goal for the result spoiler: "36' · 0–1 · Jude Bellingham (England)".
  const tally = { home: 0, away: 0 };
  const goalLines = goals.map((g) => {
    tally[g.side]++;
    const who = g.name ?? 'Unknown scorer';
    const note = g.own ? 'own goal' : [team(g.side).team.displayName, g.pen && 'pen'].filter(Boolean).join(', ');
    return `${g.clock || `${Math.ceil(g.min)}'`} · ${tally.home}–${tally.away} · ${who} (${note})`;
  });

  return {
    result: { text: result, goals: goalLines },
    goals,
    odds: winChances(summary),
    reds: events.filter((e) => /red card/i.test(e.type.text)).map((e) => minuteOf(e)),
    pens: typed(/^penalty/i),
    vars: typed(/^VAR/i),
    disallowed: typed(/deleted after review/i), // goals ruled out by VAR
    woodwork: typed(/woodwork/i),
    corners: typed(/corner awarded/i).length,
    yellows: events.filter((e) => /yellow card/i.test(e.type.text)).length,
    shotsOn: typed(/shot on target/i),
    shotsOff: typed(/shot off target|shot blocked/i),
    totalShots: stat('totalShots'),
    shotsOnTarget: stat('shotsOnTarget'),
    extraTime: status === 'STATUS_FINAL_AET' || status === 'STATUS_FINAL_PEN' || events.some((e) => e.period?.number >= 3),
    shootout: status === 'STATUS_FINAL_PEN' || comp.competitors.some((t) => t.shootoutScore != null),
  };
}
