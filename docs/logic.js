// Pure helpers for the page (no DOM), so they can be unit-tested with node --test.

export const SPORTS = { football: 'Football', tennis: 'Tennis', f1: 'F1' };

export function tierOf(score) {
  if (score >= 8) return { key: 'must', label: 'Must-watch' };
  if (score >= 6) return { key: 'good', label: 'Good' };
  if (score >= 4) return { key: 'decent', label: 'Decent' };
  return { key: 'skip', label: 'Skip it' };
}

export function adviceText(a) {
  switch (a?.code) {
    case 'full': return 'Watch it all';
    case 'highlights': return 'Highlights are enough';
    case 'from': return a.min === 45 ? 'Skip the first half' : `Start from ${a.min}'`;
    case 'fromSet': return `Start from set ${a.set}`;
    case 'startThen': return `Watch the start, then skip to lap ${a.lap}`;
    default: return '';
  }
}

const LATE_ROUNDS = {
  r3: ['Round 3', 'Round 4', 'Quarterfinal', 'Semifinal', 'Final'],
  qf: ['Quarterfinal', 'Semifinal', 'Final'],
};

// prefs: { sport, services[], comp, days, minScore, sort, round, draw, hideWatched }
export function filterEvents(events, prefs, watched = new Set(), now = Date.now()) {
  const list = events.filter((e) => {
    if (prefs.sport !== 'all' && e.sport !== prefs.sport) return false;
    if (prefs.services?.length && !e.services.some((s) => prefs.services.includes(s))) return false;
    if (prefs.comp && prefs.comp !== 'all' && e.compName !== prefs.comp) return false;
    if (prefs.days && now - Date.parse(e.start) > prefs.days * 864e5) return false;
    if (prefs.minScore && e.score < prefs.minScore) return false;
    if (prefs.hideWatched && watched.has(e.id)) return false;
    if (e.sport === 'tennis') {
      if (prefs.round && LATE_ROUNDS[prefs.round] && !LATE_ROUNDS[prefs.round].includes(e.round)) return false;
      if (prefs.draw === 'men' && !/^men/i.test(e.draw)) return false;
      if (prefs.draw === 'women' && !/^women/i.test(e.draw)) return false;
    }
    return true;
  });
  return prefs.sort === 'score'
    ? list.sort((a, b) => b.score - a.score || b.start.localeCompare(a.start))
    : list.sort((a, b) => b.start.localeCompare(a.start));
}

export function namesHidden(event, setting) {
  if (event.sport === 'f1') return false; // a race name gives nothing away
  return setting === 'all' || (setting === 'tennis' && event.sport === 'tennis');
}

export function titleOf(event) {
  if (event.sport === 'football') return event.teams.join(' – ');
  if (event.sport === 'tennis') return event.players.join(' vs ');
  return event.compName;
}

export function subtitleOf(event) {
  if (event.sport === 'football') return event.compName;
  if (event.sport === 'tennis') return `${event.compName} · ${event.draw} · ${event.round}`;
  return `Formula 1 · ${event.circuit}`;
}

export function hiddenTitleOf(event) {
  return event.sport === 'tennis' ? 'Players hidden' : 'Teams hidden';
}
