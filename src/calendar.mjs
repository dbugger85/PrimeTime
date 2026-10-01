// Calendar feeds: one .ics file per football team in docs/cal/, which a phone can
// subscribe to (webcal://…/cal/bodo-glimt.ics). Each has the team's matches from the
// last 30 days and the next 14, with kick-off and where to watch. No scores, ever.
// The output only changes when a match changes, so git doesn't see a new file every run.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { teamSlug, STAKES_LABELS } from '../docs/logic.js';

const rights = JSON.parse(readFileSync(new URL('./rights/norway.json', import.meta.url)));
const SITE = 'https://dbugger85.github.io/PrimeTime/';
const KEEP_TEAM_DAYS = 120; // a team's feed stays (maybe empty) this long after its last match, e.g. between international breaks

// "2026-10-09T17:00Z" -> "20261009T170000Z"
const icsTime = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');

// Lines longer than 75 bytes are folded: continued on the next line after a space.
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const serviceNames = (ids) => ids.map((id) => rights.services[id]?.name ?? id).join(', ');

export function icsForTeam(team, matches) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PrimeTime//Football//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${team} (PrimeTime)`)}`, 'X-WR-TIMEZONE:Europe/Oslo',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of [...matches].sort((a, b) => a.start.localeCompare(b.start))) {
    const start = Date.parse(e.start);
    const where = serviceNames(e.services);
    const about = [e.compName, STAKES_LABELS[e.stakes]].filter(Boolean).join(' · ');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@primetime`,
      `DTSTAMP:${icsTime(start)}`, // fixed, so the file doesn't change every run
      `DTSTART:${icsTime(start)}`,
      `DTEND:${icsTime(start + 2 * 3600e3)}`,
      `SUMMARY:${esc(e.teams.join(' – '))}`,
      ...(where ? [`LOCATION:${esc(where)}`] : []),
      `DESCRIPTION:${esc([about, where && `Watch on ${where}`, SITE].filter(Boolean).join('\n'))}`,
      `URL:${SITE}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Writes docs/cal/<team>.ics for every team seen in the last KEEP_TEAM_DAYS days
// (remembered in state.calTeams), and removes feeds of teams not seen for longer.
export function writeCalendars(dir, events, upcoming, state, now = new Date()) {
  const football = [...events, ...upcoming].filter((e) => e.sport === 'football');
  const byTeam = new Map();
  for (const e of football) {
    for (const team of e.teams) {
      const slug = teamSlug(team);
      if (!byTeam.has(slug)) byTeam.set(slug, { team, matches: [] });
      byTeam.get(slug).matches.push(e);
    }
  }
  state.calTeams ??= {};
  const today = now.toISOString().slice(0, 10);
  for (const [slug, { team }] of byTeam) state.calTeams[slug] = { team, seen: today };
  const oldest = new Date(now.getTime() - KEEP_TEAM_DAYS * 864e5).toISOString().slice(0, 10);
  for (const [slug, t] of Object.entries(state.calTeams)) if (t.seen < oldest) delete state.calTeams[slug];

  mkdirSync(dir, { recursive: true });
  for (const [slug, { team }] of Object.entries(state.calTeams)) {
    writeFileSync(new URL(`${slug}.ics`, dir), icsForTeam(team, byTeam.get(slug)?.matches ?? []));
  }
  for (const file of readdirSync(dir)) {
    if (file.endsWith('.ics') && !(file.slice(0, -4) in state.calTeams)) unlinkSync(new URL(file, dir));
  }
  return Object.keys(state.calTeams).length;
}
