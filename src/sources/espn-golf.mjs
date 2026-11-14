// Golf from ESPN's public (unofficial) API, no key needed: PGA Tour official individual
// stroke-play events plus the four majors (about 40 a year). Modelled on espn-tennis.mjs.
//   - The season's calendar: the scoreboard for a day without golf (Dec 31) is tiny and lists
//     every event of that season.
//   - Each tournament's leaderboard (tee times in real UTC, positions, the cut, `major`, purse),
//     parsed by parseLeaderboard() in docs/golf.js, which the page shares.
//   - Hole-by-hole scores for the replay rating: the scoreboard for the tournament's dates.
// ESPN traps found in the real data (see "Golf" in CLAUDE.md): the scoreboard's tee times have the
// wrong time zone; `score` includes playoff holes; a Monday playoff moves `endDate` and adds a
// phantom period 402; STATUS_PLAY_COMPLETE (between rounds) also says completed; placeholder
// start times are T04:00Z with timeValid: false.

import { getJson } from '../http.mjs';
import { GOLF_LEADERBOARD, parseLeaderboard, cleanName, roundsOf, currentRound, heatOf, holdHeat, outlookOf, playerState } from '../../docs/golf.js';
import { GOLF_LIVE } from '../scoring/weights.mjs';

const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard';

// Left out (the owner's scope): team events, the Presidents and Ryder Cups, Q-School and
// unofficial events. A team format also shows as a scoring system other than "Medal".
const NOT_OURS = /presidents cup|ryder cup|q-school|zurich classic|hero world challenge|grant thornton|\btgl\b|skins|shootout|pnc championship|team/i;
export const shownTournament = (name) => !NOT_OURS.test(name ?? '');

// The majors, for the streaming rights (src/rights/norway.json: rules by `series`).
export function seriesOf(name, major) {
  if (!major) return 'pga';
  if (/masters/i.test(name)) return 'masters';
  if (/u\.?s\.? open/i.test(name)) return 'us-open';
  if (/pga championship/i.test(name)) return 'pga-championship';
  if (/open/i.test(name)) return 'the-open';
  return 'pga';
}

// The events of a season: [{ id, name, start, end }], our kind only.
export async function fetchCalendar(year) {
  const data = await getJson(`${SCOREBOARD}?dates=${year}1231`);
  return (data.leagues?.[0]?.calendar ?? [])
    .map((c) => ({ id: String(c.id), name: cleanName(c.label ?? ''), start: c.startDate, end: c.endDate }))
    .filter((c) => c.id && shownTournament(c.name));
}

// A tournament's leaderboard, parsed (null before ESPN has anything).
export async function fetchTournament(id) {
  return withSeries(parseLeaderboard(await getJson(`${GOLF_LEADERBOARD}${id}`)));
}
export const withSeries = (t) => (t ? { ...t, series: seriesOf(t.name, t.major) } : t);

// The upcoming card's raw fields for a tournament (published through upcomingGolf in publish.mjs).
// `old`: the card from the previous run. Once the first tee shot has been hit, the field and the
// round 1–2 tee times are kept as they were (frozen), so no name disappears at the cut or after a
// withdrawal. A finished tournament stays a live round-4 card for KEEP_FINAL_HOURS after the last
// tee time: the full build scores it after that, so a playoff never shows as a late change.
// How tense it is (level 1): `heat` 0–3 while the round is live (held for 15 minutes before it may
// drop: `held` is { heat, at }, kept in state.golfHeat by the caller), `outlook` between rounds
// (before rounds 3 and 4). Once the tournament is over the heat stays as it last was.
export const KEEP_FINAL_HOURS = 6;
export function golfCard(t, old, now = new Date(), held = null) {
  const rounds = roundsOf(t);
  const started = t.state !== 'pre' || t.players.some((p) => p.thru > 0);
  const frozen = started && old?.field?.length;
  const field = frozen ? old.field : t.players.map((p) => p.name);
  const tees = frozen ? old.tees : Object.fromEntries(t.players.map((p) => [p.name, p.tees.slice(0, 2)]));
  const round = t.state === 'final' ? 4 : currentRound(t);
  const r = rounds[round - 1];
  const live = t.state === 'final' || (t.state === 'in' && (!r.first || now >= new Date(r.first)));
  let heat = null;
  if (t.state === 'final') heat = held?.heat ?? old?.heat ?? null; // frozen: a later change would say how it ended
  else if (live) held = holdHeat(held, heatOf(t.players, round, GOLF_LIVE), now.getTime()), heat = held.heat;
  const outlook = !live ? outlookOf(t.players, round) : null;
  return { round, rounds, field, tees, live, heat, outlook, held: live ? held : null };
}

// The golfers seen in a field in the last GOLFERS_DAYS days (state.golfers: { name: last seen }),
// for the favorites search box (`golfers` in events.json), so a player can be followed between
// tournaments. Names only, sorted by name.
export const GOLFERS_DAYS = 60;
export function noteGolfers(state, t, now = new Date()) {
  state.golfers ??= {};
  for (const p of t.players) state.golfers[p.name] = now.toISOString().slice(0, 10);
  const oldest = new Date(now - GOLFERS_DAYS * 864e5).toISOString().slice(0, 10);
  for (const [name, seen] of Object.entries(state.golfers)) if (seen < oldest) delete state.golfers[name];
}

// Over, and time to hand it to the full build for scoring (see golfCard).
export function readyToScore(t, now = new Date()) {
  if (t.state !== 'final') return false;
  const last = roundsOf(t)[3]?.last;
  const from = last ? Date.parse(last) + KEEP_FINAL_HOURS * 3600e3 : Date.parse(t.end) + 30 * 3600e3;
  return now.getTime() >= from;
}

// Each player's scores to par from ESPN's scoreboard event: rounds 1–4 (null for a round not played)
// and round 4 hole by hole (holes 1–18, in hole order), plus the playoff holes (period 5) apart.
// Round totals come from each round's own `displayValue` ("-4"), never from `score` (which
// includes the playoff). A hole ESPN marks "OTHER" (a quadruple bogey or worse) is worked out from
// the round's total when it's the only one.
const toPar = (s) => (s === 'E' ? 0 : /^[+-]?\d+$/.test(String(s ?? '')) ? Number(s) : null);
export function holesFromScoreboard(event) {
  return (event?.competitions?.[0]?.competitors ?? []).map((x) => {
    const ls = x.linescores ?? [];
    const rounds = [1, 2, 3, 4].map((n) => {
      const l = ls.find((r) => r.period === n);
      return l && Number.isFinite(l.value) && l.value > 0 ? toPar(l.displayValue) : null;
    });
    const r4 = ls.find((r) => r.period === 4);
    const holes = Array(18).fill(null);
    for (const h of r4?.linescores ?? []) if (h.period >= 1 && h.period <= 18) holes[h.period - 1] = toPar(h.scoreType?.displayValue);
    const unknown = holes.map((h, i) => (h == null ? i : -1)).filter((i) => i >= 0);
    if (unknown.length === 1 && (r4?.linescores ?? []).length === 18 && rounds[3] != null) {
      holes[unknown[0]] = rounds[3] - holes.reduce((a, h) => a + (h ?? 0), 0);
    }
    const playoff = (ls.find((r) => r.period === 5)?.linescores ?? []).sort((a, b) => a.period - b.period).map((h) => toPar(h.scoreType?.displayValue));
    return { name: String(x.athlete?.displayName ?? ''), rounds, holes, playoff };
  }).filter((p) => p.name);
}

const ymd = (iso, days = 0) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10).replaceAll('-', '');

// Hole-by-hole scores of a finished tournament (for the replay rating), from the scoreboard for its
// dates (a range works; a Monday finish is inside `end`). Returns the raw ESPN event, or null.
export async function fetchHoles(t) {
  const data = await getJson(`${SCOREBOARD}?dates=${ymd(t.start)}-${ymd(t.end, 1)}`);
  return (data.events ?? []).find((e) => String(e.id) === String(t.id)) ?? null;
}

// docs/data/golf.json, the fourth kind of spoiler file (see "Golf" in CLAUDE.md): per tournament on
// now, the leaderboard as the page's levels 2–3 need it (a fallback for when ESPN refuses the
// page, and what the push helper reads for "Hovland is in contention"). Only fetched by the page at
// level 2+. To keep deploys down it's rewritten only when someone's level-2 status changes (in
// contention, near the cut line …) or GOLF_FILE_MIN minutes after the last write.
export const GOLF_FILE_MIN = 15;
const STATUS_KEYS = (t, field, round) => JSON.stringify(field.map((n) => playerState(t, n, round)?.status ?? null));
export function golfFileEntry(t, card, old, now = new Date()) {
  if (t.state === 'pre' && !t.players.some((p) => p.thru > 0)) return null; // nothing to tell before the first tee shot
  const field = new Set(card.field);
  const t2 = {
    state: t.state, period: t.period, cutRound: t.cutRound,
    players: t.players.filter((p) => field.has(p.name)).map((p) => ({
      name: p.name, toPar: p.toPar, thru: p.thru, pos: p.pos, status: p.status, sort: p.sort, tees: p.tees,
    })),
  };
  const entry = { updated: now.toISOString(), round: card.round, t: t2 };
  if (old && old.round === entry.round && now - new Date(old.updated) < GOLF_FILE_MIN * 60e3
    && STATUS_KEYS(old.t, card.field, card.round) === STATUS_KEYS(t2, card.field, card.round)) return old;
  return entry;
}
