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
import { GOLF_LEADERBOARD, parseLeaderboard, cleanName, roundsOf, currentRound } from '../../docs/golf.js';

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
export const KEEP_FINAL_HOURS = 6;
export function golfCard(t, old, now = new Date()) {
  const rounds = roundsOf(t);
  const started = t.state !== 'pre' || t.players.some((p) => p.thru > 0);
  const frozen = started && old?.field?.length;
  const field = frozen ? old.field : t.players.map((p) => p.name);
  const tees = frozen ? old.tees : Object.fromEntries(t.players.map((p) => [p.name, p.tees.slice(0, 2)]));
  const round = t.state === 'final' ? 4 : currentRound(t);
  const r = rounds[round - 1];
  const live = t.state === 'final' || (t.state === 'in' && (!r.first || now >= new Date(r.first)));
  return { round, rounds, field, tees, live };
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

const ymd = (iso, days = 0) => new Date(Date.parse(iso) + days * 864e5).toISOString().slice(0, 10).replaceAll('-', '');

// Hole-by-hole scores of a finished tournament (for the replay rating), from the scoreboard for its
// dates (a range works; a Monday finish is inside `end`). Returns the raw ESPN event, or null.
export async function fetchHoles(t) {
  const data = await getJson(`${SCOREBOARD}?dates=${ymd(t.start)}-${ymd(t.end, 1)}`);
  return (data.events ?? []).find((e) => String(e.id) === String(t.id)) ?? null;
}
