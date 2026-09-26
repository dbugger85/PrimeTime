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
    };
  });
}

export const fetchSummary = (compKey, espnId) => getJson(`${BASE}/${compKey}/summary?event=${espnId}`);

const minuteOf = (clock) => (clock?.value ?? 0) / 60;

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
    .map((e) => ({ min: minuteOf(e.clock), side: sides[e.team?.id] ?? 'home', own: /own goal/i.test(e.type.text) }));
  // ESPN is inconsistent about which team an own goal is credited to; check against the final score.
  const count = (side) => goals.filter((g) => g.side === side).length;
  if (count('home') !== finalScore.home || count('away') !== finalScore.away) {
    for (const g of goals) if (g.own) g.side = g.side === 'home' ? 'away' : 'home';
  }

  const plays = (summary.commentary ?? []).map((c) => c.play).filter((p) => p && inPlay(p));
  const typed = (re) => plays.filter((p) => re.test(p.type?.text ?? '')).map((p) => minuteOf(p.clock));
  const stat = (name) =>
    (summary.boxscore?.teams ?? []).reduce(
      (sum, t) => sum + Number(t.statistics?.find((s) => s.name === name)?.displayValue ?? 0), 0);

  return {
    goals,
    reds: events.filter((e) => /red card/i.test(e.type.text)).map((e) => minuteOf(e.clock)),
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
