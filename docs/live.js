// Live football: the match clock and the "Excitement so far" number.
// Pure functions, used both by the page (which asks ESPN itself while a live
// card is on screen) and by the bot (scripts/live.mjs, the fallback every 5 minutes).
// Nothing here may return the score, a scorer or anything else that says who leads.

export const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// Match minute, with stoppage time kept inside its own half (45+3' counts as 44.9, not 48).
export const PERIOD_SPAN = { 1: [0, 45], 2: [45, 90], 3: [90, 105], 4: [105, 120] };
export const minuteOf = (e) => {
  const [lo, hi] = PERIOD_SPAN[e.period?.number] ?? [0, 120];
  return Math.min(Math.max((e.clock?.value ?? 0) / 60, lo), hi - 0.1);
};

// The days to look a match up under on ESPN's scoreboard (YYYYMMDD). ESPN's days are
// US Eastern days, so a kick-off before 06:00 UTC is also looked for under the day before.
export function espnDays(start) {
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '');
  const t = Date.parse(start);
  return new Date(t).getUTCHours() < 6 ? [ymd(t), ymd(t - 864e5)] : [ymd(t)];
}

// The clock from an ESPN status (scoreboard event or summary header), while the match is on:
// { min, plus, period, paused } or null. `min` stops at the end of the half; `plus` is the
// stoppage time shown so far ("45'+2'" -> min 45, plus 2). `paused`: half-time and other breaks.
export function clockOf(status) {
  if (status?.type?.state !== 'in') return null;
  const period = Number(status.period) || 1;
  const [lo, hi] = PERIOD_SPAN[period] ?? [120, 120];
  const shown = String(status.displayClock ?? '').match(/^(\d+)'?(?:\s*\+\s*(\d+))?/);
  const fromClock = Number.isFinite(status.clock) ? Math.floor(status.clock / 60) : shown ? Number(shown[1]) : lo;
  const min = Math.min(Math.max(fromClock, lo), hi);
  const plus = shown?.[2] ? Number(shown[2]) : 0;
  const paused = /HALFTIME|END_PERIOD|DELAYED|SUSPENDED|SHOOTOUT/.test(status.type.name ?? '') || period >= 5;
  return { min, plus, period, paused };
}

// The badge text for a clock that was read at `clock.at`: counts up on its own between
// updates. Past the end of a half it only says "45+'", unless the clock is fresh (ESPN's
// stoppage time is unknown until it's shown). '' when the clock is too old to trust.
export function liveClockText(clock, now = Date.now()) {
  if (!clock) return '';
  const age = (now - Date.parse(clock.at)) / 60e3;
  if (!(age >= -1 && age <= 20)) return '';
  if (clock.period >= 5) return 'Pens';
  const [lo, hi] = PERIOD_SPAN[clock.period] ?? [120, 120];
  // Paused: half-time (end of the 1st half), a break at the end or start of a later period
  // (before extra time), or a delay or suspension in the middle of a half.
  if (clock.paused) return clock.min >= hi ? (clock.period === 1 ? 'HT' : 'Break') : clock.min <= lo && clock.period > 1 ? 'Break' : 'Paused';
  const m = clock.min + (clock.plus ?? 0) + Math.max(0, Math.floor(age));
  if (m < hi) return `${m}'`;
  return age <= 2 && m > hi ? `${hi}+${m - hi}'` : `${hi}+'`;
}

// Time since the start, for live F1 and winter cards: "23 min", "1 h 23". '' before the start.
export function elapsedText(start, now = Date.now()) {
  const m = Math.floor((now - Date.parse(start)) / 60e3);
  if (!(m >= 0)) return '';
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

// Minutes played so far, from the clock (stoppage time counts as the end of its half).
export const playedOf = (clock) => (clock ? (clock.period >= 5 ? 120 : clock.min) : 0);

// The facts the live number needs, from an ESPN match summary in progress: minutes of goals
// (with the side), red cards, penalties, goals ruled out by VAR, woodwork and shots.
// Deliberately no names, no score and no result text.
export function liveFacts(summary) {
  const comp = summary?.header?.competitions?.[0];
  if (!comp) return null;
  const sides = Object.fromEntries((comp.competitors ?? []).map((t) => [t.team?.id, t.homeAway]));
  const inPlay = (e) => (e.period?.number ?? 1) <= 4; // period 5 = penalty shootout
  const events = (summary.keyEvents ?? []).filter(inPlay);
  const goals = events.filter((e) => e.scoringPlay).map((e) => ({
    min: minuteOf(e), side: sides[e.team?.id] ?? 'home', own: /own goal/i.test(e.type?.text ?? ''),
  }));
  // ESPN is inconsistent about which team an own goal is credited to; check against the running
  // score. Live, the score can update before the goal shows up, so only flip when that makes it match.
  const score = Object.fromEntries((comp.competitors ?? []).map((t) => [t.homeAway, Number(t.score)]));
  const count = (side, flip) => goals.filter((g) => (g.own && flip ? (g.side === 'home' ? 'away' : 'home') : g.side) === side).length;
  const matches = (flip) => count('home', flip) === score.home && count('away', flip) === score.away;
  if (!matches(false) && matches(true)) {
    for (const g of goals) if (g.own) g.side = g.side === 'home' ? 'away' : 'home';
  }
  const plays = (summary.commentary ?? []).map((c) => c.play).filter((p) => p && inPlay(p));
  const typed = (re) => plays.filter((p) => re.test(p.type?.text ?? '')).map(minuteOf);
  const clock = clockOf(comp.status);
  return {
    played: playedOf(clock),
    goals: goals.map(({ min, side }) => ({ min, side })),
    reds: events.filter((e) => /red card/i.test(e.type?.text ?? '')).length,
    redsBy: events.filter((e) => /red card/i.test(e.type?.text ?? '')).map((e) => ({ min: minuteOf(e), side: sides[e.team?.id] ?? null })),
    pens: typed(/^penalty/i).length,
    disallowed: typed(/deleted after review/i).length,
    woodwork: typed(/woodwork/i).length,
    shotsOn: typed(/shot on target/i).length,
    shotsOff: typed(/shot off target|shot blocked/i).length,
  };
}

// The top end of every football score: above `from` each point counts a bit less than the
// one before, bending smoothly towards 10 (see "curveFrom" in src/scoring/weights.mjs).
export function curve(x, from) {
  const a = Math.min(from, 9); // 10 or more would divide by zero
  return x > a ? a + (10 - a) * (1 - Math.exp(-(x - a) / (10 - a))) : x;
}

// Big match: ×(1 + bigMatch) for the two strongest teams, ×(1 − smallMatch) for the two weakest
// (strength 0–1 each; an average pair ×1). `smallMatch` defaults to `bigMatch`.
export const bigMatchFactor = (st, bigMatch, smallMatch = bigMatch) => {
  if (!st || !Number.isFinite(st.home) || !Number.isFinite(st.away)) return 1;
  const x = st.home + st.away - 1; // −1 for the two weakest, 0 for an average pair, 1 for the two strongest
  return 1 + (x >= 0 ? bigMatch : smallMatch) * x;
};

// ── Win chances through a match (for "suspense" and "swing", football 19) ──────────────────────
// A simple model: each team scores at a steady rate (goals per 90 minutes), fitted to the pre-match
// win/draw/win chances from the odds (equal rates without odds). From the score and the time left it
// gives the chances of a home win, a draw and an away win at any minute.
const poissons = (l) => { const p = [Math.exp(-l)]; for (let k = 1; k <= 10; k++) p.push((p[k - 1] * l) / k); return p; };
// [home win, draw, away win] when `d` is the home team's lead now and the rates are for the time left.
export function resultChances(lh, la, d) {
  const ph = poissons(lh), pa = poissons(la);
  let h = 0, dr = 0, a = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const p = ph[i] * pa[j], end = d + i - j;
    if (end > 0) h += p; else if (end < 0) a += p; else dr += p;
  }
  return [h, dr, a];
}
const rateCache = new Map();
export function ratesFromOdds(odds) {
  if (!odds || ![odds.home, odds.draw, odds.away].every(Number.isFinite)) return [1.35, 1.35];
  const key = `${odds.home.toFixed(3)}|${odds.away.toFixed(3)}`;
  if (rateCache.has(key)) return rateCache.get(key);
  const err = (lh, la) => { const [h, d, a] = resultChances(lh, la, 0); return (h - odds.home) ** 2 + (d - odds.draw) ** 2 + (a - odds.away) ** 2; };
  let best = [1.35, 1.35], e = Infinity;
  const search = (h0, h1, a0, a1, step) => {
    for (let lh = h0; lh <= h1 + 1e-9; lh += step) for (let la = a0; la <= a1 + 1e-9; la += step) {
      const x = err(lh, la);
      if (x < e) { e = x; best = [lh, la]; }
    }
  };
  search(0.2, 4, 0.2, 4, 0.1); // coarse, then fine around the best
  const [h, a] = best;
  search(Math.max(0.05, h - 0.1), h + 0.1, Math.max(0.05, a - 0.1), a + 0.1, 0.01);
  const out = best.map((x) => Math.round(x * 100) / 100);
  rateCache.set(key, out);
  return out;
}

// Suspense: the average doubt about the result, minute by minute (1 minus the likeliest result's
// chance; about 0.2 for a match decided early, 0.4+ for one open to the end). Swing: how much the
// goals moved the win chances in total (home win and away win, 1 = 100 points).
// `goals`: [{ t, side }] in real minutes (stoppage time included), sorted; `end`: the real length.
export function suspenseOf(goals, odds, end, upTo = end) {
  const [lh, la] = ratesFromOdds(odds);
  const left = (m) => Math.max(0, end - m) / 90;
  let d = 0, gi = 0, sum = 0, swing = 0, n = 0;
  const next = () => {
    const t = goals[gi].t;
    const before = resultChances(lh * left(t), la * left(t), d);
    d += goals[gi].side === 'home' ? 1 : -1;
    const after = resultChances(lh * left(t), la * left(t), d);
    swing += Math.abs(after[0] - before[0]) + Math.abs(after[2] - before[2]);
    gi++;
  };
  for (let m = 0; m < upTo; m++) {
    while (gi < goals.length && goals[gi].t <= m) next();
    sum += 1 - Math.max(...resultChances(lh * left(m), la * left(m), d));
    n++;
  }
  while (gi < goals.length && goals[gi].t <= upTo) next(); // a goal in the very last minute still swings it
  return { suspense: n ? sum / n : 0, swing };
}
// The points for them (the same on replays and live): full suspense at 0.5, nothing at 0.2 or less;
// full swing at 1.5 (150 points of win chance moved by the goals).
// (0 when the weights are older than football 19, e.g. a cached events.json.)
export const suspensePoints = (w, s) => (w.suspense ?? 0) * Math.min(1, Math.max(0, (s.suspense - 0.2) / 0.3));
export const swingPoints = (w, s) => (w.swing ?? 0) * Math.min(1, s.swing / 1.5);

export const LIVE_FROM = 15; // no number before this minute: too little to go on
export const ROUGH_UNTIL = 30; // "early, rough" until this minute

// "Excitement so far" as a pace: how much has happened per minute, scaled up to a full match,
// on the same 0–10 scale as the replay scores. Early on it's pulled towards a typical match.
// `w` holds the weights (FOOTBALL plus FOOTBALL_LIVE from src/scoring/weights.mjs; the page
// gets them from events.json). `factor` is the big-match factor. `boost`: the page's own points for
// the competition ("Custom scoring"), added before the curve as on replays. Returns { pace, rough } or null.
// `odds`: the pre-match { home, draw, away } chances (for suspense), or null. `mix`: { a, k } from
// mixFrom() in scoring.js when the four pillar sliders aren't level (the page only).
export function scoreLivePace(f, { w, factor = 1, stakes, boost = 0, odds = null, mix = null } = {}) {
  const played = f?.played ?? 0;
  if (!w || played < LIVE_FROM) return null;
  const goals = [...f.goals].sort((a, b) => a.min - b.min);

  // Things that happen: per minute, scaled up to 90 minutes.
  let rate = 0, diff = 0, prevMin = 0, closeMinutes = 0, equalisers = 0, leadChanges = 0, leader = 0;
  goals.forEach((g, i) => {
    const ahead = g.side === 'home' ? diff : -diff;
    const worth = i < 4 ? w.goal : w.extraGoal;
    rate += worth * (1 - (ahead >= 3 ? w.alreadyDecided : ahead === 2 ? w.nearlyDecided : 0));
    const min = Math.min(g.min, played);
    if (Math.abs(diff) <= 1) closeMinutes += min - prevMin;
    prevMin = min;
    diff += g.side === 'home' ? 1 : -1;
    if (diff === 0) equalisers++;
    const now = Math.sign(diff);
    if (now !== 0 && leader !== 0 && now !== leader) leadChanges++;
    if (now !== 0) leader = now;
  });
  if (Math.abs(diff) <= 1) closeMinutes += played - prevMin;
  rate += w.equaliser * equalisers + w.leadChange * Math.min(leadChanges, 3);
  rate += w.redCard * Math.min(f.reds, 2) + w.penalty * Math.min(f.pens, 2);
  // A red card for the team ahead, or for either team when level from 60' (as on replays).
  const leadAt = (m) => goals.filter((g) => g.min < m).reduce((d, g) => d + (g.side === 'home' ? 1 : -1), 0);
  const opening = (f.redsBy ?? []).filter((r) => { const d = leadAt(r.min) * (r.side === 'home' ? 1 : r.side === 'away' ? -1 : 0); return r.side && (d > 0 || (d === 0 && r.min >= 60)); }).length;
  rate += (w.redCardAhead ?? 0) * Math.min(opening, 2);
  rate += w.varDisallowed * Math.min(f.disallowed, 2) + w.woodwork * Math.min(f.woodwork, 3);
  rate += w.shotOnTarget * f.shotsOn + w.shotOffTarget * f.shotsOff;

  // How things stand: not scaled.
  const stakesPoints = stakes === 'title' ? w.titleRace : stakes === 'relegation' ? w.relegationBattle : stakes ? w.otherRace : 0;
  const oneSided = Math.abs(diff) >= 3 ? w.blowout : 0; // 3+ goals up: less worth tuning in for
  // Suspense so far (how things stand) and swing so far (scaled up like the goals).
  const s = suspenseOf(goals.map((g) => ({ t: g.min, side: g.side })), odds, 90, Math.min(played, 90));
  const sw = swingPoints(w, { swing: (s.swing * 90) / played });
  const pillars = (rate * 90) / played + w.closeMatch * (closeMinutes / played) - oneSided + (Number.isFinite(sw) ? sw : 0) + (suspensePoints(w, s) || 0);
  const raw = (mix ? mix.a + mix.k * pillars : pillars) + stakesPoints;

  // Early on, a typical match counts for `settleMinutes` minutes of play, shrinking to nothing at 90'.
  const prior = Math.max(0, w.settleMinutes * (1 - played / 90));
  const blended = (played * raw + prior * w.typicalMatch) / (played + prior);
  const x = curve(Math.max(0, Math.max(0, blended) * factor + boost), w.curveFrom);
  if (!Number.isFinite(x)) return null;
  return { pace: Math.round(Math.min(10, Math.max(0, x)) * 10) / 10, rough: played < ROUGH_UNTIL };
}

// The weights scoreLivePace uses, picked from the football weights (published in events.json,
// so weights.mjs stays the only place they're set).
export const LIVE_WEIGHT_KEYS = ['goal', 'extraGoal', 'alreadyDecided', 'nearlyDecided', 'closeMatch', 'blowout', 'equaliser', 'leadChange',
  'redCard', 'penalty', 'varDisallowed', 'woodwork', 'titleRace', 'relegationBattle', 'otherRace', 'curveFrom', 'suspense', 'swing', 'redCardAhead'];
export const liveWeightsFrom = (football, live) =>
  ({ ...Object.fromEntries(LIVE_WEIGHT_KEYS.map((k) => [k, football[k]])), ...live });
