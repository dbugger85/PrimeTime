// Golf: reading ESPN's leaderboard and writing the tournament card's lines.
// Pure functions (no DOM, no fetch), used both by the page and by the bot (src/sources/espn-golf.mjs),
// like docs/live.js for football. See "Golf" in CLAUDE.md.
//
// How much a card says depends on "Golf: how much to reveal" (prefs.golfSpoilers):
//   0  schedule only: rounds, tee times, when the last group reaches the back nine
//   1  also how tense it is (the bot's outlook and heat codes), never a name or a position
//   2  also your favorite players in plain words ("in contention", "near the cut line")
//   3  everything: positions and a leaderboard
// Levels 0 and 1 only use what's in events.json. Levels 2 and 3 use ESPN's leaderboard,
// which the page fetches itself (parseLeaderboard below), or the bot's docs/data/golf.json.

export const GOLF_LEADERBOARD = 'https://site.web.api.espn.com/apis/site/v2/sports/golf/leaderboard?league=pga&event=';

// The last group reaches the back nine (hole 10) about 2 h 10 after it tees off.
export const BACK_NINE_MIN = 130;
export const ROUNDS = 4;

// ESPN's player status -> ours. Cut players stay on ESPN's leaderboard (so the field never shrinks).
const OUT = { CUT: 'cut', WD: 'wd', DQ: 'dq', MDF: 'cut', DNS: 'wd' };
const num = (x) => {
  if (x === 'E') return 0;
  const n = Number(String(x ?? '').replace('+', ''));
  return Number.isFinite(n) ? n : null;
};
const iso = (t) => (typeof t === 'string' && Number.isFinite(Date.parse(t)) ? new Date(t).toISOString().replace(':00.000Z', 'Z') : null);

// ESPN's leaderboard (site.web.api.espn.com/…/golf/leaderboard?league=pga&event=<id>) -> a plain
// tournament. Tee times come from here, never from the scoreboard (whose times have the wrong time
// zone). `score` on ESPN counts only finished rounds; the total to par so far is `scoreToPar`.
//   { id, name, major, purse, state ('pre' | 'in' | 'between' | 'final'), period, cutRound, start, end,
//     course, city, players: [{ name, toPar, thru, today, status, pos, sort, tees: [r1…r4], startHole }] }
export function parseLeaderboard(json) {
  const e = json?.events?.[0];
  if (!e) return null;
  const c = e.competitions?.[0] ?? {};
  const type = c.status?.type?.name ?? e.status?.type?.name ?? '';
  // STATUS_PLAY_COMPLETE (between rounds) also says completed: true; only STATUS_FINAL means over.
  const state = type === 'STATUS_FINAL' ? 'final' : type === 'STATUS_PLAY_COMPLETE' ? 'between'
    : (c.status?.type?.state ?? e.status?.type?.state) === 'pre' ? 'pre' : 'in';
  const period = Math.min(ROUNDS, Number(c.status?.period) || 0); // 5 or 402 during and after a playoff
  const course = e.courses?.find((x) => x.host) ?? e.courses?.[0];
  const players = (c.competitors ?? []).map((p) => {
    const st = p.status ?? {};
    const shown = String(st.displayValue ?? '').toUpperCase();
    const out = st.type?.name === 'STATUS_CUT' ? OUT[shown] ?? 'cut' : OUT[shown] ?? null;
    const tees = Array.from({ length: ROUNDS }, (_, i) => iso((p.linescores ?? []).find((l) => l.period === i + 1)?.teeTime));
    const toPar = num((p.statistics ?? []).find((s) => s.name === 'scoreToPar')?.displayValue) ?? num(p.score?.displayValue);
    return {
      name: String(p.athlete?.displayName ?? '').trim(),
      toPar,
      thru: Number.isFinite(st.thru) ? st.thru : 0,
      round: Number(st.period) || period,
      today: num((p.linescores ?? []).find((l) => l.period === (Number(st.period) || period))?.displayValue),
      status: out ?? (st.type?.name === 'STATUS_FINISH' ? 'done' : 'active'),
      pos: typeof st.position?.displayName === 'string' ? st.position.displayName : '',
      sort: Number(p.sortOrder) || 999,
      playoff: st.playoff === true,
      tees,
      startHole: Number(st.startHole) || 1,
    };
  }).filter((p) => p.name);
  return {
    id: String(e.id),
    name: e.tournament?.displayName ?? cleanName(e.name ?? ''),
    major: e.tournament?.major === true,
    stroke: (e.tournament?.scoringSystem?.name ?? 'Medal') === 'Medal',
    purse: Number(e.purse) || 0,
    state,
    period,
    cutRound: Number(e.tournament?.cutRound) || 0,
    start: e.date,
    end: e.endDate,
    course: course?.name ?? '',
    city: course?.address?.city ?? '',
    players,
  };
}

// "Arnold Palmer Invitational pres. by Mastercard" -> "Arnold Palmer Invitational".
export function cleanName(name) {
  return String(name).replace(/\s+(pres\.|presented)\s+by\s+.*$/i, '').replace(/^the\b/, 'The').trim();
}

// The four round days (YYYY-MM-DD, the local date at the course: ESPN's start is 04:00–08:00 UTC
// on the first day) and, once ESPN has them, the first and last tee times (UTC, ISO).
// Round 4's tee times only exist once round 3 is over, so before that it's the day only.
export function roundsOf(t) {
  const first = Date.parse(t.start);
  return Array.from({ length: ROUNDS }, (_, i) => {
    const day = Number.isFinite(first) ? new Date(first + i * 864e5).toISOString().slice(0, 10) : '';
    const times = t.players.map((p) => p.tees[i]).filter(Boolean).sort();
    return { n: i + 1, day, ...(times.length ? { first: times[0], last: times.at(-1) } : {}) };
  });
}

// Which round the card is about: the one being played, or the next one.
export function currentRound(t) {
  if (t.state === 'pre') return 1;
  if (t.state === 'between') return Math.min(ROUNDS, t.period + 1);
  return Math.max(1, t.period);
}

// When the last group reaches the back nine (hole 10), from the last tee time.
export const backNineAt = (round) => (round?.last ? new Date(Date.parse(round.last) + BACK_NINE_MIN * 60e3).toISOString() : null);

// The card's start: the first tee time of its round, or midday on its day while the times aren't out.
export const roundStart = (round) => round.first ?? `${round.day}T12:00:00Z`;

// ── The card's lines ──────────────────────────────────────────────────────────
// e: the published upcoming entry ({ round, rounds: [{ n, day, first?, last? }], status, tees, … }).
// fmt: { time(iso) -> "14:10", day(iso) -> "Thu", isToday(iso) -> bool }.
// Returns the main line, e.g. "Round 1 · Thu 13:00–19:30" or "Round 4 · today · last group tees off
// 19:40 · back nine from about 21:50", or while live "Round 3 · started 15:00". From level 1 the bot's
// codes replace the schedule words: "Round 3 · Quiet so far", "Round 4 · today · Tight at the top:
// tune in for the back nine, about 21:50".
export function roundLine(e, fmt, now = Date.now(), level = 0) {
  const r = e.rounds?.find((x) => x.n === e.round);
  if (!r) return '';
  const head = `Round ${r.n}`;
  if (e.status === 'live' && level >= 1 && HEAT_TEXT[e.heat]) return `${head} · ${HEAT_TEXT[e.heat]}`;
  if (e.status !== 'live' && level >= 1 && OUTLOOK_TEXT[e.outlook]) {
    const when = r.first ? (fmt.isToday(r.first) ? 'today' : fmt.day(r.first)) : fmt.isToday(roundStart(r)) ? 'today' : fmt.day(roundStart(r));
    const bn = r.first && e.outlook !== 'clear' ? fmt.time(backNineAt(r)) : '';
    const tail = !bn ? '' : e.outlook === 'open' ? ` · back nine from about ${bn}` : `, about ${bn}`;
    return `${head} · ${when} · ${OUTLOOK_TEXT[e.outlook]}${tail}`;
  }
  if (e.status === 'live') {
    const bn = backNineAt(r);
    if (bn && now >= Date.parse(bn)) return `${head} · the last group is on the back nine`;
    return r.first ? `${head} · started ${fmt.time(r.first)}` : head;
  }
  const at = roundStart(r);
  if (!r.first) return `${head} · ${fmt.isToday(at) ? 'today' : fmt.day(at)} · tee times not out yet`;
  if (fmt.isToday(r.first)) return `${head} · today · last group tees off ${fmt.time(r.last)} · back nine from about ${fmt.time(backNineAt(r))}`;
  return `${head} · ${fmt.day(r.first)} ${fmt.time(r.first)}–${fmt.time(r.last)}`;
}

// Favorite golfers in the field, with their tee time when it's public at every level: rounds 1 and 2
// are drawn before the tournament, so they say nothing about the scores. Weekend tee times follow
// the scores (the leaders go out last), so they're level 2 and come from the leaderboard instead.
//   -> [{ name, text: "★ Viktor Hovland tees off 14:10" }]
export function favoriteLines(e, favPlayers, fmt, now = Date.now()) {
  const mine = (e.field ?? []).filter((p) => favPlayers.includes(p));
  return mine.map((name) => {
    const tee = e.round <= 2 ? e.tees?.[name]?.[e.round - 1] : null;
    const text = !tee ? 'in the field' : Date.parse(tee) > now ? `tees off ${fmt.time(tee)}` : `teed off ${fmt.time(tee)}`;
    return { name, text };
  });
}

// ── How tense it is (level 1): codes only, never a name or a position ──────────
// The bot publishes these in events.json (the owner agreed, like football's live number): `heat`
// (0–3) while a round is live, `outlook` before rounds 3 and 4. The page shows them at level 1 and up.
export const HEAT_TEXT = ['Quiet so far', 'Something brewing', 'Heating up now: several players still in it', 'Red hot: a close finish, watch now'];
export const HEAT_SHORT = ['Quiet so far', 'Something brewing', 'Heating up', 'Red hot'];
export const OUTLOOKS = ['tight', 'open', 'few', 'clear'];
export const OUTLOOK_TEXT = {
  tight: 'Tight at the top: tune in for the back nine',
  open: 'Wide open: many players still in it',
  few: 'A few players in it: watch the back nine',
  clear: 'One player well clear: highlights may do',
};
// The most a round can reach: rounds 1 and 2 are about the cut, not the title (the owner: "capped low").
export const HEAT_CAP = { 1: 1, 2: 1, 3: 2, 4: 3 };
// A level is held for this long before it may drop (no flicker between two levels).
export const HOLD_MIN = 15;

// The weights (`w`) are GOLF_LIVE in src/scoring/weights.mjs; only the bot works the heat out.
const active = (players) => players.filter((p) => !['cut', 'wd', 'dq'].includes(p.status) && Number.isFinite(p.toPar));
const holesLeft = (p, round) => Math.max(0, (ROUNDS - round) * 18 + 18 - (p.thru ?? 0));

// The chase right now. Each chaser counts 0–1 by how many shots behind the leader they are, against
// the holes both still have to play (2 back with a round to go is a real chase; 2 back on the last
// hole is nearly over). The closest chaser counts fully, the next half, the next a quarter…
// `late`: how far the leaders are into the round (0 at their first tee shot, 1 when they finish).
export function chaseOf(players, round, w) {
  const field = active(players);
  if (field.length < 2) return { chase: 0, late: 0 };
  const best = Math.min(...field.map((p) => p.toPar));
  const leader = field.filter((p) => p.toPar === best).sort((a, b) => holesLeft(b, round) - holesLeft(a, round))[0];
  const leaderLeft = holesLeft(leader, round);
  const chasers = field.filter((p) => p !== leader)
    .map((p) => Math.max(0, 1 - (p.toPar - best) / (w.reachEnd + w.reachPerHole * (holesLeft(p, round) + leaderLeft))))
    .sort((a, b) => b - a);
  const chase = chasers.reduce((sum, x, k) => sum + x * w.nextChaser ** k, 0);
  const late = 1 - Math.min(18, Math.max(0, leaderLeft - (ROUNDS - round) * 18)) / 18;
  return { chase, late };
}

// Heat 0–3 for a live round, from the leaderboard right now: the chase, counting more as the leaders
// get further into the round. "Red hot" needs the leaders past about the turn. Capped per round.
export function heatOf(players, round, w) {
  const { chase, late } = chaseOf(players, round, w);
  const h = chase * (w.lateFrom + (1 - w.lateFrom) * late);
  const heat = h >= w.heat3 && late >= w.hotFrom ? 3 : h >= w.heat2 ? 2 : h >= w.heat1 ? 1 : 0;
  return Math.min(heat, HEAT_CAP[round] ?? 3);
}

// The outlook before round 3 or 4, from the leaderboard after the round before (everyone has
// finished it): 2nd place 4+ shots back is "clear", 1 or level "tight", else 6 or more within 3
// shots is "open", otherwise "few".
export function outlookOf(players, nextRound) {
  if (nextRound < 3) return null; // after round 1 it says nothing yet
  const field = active(players).map((p) => p.toPar).sort((a, b) => a - b);
  if (field.length < 2) return null;
  const [best, second] = field;
  const within = (k) => field.filter((x) => x - best <= k).length;
  if (second - best >= 4) return 'clear';
  if (second - best <= 1) return 'tight';
  if (within(3) >= 6) return 'open';
  return 'few';
}

// The heat as published: it may rise at once, but drops only after it has been lower for HOLD_MIN
// minutes. prev: { heat, at } (at: when that level was last seen, ms) or null.
export function holdHeat(prev, heat, now = Date.now()) {
  if (!prev || heat >= prev.heat) return { heat, at: now };
  if (now - prev.at < HOLD_MIN * 60e3) return prev;
  return { heat, at: now };
}
