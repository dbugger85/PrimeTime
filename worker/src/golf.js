// Golf notifications: a bell on a golf card follows the whole tournament, so one row sends several
// pushes (the owner chose the wording, see PLAN.md "Golf plan"):
//   "Round 3 is starting"                         every round, at its first tee time
//   "The last group is reaching the back nine"     rounds 3 and 4, last tee time + 2 h 10
//   "<Tournament>: tight at the top, good time to tune in"   once, when round 4 turns red hot (level 1+)
//   "<Golfer> is in contention"                    your followed golfers on the weekend (level 2+ only)
// Pure: works out what's due from the site's events.json card and golf.json, and when to look next.
// The row keeps which ones were sent (`sent`), so nothing is sent twice.

import { playerState, BACK_NINE_MIN } from '../../docs/golf.js';

export const EARLY = 30e3; // up to 30 s early (the check runs once a minute)
export const TOO_LATE = 3 * 3600e3; // a round start missed by over 3 hours (the helper was down) isn't sent
export const LIVE_EVERY = 5 * 60e3; // while a round is on, look every 5 minutes (the bot's own rhythm)
export const IDLE_EVERY = 60 * 60e3; // otherwise at the next known time, and at least every hour (new tee times)

// The timed alerts of a card: [{ key, at, body }].
export function timedAlerts(e) {
  const out = [];
  for (const r of e.rounds ?? []) {
    if (!r.first) continue;
    out.push({ key: `r${r.n}`, at: Date.parse(r.first), body: `Round ${r.n} is starting` });
    if (r.n >= 3 && r.last) out.push({ key: `b${r.n}`, at: Date.parse(r.last) + BACK_NINE_MIN * 60e3, body: 'The last group is reaching the back nine' });
  }
  return out.filter((a) => Number.isFinite(a.at));
}

// Those already in the past when a phone bells mid-tournament (not sent then).
export const pastKeys = (e, now) => timedAlerts(e).filter((a) => a.at < now - EARLY).map((a) => a.key);

// row: { title (the tournament), body (where to watch), level (0–3), players [names], sent [keys] }.
// e: the card in events.json's `upcoming`; file: golf.json (or null). -> { alerts: [{ key, title, body }], sent, next }
export function golfDue(e, row, now, file = null) {
  const sent = new Set(row.sent ?? []);
  const alerts = [];
  const where = row.body ? ` · ${row.body}` : '';
  let next = now + IDLE_EVERY;
  for (const a of timedAlerts(e)) {
    if (sent.has(a.key)) continue;
    if (now >= a.at - EARLY) {
      sent.add(a.key);
      if (now - a.at <= TOO_LATE) alerts.push({ key: a.key, title: row.title, body: `${a.body}${where}` });
    } else next = Math.min(next, a.at);
  }
  const live = e.status === 'live';
  if (live && (row.level ?? 0) >= 1 && e.round === 4 && e.heat === 3 && !sent.has('hot')) {
    sent.add('hot');
    alerts.push({ key: 'hot', title: `${row.title}: tight at the top, good time to tune in`, body: row.body || 'Live now' });
  }
  const t = file?.[e.id]?.t;
  if (live && (row.level ?? 0) >= 2 && e.round >= 3 && t) {
    for (const name of row.players ?? []) {
      const key = `c${e.round}:${name}`;
      if (sent.has(key) || playerState(t, name, e.round)?.status !== 'contention') continue;
      sent.add(key);
      alerts.push({ key, title: `${name} is in contention`, body: `${row.title} · round ${e.round}${where}` });
    }
  }
  if (live) next = Math.min(next, now + LIVE_EVERY);
  return { alerts, sent: [...sent], next };
}
