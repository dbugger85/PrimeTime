// Exports every match PrimeTime knows about, with all its data points and
// where each came from, for analysis outside the app (spreadsheets, other LLMs).
// Writes export/ (git-ignored, it's full of results):
//   primetime-events.jsonl  one event per line, all sports, nested and self-describing
//   primetime-events.json   the same records as one JSON array
//   football.csv            one football match per row, flat columns
//   README.md               what every field means and its source
//   primetime-data.zip      all of the above (needs the zip command)
// It also writes the public download page docs/dataset/index.html (primetime.re/dataset)
// from scripts/dataset-page.html. The files themselves go on a GitHub release
// (the page links to releases/latest), see "Research dataset" in CLAUDE.md.
// Events that have dropped out of docs/data (football after 30 days) are
// recovered from the git history of the data files.
// Usage: npm run export

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { STAKES } from '../docs/scoring.js';

const OUT = 'export';
const FILES = ['events', 'reasons', 'results', 'facts'];

const SRC = {
  espnScoreboard: 'ESPN scoreboard API (site.api.espn.com/apis/site/v2/sports/soccer/{comp}/scoreboard)',
  espnSummary: 'ESPN match summary API (site.api.espn.com/.../summary?event=ID)',
  espnKeyEvents: 'ESPN match summary API: keyEvents (goals, cards, penalties, substitutions)',
  espnCommentary: 'ESPN match summary API: commentary (every shot, VAR, woodwork)',
  espnBoxscore: 'ESPN match summary API: boxscore (team totals)',
  espnOdds: 'ESPN match summary API: pickcenter (DraftKings pre-match moneylines), turned into probabilities by PrimeTime',
  espnRosters: 'ESPN match summary API: rosters',
  espnStandings: 'ESPN standings API (league table at kick-off), judged by PrimeTime (src/prematch.mjs)',
  fotmob: 'FotMob matchDetails API (www.fotmob.com/api/data/matchDetails): shot map and team stats',
  elo: 'Club Elo (clubelo.com) for clubs, World Football Elo (eloratings.net) for national teams',
  strength: 'PrimeTime (src/sources/ratings.mjs) from Elo plus league table points per game',
  espnTennis: 'ESPN tennis scoreboard API (site.api.espn.com/.../tennis/atp/scoreboard)',
  openf1: 'OpenF1 API (api.openf1.org/v1): sessions, results, overtakes, race control, positions, laps, pit, weather',
  ibu: 'IBU results API (biathlonresults.com/modules/sportapi/api)',
  fis: 'FIS results web pages (fis-ski.com/DB/general)',
  primetime: 'Computed by PrimeTime (src/scoring/*.mjs, weights in src/scoring/weights.mjs)',
  rights: 'PrimeTime streaming rights list (src/rights/norway.json)',
};

const SPORT_SRC = { football: SRC.espnScoreboard, tennis: SRC.espnTennis, f1: SRC.openf1 };
const winterSrc = (comp) => (comp === 'biathlon' ? SRC.ibu : SRC.fis);

const TIMELINE = {
  football: '15-minute blocks of the match (extra time adds blocks)',
  tennis: 'one value per set',
  f1: 'equal chunks of the race laps',
  winter: 'one value per run, leg or shooting stage',
};

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 256 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const readNow = (f) => { try { return JSON.parse(readFileSync(`docs/data/${f}.json`, 'utf8')); } catch { return null; } };
const readAt = (c, f) => { try { return JSON.parse(git('show', `${c}:docs/data/${f}.json`)); } catch { return null; } };

// Collects the newest copy of every event: first the live files, then older
// commits (every 10th is plenty, since football stays in the files for 30 days).
function collect() {
  const byId = new Map();
  const take = (data, commit) => {
    if (!data.events) return;
    for (const ev of data.events.events) {
      if (byId.has(ev.id)) continue;
      byId.set(ev.id, {
        ev, commit,
        reasons: data.reasons?.[ev.id] ?? null,
        result: data.results?.[ev.id] ?? null,
        facts: data.facts?.[ev.id] ?? null,
        elo: data.events.elo ?? {},
      });
    }
  };
  take(Object.fromEntries(FILES.map((f) => [f, readNow(f)])), null);
  const commits = git('log', '--format=%h', '--', 'docs/data/events.json').trim().split('\n');
  for (const [i, c] of commits.entries()) {
    if (i % 10) continue;
    take(Object.fromEntries(FILES.map((f) => [f, readAt(c, f)])), c);
  }
  return [...byId.values()];
}

// "A 2–1 B (after extra time)" → { home: 2, away: 1 }
function footballScore(text) {
  const m = /\s(\d+)[–-](\d+)\s/.exec(text ?? '');
  return m ? { home: +m[1], away: +m[2] } : null;
}

// "X beat Y 6-3 7-6(2) 5-7" → [[6,3],[7,6],[5,7]] from the winner's side
function tennisSets(text) {
  return [...(text ?? '').matchAll(/(\d+)-(\d+)(?:\((\d+)\))?/g)].map((m) => [+m[1], +m[2]]);
}

function record({ ev, commit, reasons, result, facts, elo }) {
  const sources = {
    id: SPORT_SRC[ev.sport] ?? winterSrc(ev.comp),
    start: SPORT_SRC[ev.sport] ?? winterSrc(ev.comp),
    'primetime.*': SRC.primetime,
    services: SRC.rights,
  };
  const r = {
    id: ev.id,
    sport: ev.sport,
    competition: { code: ev.comp, name: ev.compName },
    start: ev.start,
  };
  if (ev.sport === 'football') {
    r.teams = { home: ev.teams[0], away: ev.teams[1] };
    const text = typeof result === 'object' && result ? result.text : result;
    r.result = text ? {
      text, score: footballScore(text),
      goals: result.goals ?? [], substitutions: result.subs ?? [],
    } : null;
    sources['teams'] = SRC.espnScoreboard;
    sources['result.*'] = SRC.espnKeyEvents;
    const eh = elo[ev.teams[0]], ea = elo[ev.teams[1]];
    r.elo = eh || ea ? { home: eh ?? null, away: ea ?? null } : null;
    if (r.elo) sources['elo'] = `${SRC.elo} (latest rating when exported, not at kick-off)`;
    if (ev.stakes) { r.stakes = { code: ev.stakes, label: STAKES[ev.stakes] }; sources['stakes'] = SRC.espnStandings; }
    if (ev.lineups) { r.lineups = ev.lineups; sources['lineups'] = SRC.espnRosters; }
    if (facts) {
      r.facts = facts;
      Object.assign(sources, {
        'facts.goals': SRC.espnKeyEvents,
        'facts.odds': SRC.espnOdds,
        'facts.reds': SRC.espnKeyEvents,
        'facts.pens': SRC.espnKeyEvents,
        'facts.disallowed': SRC.espnCommentary,
        'facts.woodwork': SRC.espnCommentary,
        'facts.corners': SRC.espnBoxscore,
        'facts.yellows': SRC.espnKeyEvents,
        'facts.shotsOnTarget': SRC.espnBoxscore,
        'facts.totalShots': SRC.espnBoxscore,
        'facts.shotsBy': SRC.espnCommentary,
        'facts.extraTime': SRC.espnSummary,
        'facts.shootout': SRC.espnSummary,
        'facts.shootoutWinner': SRC.espnSummary,
        'facts.xg': SRC.fotmob,
        'facts.stats': SRC.fotmob,
        'facts.strength': SRC.strength,
        ...(facts.redsBy ? { 'facts.redsBy': SRC.espnKeyEvents } : {}),
        ...(facts.stoppage ? { 'facts.stoppage': SRC.espnCommentary } : {}),
        ...(facts.passes ? { 'facts.passes': SRC.espnBoxscore } : {}),
        ...(facts.bangers ? { 'facts.bangers': SRC.fotmob } : {}),
        ...(facts.bigMisses ? { 'facts.bigMisses': SRC.fotmob } : {}),
        ...(facts.stakes ? { 'facts.stakes': SRC.espnStandings } : {}),
      });
    }
    if (ev.limited) r.limitedInfo = 'no xG from FotMob; scored from shot counts';
  } else if (ev.sport === 'tennis') {
    r.players = ev.players;
    r.draw = ev.draw;
    r.round = ev.round;
    r.result = result ? { text: result, sets: tennisSets(result) } : null;
    sources['players, draw, round, result.*'] = SRC.espnTennis;
  } else if (ev.sport === 'f1') {
    r.circuit = ev.circuit;
    r.session = ev.session ?? 'race';
    r.result = result ? { text: result } : null;
    sources['circuit, session, result.*'] = SRC.openf1;
  } else {
    Object.assign(r, { race: ev.race, place: ev.place, series: ev.series, gender: ev.gender });
    r.result = result ? { text: result } : null;
    sources['race, place, series, gender, result.*'] = winterSrc(ev.comp);
  }
  r.primetime = {
    score: ev.score,
    scoringVersion: ev.v,
    timeline: { meaning: `heat 0 (nothing) to 3 (the hottest part of this event), ${TIMELINE[ev.sport]}`, values: ev.segments },
    skip: ev.advice,
    breakdown: (reasons ?? []).map(([points, label, pillar]) => ({ points, label, ...(pillar ? { pillar } : {}) })), // pillar: football since version 19
  };
  r.services = ev.services;
  r.recoveredFromGitHistory = commit ? { commit, note: 'no longer in the live files; scored with the formula of that time' } : false;
  r.sources = sources;
  return r;
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const pairCols = (name, p) => ({ [`${name}_home`]: p?.home, [`${name}_away`]: p?.away });
const mins = (a) => (a ?? []).map((m) => Math.round(m)).join(';');

function footballRow(r) {
  const f = r.facts ?? {};
  const goals = f.goals ?? [];
  return {
    id: r.id, start: r.start, competition: r.competition.name,
    home: r.teams.home, away: r.teams.away,
    goals_home: r.result?.score?.home, goals_away: r.result?.score?.away,
    result: r.result?.text,
    primetime_score: r.primetime.score, scoring_version: r.primetime.scoringVersion,
    timeline_15min: r.primetime.timeline.values.join(';'),
    skip_minutes: (r.primetime.skip?.ranges ?? []).map(([a, b]) => `${a}-${b}`).join(';'),
    has_facts: !!r.facts,
    goal_minutes_home: mins(goals.filter((g) => g.side === 'home').map((g) => g.min)),
    goal_minutes_away: mins(goals.filter((g) => g.side === 'away').map((g) => g.min)),
    penalty_goals: goals.filter((g) => g.pen).length, own_goals: goals.filter((g) => g.own).length,
    odds_home: f.odds?.home, odds_draw: f.odds?.draw, odds_away: f.odds?.away,
    red_card_minutes: mins(f.reds), penalty_minutes: mins(f.pens),
    var_disallowed_minutes: mins(f.disallowed), woodwork_minutes: mins(f.woodwork),
    corners: f.corners, yellows: f.yellows, shots_on_target: f.shotsOnTarget, total_shots: f.totalShots,
    ...pairCols('shots', f.shotsBy), ...pairCols('xg', f.xg),
    ...pairCols('big_chances', f.stats?.bigChances), ...pairCols('xgot', f.stats?.xgot),
    ...pairCols('box_touches', f.stats?.touchesInBox),
    ...pairCols('strength', f.strength), ...pairCols('elo', r.elo),
    extra_time: f.extraTime, shootout: f.shootout, shootout_winner: f.shootoutWinner,
    stakes: r.stakes?.code ?? f.stakes,
    breakdown: r.primetime.breakdown.map((b) => `${b.points > 0 ? '+' : ''}${b.points} ${b.label}`).join(' | '),
    recovered_from_history: !!r.recoveredFromGitHistory,
  };
}

const records = collect().map(record).sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/primetime-events.jsonl`, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
writeFileSync(`${OUT}/primetime-events.json`, JSON.stringify(records));

const rows = records.filter((r) => r.sport === 'football').map(footballRow);
const cols = Object.keys(rows[0] ?? {});
writeFileSync(`${OUT}/football.csv`, [cols.join(','), ...rows.map((row) => cols.map((c) => csvCell(row[c])).join(','))].join('\n') + '\n');

const count = (pred) => records.filter(pred).length;
const sports = ['football', 'tennis', 'f1', 'winter'].map((s) => `${s} ${count((r) => r.sport === s)}`).join(', ');
const template = readFileSync('scripts/export-readme.md', 'utf8');
writeFileSync(`${OUT}/README.md`, template
  .replace('{{generated}}', new Date().toISOString())
  .replace('{{counts}}', `${records.length} events (${sports}); ${count((r) => r.facts)} football matches with full facts; ${count((r) => r.recoveredFromGitHistory)} recovered from git history`)
  .replace('{{sources}}', Object.entries(SRC).map(([k, v]) => `- \`${k}\`: ${v}`).join('\n')));

const ZIPPED = ['README.md', 'primetime-events.jsonl', 'primetime-events.json', 'football.csv'];
rmSync(`${OUT}/primetime-data.zip`, { force: true });
execFileSync('zip', ['-q', '-9', 'primetime-data.zip', ...ZIPPED], { cwd: OUT });

// The public page: counts, date ranges, file sizes and one example record.
const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const ofSport = (s) => records.filter((r) => r.sport === s);
const range = (rs) => { const d = rs.map((r) => Date.parse(r.start)).sort((a, b) => a - b); return `${fmtDate(d[0])} to ${fmtDate(d.at(-1))}`; };
const size = (f) => { const b = statSync(`${OUT}/${f}`).size; return b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`; };
const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
const ex = structuredClone(records.find((r) => r.sport === 'football' && r.facts && r.lineups) ?? records[0]);
if (ex.lineups) ex.lineups = [{ ...ex.lineups[0], players: [...ex.lineups[0].players.slice(0, 2), ['…']], bench: [['…']] }, '…'];
if (ex.result?.substitutions?.length) ex.result.substitutions = [ex.result.substitutions[0], '…'];
const fill = {
  BASE: 'https://github.com/dbugger85/PrimeTime/releases/latest/download/',
  TOTAL: records.length.toLocaleString('en-US'), DATE: fmtDate(Date.now()),
  SIZE_ZIP: size('primetime-data.zip'), SIZE_README: size('README.md'), SIZE_JSON: size('primetime-events.json'),
  SIZE_JSONL: size('primetime-events.jsonl'), SIZE_CSV: size('football.csv'), CSV_COLS: cols.length,
  N_FB: ofSport('football').length, N_TN: ofSport('tennis').length.toLocaleString('en-US'),
  N_F1: ofSport('f1').length, N_WI: ofSport('winter').length,
  R_FB: range(ofSport('football')), R_TN: range(ofSport('tennis')), R_F1: range(ofSport('f1')), R_WI: range(ofSport('winter')),
  C_FB: [...new Set(ofSport('football').map((r) => r.competition.name))].join(', '),
  N_FACTS: count((r) => r.facts), N_REC: count((r) => r.recoveredFromGitHistory),
  EX_TITLE: esc(ex.result?.text ?? ex.id), EXAMPLE: esc(JSON.stringify(ex, null, 2)),
};
let page = readFileSync('scripts/dataset-page.html', 'utf8');
for (const [k, v] of Object.entries(fill)) page = page.replaceAll(`{{${k}}}`, String(v));
if (page.includes('{{')) throw new Error('dataset page: unfilled placeholder');
mkdirSync('docs/dataset', { recursive: true });
writeFileSync('docs/dataset/index.html', page);

console.log(`Wrote ${OUT}/: ${records.length} events (${sports}), ${rows.length} football rows, and docs/dataset/index.html`);
