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
// 19:40 · back nine from about 21:50", or while live "Round 3 · started 15:00".
export function roundLine(e, fmt, now = Date.now()) {
  const r = e.rounds?.find((x) => x.n === e.round);
  if (!r) return '';
  const head = `Round ${r.n}`;
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
