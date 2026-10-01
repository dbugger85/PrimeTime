// Football from ESPN's public (unofficial) API. No key needed.
//   scoreboard?dates=YYYYMMDD  -> the matches of one day in one competition
//   summary?event=ID           -> goals, cards, shots etc. for one match

import { getJson } from '../http.mjs';

const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Each day is fetched once per run: the full build looks at today and yesterday twice
// (for replays and for "Coming up"), and the second look can use the first answer.
const dayCache = new Map();
export function fetchDay(compKey, yyyymmdd) {
  const key = `${compKey}|${yyyymmdd}`;
  if (!dayCache.has(key)) dayCache.set(key, fetchDayNow(compKey, yyyymmdd).catch((err) => { dayCache.delete(key); throw err; }));
  return dayCache.get(key);
}

async function fetchDayNow(compKey, yyyymmdd) {
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
      odds: scoreboardOdds(c.odds?.[0]), // for the pre-match forecast; never published as such
    };
  });
}

// How long before kick-off to start asking for line-ups (they come out about 75 minutes before).
export const LINEUP_MINUTES = 90;

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
  const chances = fairChances([o?.homeTeamOdds?.moneyLine, o?.drawOdds?.moneyLine, o?.awayTeamOdds?.moneyLine]);
  return chances && { home: chances[0], draw: chances[1], away: chances[2] };
}

// Moneyline odds -> chances adding up to 1, or null if any is missing.
function fairChances(lines) {
  if (!lines.every((m) => Number.isFinite(m) && m !== 0)) return null;
  const raw = lines.map((m) => (m > 0 ? 100 / (m + 100) : -m / (-m + 100)));
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((p) => p / sum);
}

// The scoreboard has the same odds as text ("+170"), plus the over/under goal line
// (e.g. 3.5, with prices for over and under). Returns { chances, goals } or null,
// where `goals` is roughly the expected number of goals: the line, nudged up or
// down by how likely the bookmaker thinks "over" is.
export function scoreboardOdds(o) {
  const price = (x) => {
    const v = x?.close?.odds ?? x?.open?.odds;
    return /^even$/i.test(v) ? 100 : Number(v); // "EVEN" is the same as +100
  };
  const ml = o?.moneyline;
  const win = fairChances([price(ml?.home), price(ml?.draw), price(ml?.away)]);
  if (!win) return null;
  const over = fairChances([price(o.total?.over), price(o.total?.under)]);
  const line = Number(o.overUnder);
  return {
    chances: { home: win[0], draw: win[1], away: win[2] },
    goals: Number.isFinite(line) ? line + (over ? 2 * (over[0] - 0.5) : 0) : null,
  };
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
  const teamOf = (e) => team(sides[e.team?.id])?.team.displayName;
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

  // One line per substitution, also for the result spoiler: "58' · Martin Miller on for
  // Mattias Käit (Estonia)". Changes at half-time (45' in period 2) or before extra time show "HT" / "ET".
  const subLines = events.filter((e) => /^substitution/i.test(e.type.text)).map((e) => {
    const [on, off] = (e.participants ?? []).map((p) => p.athlete?.displayName);
    const p = e.period?.number;
    const when = p === 2 && e.clock?.value === 2700 ? 'HT' : p === 3 && e.clock?.value === 5400 ? 'ET'
      : (e.clock?.displayValue ?? '').replace("'+", '+') || `${Math.ceil(minuteOf(e))}'`;
    const note = [teamOf(e), /injur/i.test(e.text ?? '') && 'injury'].filter(Boolean).join(', ');
    return `${when} · ${on ?? 'Unknown player'} on for ${off ?? 'unknown player'}${note ? ` (${note})` : ''}`;
  });

  return {
    result: { text: result, goals: goalLines, subs: subLines },
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
    shootoutWinner: home.shootoutScore != null && home.shootoutScore !== away.shootoutScore
      ? (Number(home.shootoutScore) > Number(away.shootoutScore) ? 'home' : 'away') : null,
  };
}

// Starting line-ups, published about 75 minutes before kick-off. Returns
// [home, away], each { formation: '4-2-3-1', players: [[shirt, name, position], …],
// bench: [[shirt, name], …] }, or null until both teams have 11 starters.
// Players are ordered goalkeeper, defence, midfield, attack (left to right within each).
// The bench is sorted by shirt number: after the match ESPN marks who came on
// (subbedIn), and that's left out, as is ESPN's order, which could hint at it.
// ESPN positions look like G, LB, CD-L, CD, DM, CM-R, RM, AM-L, F, CF-R.
const lineOf = (pos) => (/^G/.test(pos) ? 0 : /^(CD|SW)|B$/.test(pos) ? 1 : /^(DM|CM|LM|RM|M)/.test(pos) ? 2 : /^AM/.test(pos) ? 3 : 4);
const sideOf = (pos) => (/^L/.test(pos) ? 0 : /-L$/.test(pos) ? 1 : /-R$/.test(pos) ? 3 : /^R/.test(pos) ? 4 : 2);

export function lineupsFromSummary(summary) {
  const team = (side) => {
    const r = (summary.rosters ?? []).find((t) => t.homeAway === side);
    const starters = (r?.roster ?? []).filter((p) => p.starter && p.athlete?.displayName);
    if (starters.length !== 11) return null;
    const players = starters
      // Once a match is under way ESPN may list starters' position as "SUB": leave that out.
      .map((p) => [p.jersey ?? '', p.athlete.displayName, p.position?.abbreviation === 'SUB' ? '' : p.position?.abbreviation ?? ''])
      .sort((a, b) => lineOf(a[2]) - lineOf(b[2]) || sideOf(a[2]) - sideOf(b[2]));
    const bench = (r.roster ?? [])
      .filter((p) => !p.starter && p.athlete?.displayName)
      .map((p) => [p.jersey ?? '', p.athlete.displayName])
      .sort((a, b) => (Number(a[0]) || 999) - (Number(b[0]) || 999) || a[1].localeCompare(b[1]));
    return { formation: r.formation ?? '', players, bench };
  };
  const both = [team('home'), team('away')];
  return both.every(Boolean) ? both : null;
}
