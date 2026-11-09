// League tables for the Team view: docs/data/standings.json, { [compKey]: publishStandings(...) }.
// The full build refreshes every table (every ~3 hours). In between, the live check refreshes
// just the table of a competition that had a match finish, and keeps asking ESPN (once per run,
// every 5 minutes) until that table shows the match, since ESPN can take a while after full-time.
//
// state.tablesPending: { [match id]: { comp, teams: [home, away], played: [n | null, n | null], at } }
//   played: each team's games played in the published table when the match finished.

import { teamSlug, TABLE_COMPS } from '../docs/logic.js';
import { LEAGUE_PHASE } from './prematch.mjs';
import { publishStandings } from './publish.mjs';

// The competitions with a table (docs/logic.js, shared with the page). Tournaments (EURO,
// World Cup) are left out, like for "what's at stake" (test: the same set as STAKES_COMPS).
export { TABLE_COMPS };
const GIVE_UP_MS = 3 * 3600e3; // stop waiting for ESPN 3 hours after full-time; the full build catches up

// The group a team is in, matched by its exact name, else by its slug ("VIKING FK" = "Viking FK").
export function rowOf(table, team) {
  for (const g of table?.groups ?? []) {
    const r = g.rows.find((x) => x.team === team) ?? g.rows.find((x) => teamSlug(x.team) === teamSlug(team));
    if (r) return { group: g, row: r };
  }
  return null;
}

// A match in a table competition just finished: remember to refresh that table. Not for a match
// whose teams have already played the whole table (a knockout tie after the league phase).
export function noteFinished(state, standings, { id, comp, teams }, now = new Date()) {
  if (!TABLE_COMPS.has(comp)) return;
  const table = standings.get(comp);
  const found = teams.map((t) => rowOf(table, t));
  const total = (f) => LEAGUE_PHASE[comp] ?? 2 * (f.group.rows.length - 1);
  if (found.every((f) => f && f.row.played >= total(f))) return;
  state.tablesPending ??= {};
  state.tablesPending[id] = { comp, teams, played: found.map((f) => f?.row.played ?? null), at: now.toISOString() };
}

// The table shows the match: both teams have played more games than before (or we couldn't tell before).
const counted = (table, p) => p.teams.every((t, i) => {
  if (p.played[i] == null) return true; // not in the table before: one refresh is all we can do
  const r = rowOf(table, t)?.row;
  return Boolean(r) && r.played > p.played[i];
});

// Refreshes the tables in `comps` (default: those with a match waiting). fetchStandings(compKey)
// -> { season, groups }. A failed request keeps the old table. Returns true when a table's
// content changed (the "updated" time alone doesn't count, so a quiet re-check publishes nothing).
export async function refreshStandings(state, standings, fetchStandings, { comps, now = new Date(), warn = console.warn } = {}) {
  const pending = state.tablesPending ?? {};
  const wanted = comps ?? new Set(Object.values(pending).map((p) => p.comp));
  let changed = false;
  for (const comp of wanted) {
    if (!TABLE_COMPS.has(comp)) continue;
    try {
      const fresh = publishStandings(await fetchStandings(comp), now);
      if (!fresh.groups.length) continue; // ESPN had nothing: keep the old table
      const old = standings.get(comp);
      if (!old || JSON.stringify([old.season, old.groups]) !== JSON.stringify([fresh.season, fresh.groups])) changed = true;
      standings.set(comp, fresh);
    } catch (err) {
      warn(`standings ${comp}: ${err.message}`);
    }
  }
  for (const [id, p] of Object.entries(pending)) {
    const expired = now - new Date(p.at) > GIVE_UP_MS;
    if (expired || (wanted.has(p.comp) && standings.has(p.comp) && counted(standings.get(p.comp), p))) delete pending[id];
  }
  if (state.tablesPending && !Object.keys(state.tablesPending).length) delete state.tablesPending;
  return changed;
}
