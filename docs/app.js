import { SPORTS, migratePrefs, periodOptions, facets, activeFilters, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, filterEvents, namesHidden, titleOf, f1SessionName, favCount, toggleFav, favNames, searchNames, winterKey, winterLabel, encodeSettings, decodeSettings, subtitleOf, hiddenTitleOf, prematchLine, chancesLine, teamSlug } from './logic.js';
import { ESPN, clockOf, liveClockText, espnDays, liveFacts, scoreLivePace, LIVE_FROM, elapsedText } from './live.js';

const SERVICES = {
  viaplay: { name: 'Viaplay', url: 'https://viaplay.no/sport' },
  tv2play: { name: 'TV 2 Play', url: 'https://play.tv2.no/sport' },
  hbomax: { name: 'HBO Max', url: 'https://www.hbomax.com/no/no' },
  nrk: { name: 'NRK TV', url: 'https://tv.nrk.no/' },
  f1tv: { name: 'F1 TV', url: 'https://f1tv.formula1.com/' },
};

const DEFAULTS = {
  view: 'replays', sport: 'all', services: [], comp: 'all', days: 30, minScore: 0, sort: 'date',
  round: '', draw: '', f1Session: '', hideTennis: true, hideFootball: false, hints: true, preHints: true, showElo: false, showChances: false, hideWatched: false, glass: true,
  favsOnly: false, favs: { teams: [], players: [], f1: false, winter: [] }, gender: '',
};

const store = {
  load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const prefs = { ...DEFAULTS, ...migratePrefs(store.load('pt-prefs', {})) };
prefs.favs = { ...DEFAULTS.favs, ...prefs.favs };
const watched = new Set(store.load('pt-watched', []));
const revealed = new Set(); // names revealed this visit only
const whyShown = new Set(); // "Why this score?" opened this visit only
let reasonsFile = null; // loaded only after the spoiler warning is accepted
const resultShown = new Set(); // results revealed this visit only (after a second warning)
const lineupsOpen = new Set(); // football line-ups opened this visit only
const subsOpen = new Set(); // substitution lists opened (inside a shown result) this visit only
let calOpen = false; // "Add favorites to calendar" opened this visit
const benchOpen = new Set(); // benches opened this visit only, as "<event id>:<team index>"
let resultsFile = null; // loaded only after the second warning is accepted
let events = [];
let upcoming = [];
let eloRatings = {}; // the latest Elo per football team, for "Show Elo ratings"
let liveWeights = null; // the weights for "Excitement so far" (from events.json)
const paceOpen = new Set(); // "Excitement so far" opened this visit only
const paceNow = new Map(); // id -> { pace, rough } | { early: true } | { failed: true }, worked out here from ESPN
const freshClock = new Map(); // id -> the clock as the page last read it from ESPN, plus `seen` (this device's time)
const finished = new Set(); // live matches ESPN says are over, until the bot moves them to Replays
const redrawn = new Set(); // finished matches already redrawn without their button
const PAGE = 40;
let limit = PAGE; // cards shown; grows with "Show more"

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

// A new filter starts from the top; starring a favorite keeps your place ("Show more" stays).
// Streaming-service buttons for a card; the ones you have are highlighted. With a direct
// link (e.links, from TV 2 Play, Viaplay or NRK) the button goes straight to the match and
// gets a ▶; otherwise it opens the service's front page.
const servicePills = (e) => e.services.map((id) => {
  const direct = e.links?.[id];
  const a = Object.assign(document.createElement('a'), { href: direct ?? SERVICES[id].url, target: '_blank', rel: 'noopener', textContent: SERVICES[id].name });
  a.className = 'pill';
  if (direct) {
    a.append(Object.assign(document.createElement('span'), { className: 'go', textContent: '▶', ariaHidden: 'true' }));
    a.title = e.score != null ? 'Plays this match' : 'Opens this match';
  }
  if (prefs.services.includes(id)) a.classList.add('mine');
  return a;
});

// "Show more (n left)" under the list, when there are more cards than shown.
function moreButton(total) {
  $('.more')?.remove();
  if (total <= limit) return;
  const more = Object.assign(document.createElement('button'), { type: 'button', className: 'more' });
  more.textContent = `Show more (${total - limit} left)`;
  more.onclick = () => { limit += PAGE; render(); };
  $('#cards').after(more);
}

// A list whose lines are split at " · " into columns: "36' · 0–1 · Name (Team)".
function columnsList(lines, className) {
  const list = Object.assign(document.createElement('ul'), { className });
  for (const line of lines) {
    const li = document.createElement('li');
    li.append(...line.split(' · ').map((part) => Object.assign(document.createElement('span'), { textContent: part })));
    list.append(li);
  }
  return list;
}

function savePrefs({ keepPlace = false } = {}) {
  store.save('pt-prefs', prefs);
  if (!keepPlace) limit = PAGE;
}

const chip = (label, n, pressed, onclick) => {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'chip', onclick });
  b.append(label);
  if (n != null) b.append(Object.assign(document.createElement('span'), { className: 'n', textContent: n }));
  b.setAttribute('aria-pressed', String(pressed));
  return b;
};

function renderControls() {
  const view = prefs.view;
  for (const b of document.querySelectorAll('#views button')) b.setAttribute('aria-pressed', String(b.dataset.view === view));
  for (const b of document.querySelectorAll('#sports button')) b.setAttribute('aria-pressed', String(b.dataset.sport === prefs.sport));
  document.body.dataset.view = view;
  document.body.dataset.sport = prefs.sport;

  // Show only the settings that apply to this sport.
  for (const el of document.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(prefs.sport);

  // Period choices depend on how far back the sport is kept.
  const periods = periodOptions(prefs.sport);
  if (!periods.some((p) => p.days === prefs.days)) prefs.days = periods.at(-1).days;
  $('#f-days').replaceChildren(...periods.map((p) => new Option(p.label, p.days)));

  const pool = view === 'upcoming' ? upcoming : events;
  const f = facets(pool, prefs, view, watched);

  // Competition chips (football and tennis only).
  if (prefs.comp !== 'all' && !f.comps.some((c) => c.name === prefs.comp)) prefs.comp = 'all';
  const setComp = (name) => () => { prefs.comp = name; savePrefs(); render(); };
  $('#comps').hidden = f.comps.length < 2;
  $('#comps').replaceChildren(
    chip('All', null, prefs.comp === 'all', setComp('all')),
    ...f.comps.map((c) => chip(c.name, c.n, prefs.comp === c.name, setComp(c.name))),
  );

  // Service chips: only services that carry this sport (no counts, to save space).
  const shown = Object.keys(SERVICES).filter((id) => f.services.some((x) => x.id === id));
  $('#services').replaceChildren(...shown.map((id) => chip(
    SERVICES[id].name,
    null,
    prefs.services.includes(id),
    () => {
      prefs.services = prefs.services.includes(id) ? prefs.services.filter((x) => x !== id) : [...prefs.services, id];
      savePrefs();
      render();
    },
  )));
  const hiddenMine = prefs.services.filter((id) => !shown.includes(id));
  $('#services-hint').textContent = prefs.services.length && !prefs.services.some((id) => shown.includes(id)) && hiddenMine.length
    ? `none of yours show ${prefs.sport === 'all' ? 'these' : SPORTS[prefs.sport]}`
    : 'tap the ones you have';

  renderFavs();

  // Minimum rating, with how many events each choice leaves.
  $('#f-min').replaceChildren(...[0, 4, 6, 8].map((t) => new Option(`${t ? `${t}+` : 'Any'} (${f.minCounts[t]})`, t)));

  $('#f-days').value = String(prefs.days);
  $('#f-min').value = String(prefs.minScore);
  $('#f-sort').value = prefs.sort;
  $('#f-round').value = prefs.round;
  $('#f-draw').value = prefs.draw;
  $('#f-f1session').value = prefs.f1Session;
  $('#f-gender').value = prefs.gender;
  $('#f-hide-tn').checked = prefs.hideTennis;
  $('#f-hide-fb').checked = prefs.hideFootball;
  $('#f-hints').checked = prefs.hints;
  $('#f-prehints').checked = prefs.preHints;
  $('#f-elo').checked = prefs.showElo;
  $('#f-chances').checked = prefs.showChances;
  $('#f-watched').checked = prefs.hideWatched;
  $('#f-glass').checked = prefs.glass;
  document.body.classList.toggle('glass', prefs.glass); // the frosted look (style.css, end); some prefer it plain

  const active = activeFilters(prefs, view);
  $('#filter-count').hidden = !active;
  $('#filter-count').textContent = `${active} on`;
  $('#f-reset').hidden = !active;
}

const F1_NAME = 'F1 (every race)';

// Whether "My favorites" is unfolded. Remembered on this device; the first time,
// it's open when there are no favorites yet, so people find the search box.
let favsOpen = store.load('pt-favs-open', null) ?? !favCount(prefs.favs);

function setFav(kind, name) {
  prefs.favs = kind === 'f1' ? { ...prefs.favs, f1: !prefs.favs.f1 } : toggleFav(prefs.favs, kind, name);
  if (!favCount(prefs.favs)) prefs.favsOnly = false;
  savePrefs({ keepPlace: true });
  render();
}

// Calendar feeds for favorite teams: the bot writes docs/cal/<team>.ics (src/calendar.mjs).
// "Subscribe" opens the phone's calendar (webcal://); "Copy link" is for Google Calendar.
function renderCalendar(teams) {
  $('#cal').hidden = !teams.length;
  const btn = $('#cal-btn');
  btn.textContent = calOpen ? '▾ Add favorites to calendar' : '▸ Add favorites to calendar';
  btn.setAttribute('aria-expanded', String(calOpen));
  btn.onclick = () => { calOpen = !calOpen; renderCalendar(prefs.favs.teams); };
  $('#cal-body').hidden = !calOpen;
  if (!calOpen) return;
  $('#cal-links').replaceChildren(...teams.map((team) => {
    const url = new URL(`cal/${teamSlug(team)}.ics`, location.href);
    url.hash = '';
    url.search = '';
    const li = document.createElement('li');
    const sub = Object.assign(document.createElement('a'), { href: url.href.replace(/^https?:/, 'webcal:'), textContent: 'Subscribe', className: 'pill' });
    sub.hidden = /Android/i.test(navigator.userAgent); // Android has no webcal:// handler
    const copy = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Copy link', className: 'pill' });
    copy.onclick = async () => {
      try { await navigator.clipboard.writeText(url.href); copy.textContent = 'Copied ✓'; } catch { prompt('Copy this link:', url.href); }
    };
    li.append(Object.assign(document.createElement('span'), { className: 'cal-team', textContent: team }), sub, copy);
    return li;
  }));
}

// "My favorites": an "Only favorites" switch, one chip per favorite (tap to remove), and a search box.
function renderFavs() {
  const { favs } = prefs;
  const n = favCount(favs);
  const only = $('#fav-only');
  only.setAttribute('aria-pressed', String(prefs.favsOnly));
  only.disabled = !n;
  $('#favs-count').textContent = n ? String(n) : '';
  $('#favs-toggle').setAttribute('aria-expanded', String(favsOpen));
  $('#favs-body').hidden = !favsOpen;
  const remove = (kind, name, label = name) => {
    const b = chip(label, null, false, () => setFav(kind, name));
    b.classList.add('fav');
    b.setAttribute('aria-label', `Remove ${label} from favorites`);
    return b;
  };
  $('#favs').replaceChildren(
    ...favs.teams.map((t) => remove('teams', t)),
    ...favs.players.map((p) => remove('players', p)),
    ...favs.winter.map((k) => remove('winter', k, winterLabel(k))),
    ...(favs.f1 ? [remove('f1', null, F1_NAME)] : []),
  );
  renderCalendar(favs.teams);
  $('#favs-hint').textContent = !n
    ? 'Search below for a team, player, F1 or a winter sport. Its cards then get a ★.'
    : prefs.favsOnly && favs.players.length && prefs.view === 'replays' && ['all', 'tennis'].includes(prefs.sport)
      ? 'Tennis players only count under Coming up/ongoing, so replays don\'t spoil who went through.'
      : 'Tap one to remove it.';
  renderFavHits();
}

function renderFavHits() {
  const q = $('#fav-q').value;
  const hits = searchNames(favNames([events, upcoming]), q, prefs.favs, prefs.favs.f1 ? 8 : 7);
  const typed = q.trim().toLowerCase();
  const f1 = !prefs.favs.f1 && typed && ['f1', 'formula 1', 'formula one'].some((w) => w.startsWith(typed));
  const add = (kind, name, label = name) => chip(`+ ${label}`, null, false, () => {
    $('#fav-q').value = '';
    setFav(kind, name);
    $('#fav-q').focus();
  });
  $('#fav-hits').replaceChildren(...(f1 ? [add('f1', null, F1_NAME)] : []), ...hits.map((h) => add(h.kind, h.name, h.label)));
  $('#fav-hits').hidden = !q.trim();
  if (q.trim() && !hits.length && !f1) {
    const already = searchNames(favNames([events, upcoming]), q, { teams: [], players: [] }, 1).length || (prefs.favs.f1 && typed.startsWith('f'));
    const text = already ? 'Already one of your favorites.' : 'No team or player by that name in the data yet.';
    $('#fav-hits').replaceChildren(Object.assign(document.createElement('span'), { className: 'small', textContent: text }));
  }
}

// A ★ after a name you follow (tap to unfollow). Names you don't follow get nothing,
// to keep the cards clean: you follow something with the search box in "My favorites".
function star(kind, name, label) {
  const on = kind === 'f1' ? prefs.favs.f1 : (prefs.favs[kind] ?? []).includes(name);
  if (!on) return '';
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'star', textContent: '★' });
  b.setAttribute('aria-pressed', 'true');
  b.setAttribute('aria-label', `Unfollow ${label}`);
  b.title = b.getAttribute('aria-label');
  b.onclick = () => setFav(kind, name);
  return b;
}

// The card title, with a star after each team or player you follow (or after the race, for F1).
function fillTitle(title, e) {
  if (namesHidden(e, prefs) && !revealed.has(e.id)) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'reveal' });
    b.textContent = `${hiddenTitleOf(e)} · tap to show`;
    b.onclick = () => { revealed.add(e.id); render(); };
    title.append(b);
    return;
  }
  if (e.sport === 'winter') { // follows the sport and gender, e.g. "Biathlon (women)"
    title.append(titleOf(e), star('winter', winterKey(e), winterLabel(winterKey(e))));
    return;
  }
  if (e.sport === 'f1') {
    title.append(titleOf(e), star('f1', null, 'F1'));
    return;
  }
  const [kind, names, sep] = e.sport === 'football' ? ['teams', e.teams, ' – '] : ['players', e.players, ' vs '];
  names.forEach((name, i) => {
    if (i) title.append(sep);
    const span = Object.assign(document.createElement('span'), { className: 'name' });
    span.dataset.name = name;
    const s = star(kind, name, name);
    // "Show Elo ratings": the team's latest Elo, the same on all its cards.
    const elo = kind === 'teams' && prefs.showElo && Number.isFinite(eloRatings[name])
      ? Object.assign(document.createElement('small'), { className: 'elo', textContent: ` (${eloRatings[name]})`, title: 'Elo rating: team strength, higher is stronger' })
      : null;
    if (s || elo) { // keep the last word, the rating and the star together, so neither ends up alone on a line
      const cut = name.lastIndexOf(' ') + 1;
      span.append(name.slice(0, cut), Object.assign(document.createElement('span'), { className: 'keep' }));
      span.lastChild.append(name.slice(cut), ...[elo, s].filter(Boolean));
    } else {
      span.append(name);
    }
    title.append(span);
  });
}

function card(e) {
  const li = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const tier = tierOf(e.score);
  li.dataset.tier = tier.key;
  li.dataset.id = e.id;
  li.classList.toggle('is-watched', watched.has(e.id));
  li.querySelector('.num').textContent = e.score == null ? '–' : e.score.toFixed(1);
  li.querySelector('.tier').textContent = tier.label;
  li.querySelector('.sport').textContent = e.sport === 'winter' ? e.compName : SPORTS[e.sport];
  li.querySelector('.when').textContent = fmt.format(new Date(e.start));
  if (e.limited) { // football scored from shot counts only: FotMob had no xG for it
    const tag = Object.assign(document.createElement('span'), { className: 'limited', textContent: ' · limited info: no xG' });
    tag.title = 'No chance-quality (xG) data for this match, so the score is based on shot counts only.';
    li.querySelector('.meta').append(tag);
  }

  fillTitle(li.querySelector('.title'), e);
  const stakes = prefs.preHints ? prematchLine(e) : ''; // replays only have the stakes, never the forecast
  li.querySelector('.sub').textContent = stakes ? `${subtitleOf(e)} · ${stakes}` : subtitleOf(e);

  const strip = li.querySelector('.strip');
  const advice = li.querySelector('.advice');
  if (prefs.hints) {
    strip.append(...e.segments.map((lvl) => Object.assign(document.createElement('i'), { className: `h${lvl}` })));
    for (const { left, width } of skipShades(e)) {
      const b = Object.assign(document.createElement('b'), { className: 'skip' });
      b.style.left = `${left}%`;
      b.style.width = `${width}%`;
      strip.append(b);
    }
    if (e.advice) advice.textContent = adviceText(e.advice);
  }
  strip.hidden = !prefs.hints || !e.segments.length;
  advice.hidden = !prefs.hints || !e.advice; // unrated events (F1 qualifying) get no tips

  li.querySelector('.svc').append(...servicePills(e));

  fillLineups(li, e);

  const why = li.querySelector('.why');
  const whyBtn = li.querySelector('.why-btn');
  const unrated = e.score == null; // F1 qualifying: no score to explain, so straight to the result
  if (unrated ? resultShown.has(e.id) : whyShown.has(e.id)) {
    whyBtn.hidden = true;
    why.hidden = false;
    fillWhy(why, e);
  }
  if (unrated) {
    whyBtn.textContent = '⚠⚠ Show the result';
    whyBtn.classList.add('result-btn');
  }
  whyBtn.onclick = () => askSpoiler(e.id, unrated ? 'result' : 'why');

  const w = li.querySelector('.watched');
  w.textContent = watched.has(e.id) ? 'Watched ✓' : 'Mark watched';
  w.setAttribute('aria-pressed', String(watched.has(e.id)));
  w.onclick = () => {
    watched.has(e.id) ? watched.delete(e.id) : watched.add(e.id);
    store.save('pt-watched', [...watched]);
    render();
  };
  return li;
}

function fillWhy(box, e) {
  box.replaceChildren();
  if (e.score != null) fillReasons(box, e); // unrated events (F1 qualifying) only have the result
  else if (resultShown.has(e.id)) box.append(resultBox(e));
  // ✕ in the corner hides the spoilers again (both levels); they come back only through the warnings.
  const close = Object.assign(document.createElement('button'), { type: 'button', className: 'why-close', textContent: '✕' });
  close.setAttribute('aria-label', 'Hide the spoilers');
  close.onclick = () => {
    whyShown.delete(e.id);
    resultShown.delete(e.id);
    subsOpen.delete(e.id);
    render();
    document.querySelector(`.card[data-id="${CSS.escape(e.id)}"] .why-btn`)?.focus({ preventScroll: true });
  };
  box.prepend(close);
}

function fillReasons(box, e) {
  const reasons = reasonsFile?.[e.id];
  if (!reasons) {
    box.textContent = 'No explanation saved for this event yet.';
    return;
  }
  const { lines, note } = reasonLines(reasons);
  const ul = document.createElement('ul');
  for (const l of lines) {
    const li = document.createElement('li');
    li.classList.toggle('neg', l.negative);
    li.append(Object.assign(document.createElement('span'), { className: 'pts', textContent: l.pts }), Object.assign(document.createElement('span'), { textContent: l.label }));
    ul.append(li);
  }
  box.replaceChildren(ul);
  if (note) box.append(Object.assign(document.createElement('p'), { className: 'small', textContent: note }));

  // Second level: the actual result, behind another warning.
  if (resultShown.has(e.id)) box.append(resultBox(e));
  else {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'why-btn result-btn', textContent: '⚠⚠ Show the result' });
    b.onclick = () => askSpoiler(e.id, 'result');
    box.append(b);
  }
}

function resultBox(e) {
  // Tennis and F1 results are one line of text; football is
  // {text, goals: ["36' · 0–1 · Name (Team)", …], subs: ["58' · Name on for Name (Team)", …]}.
  const saved = resultsFile?.[e.id] ?? 'No result saved for this event yet.';
  const { text, goals = [], subs = [] } = typeof saved === 'string' ? { text: saved } : saved;
  const div = Object.assign(document.createElement('div'), { className: 'result' });
  div.append(Object.assign(document.createElement('p'), { className: 'result-text', textContent: text }));
  if (goals.length) div.append(columnsList(goals, 'goals'));
  if (subs.length) { // behind its own button, like the line-ups
    const subsShown = subsOpen.has(e.id);
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'subs-btn' });
    b.textContent = subsShown ? '▾ Substitutions' : `▸ Substitutions (${subs.length})`;
    b.setAttribute('aria-expanded', String(subsShown));
    b.onclick = () => { subsShown ? subsOpen.delete(e.id) : subsOpen.add(e.id); render(); };
    div.append(b);
    if (subsShown) div.append(columnsList(subs, 'goals subs'));
  }
  return div;
}

const SPOILER_LEVELS = {
  why: {
    title: '⚠ Spoiler warning',
    text: 'The reasons behind a score give the game away: goals, lead changes, set scores, who came back, safety cars and more.',
    ok: 'Show spoilers', file: './data/reasons.json', shown: whyShown,
  },
  result: {
    title: '⚠⚠ Show the result?',
    text: 'This shows the final result: the score, who won, the podium. There is no going back from this one.',
    ok: 'Show the result', file: './data/results.json', shown: resultShown,
  },
};
const spoilerFiles = { why: () => reasonsFile, result: () => resultsFile };

async function askSpoiler(id, level) {
  const cfg = SPOILER_LEVELS[level];
  const dlg = $('#spoiler-dlg');
  dlg.querySelector('h2').textContent = cfg.title;
  dlg.querySelector('.dlg-text').textContent = cfg.text;
  dlg.querySelector('button[value="ok"]').textContent = cfg.ok;
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
  if (dlg.returnValue !== 'ok') return;
  // Fetched once per visit, and again if it doesn't know this event yet (scored while the page was open).
  if (!spoilerFiles[level]()?.[id]) {
    let file = spoilerFiles[level]() ?? {};
    try { file = await (await fetch(cfg.file, { cache: 'no-cache' })).json(); } catch { /* shown as "not saved" */ }
    if (level === 'why') reasonsFile = file; else resultsFile = file;
  }
  cfg.shown.add(id);
  render();
  // The button that was tapped is gone; move the focus to what it opened (for keyboards and screen readers).
  const panel = document.querySelector(`.card[data-id="${CSS.escape(id)}"] .why`);
  if (panel) { panel.tabIndex = -1; panel.focus({ preventScroll: true }); }
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

// The small text under LIVE: the match minute for football ("67'", "HT", "FT"), the time since
// the start for F1 and winter sports, and "now" for tennis (ESPN's tennis times are the court's
// slot, not the real start; a set number would give the score away).
function liveTier(e, now = Date.now()) {
  if (e.sport === 'football') {
    if (finished.has(e.id)) return 'FT';
    // The page's own reading wins while it's recent (by this device's clock, which may differ from the bot's).
    const mine = freshClock.get(e.id);
    const clock = mine && now - mine.seen < 3 * 60e3 ? mine : e.clock;
    return liveClockText(clock, now) || 'now';
  }
  if (e.sport === 'tennis') return 'now';
  return elapsedText(e.start, now) || 'now';
}

// Rewrites the minute on live cards (every 30 seconds), without redrawing anything else.
function updateClocks() {
  for (const li of document.querySelectorAll('#cards > .card.soon.live')) {
    const e = upcoming.find((x) => x.id === li.dataset.id);
    if (e) li.querySelector('.tier').textContent = liveTier(e);
  }
}

function soonCard(e) {
  const li = $('#soon-tpl').content.firstElementChild.cloneNode(true);
  li.dataset.id = e.id;
  const live = e.status === 'live';
  li.classList.toggle('live', live);
  li.querySelector('.time').textContent = finished.has(e.id) ? 'ENDED' : live ? 'LIVE' : timeFmt.format(new Date(e.start));
  li.querySelector('.tier').textContent = live ? liveTier(e) : '';
  li.querySelector('.sport').textContent = e.sport === 'winter' ? e.compName : SPORTS[e.sport];
  const where = e.sport === 'f1' ? `${f1SessionName(e)} · ${e.circuit}` : e.sport === 'winter' ? e.place : e.compName;
  const began = live ? ` · ${e.sport === 'tennis' ? 'listed' : 'started'} ${timeFmt.format(new Date(e.start))}` : '';
  li.querySelector('.comp').textContent = where + began;
  fillTitle(li.querySelector('.title'), e);
  // Tennis: draw and round. Football: the pre-match hints, if any. Otherwise the meta line says it all.
  const sub = e.sport === 'tennis' ? subtitleOf(e) : e.sport === 'football' && prefs.preHints ? prematchLine(e) : '';
  li.querySelector('.sub').textContent = sub;
  li.querySelector('.sub').hidden = !sub;
  const chances = prefs.showChances ? chancesLine(e) : '';
  li.querySelector('.chances').textContent = chances;
  li.querySelector('.chances').hidden = !chances;
  li.querySelector('.svc').append(...servicePills(e));
  fillPace(li, e);
  fillLineups(li, e);
  return li;
}

// "Excitement so far" on live football cards, behind a button (it says a lot about the match).
// The page works it out itself from ESPN's match summary, and keeps only the number: never the
// score or the scorers. If ESPN refuses, it shows the bot's number from the last few minutes.
function fillPace(li, e) {
  if (e.sport !== 'football' || e.status !== 'live' || finished.has(e.id)) return;
  const btn = li.querySelector('.pace-btn');
  const open = paceOpen.has(e.id);
  btn.hidden = false;
  btn.textContent = open ? '▾ Excitement so far' : '👁 Excitement so far';
  btn.setAttribute('aria-expanded', String(open));
  btn.onclick = () => {
    if (open) paceOpen.delete(e.id);
    else { paceOpen.add(e.id); if (!paceNow.has(e.id)) loadPace(e); }
    render();
  };
  if (!open) return;
  const line = li.querySelector('.pace');
  line.hidden = false;
  line.textContent = paceText(e);
}

function paceText(e) {
  const mine = paceNow.get(e.id);
  const fmt = (p, note) => `≈ ${p.pace.toFixed(1)} out of 10${p.rough ? ', early and rough' : ''}${note}`;
  if (mine?.pace != null) return fmt(mine, '');
  if (mine?.early) return `Too early to tell: check back after ${LIVE_FROM}'.`;
  if (!mine) return 'Working it out…';
  if (e.pace != null) return fmt(e, ' (a few minutes old)');
  return 'Couldn\'t work it out right now. Try again in a minute.';
}

// Fetches the match summary from ESPN and works out the number. Only the number is kept.
async function loadPace(e) {
  try {
    const res = await fetch(`${ESPN}/${e.comp}/summary?event=${e.id.slice(3)}`, { signal: AbortSignal.timeout(20e3) });
    if (!res.ok) throw new Error(res.status);
    const summary = await res.json();
    if (summary.header?.competitions?.[0]?.status?.type?.state === 'post') { // ended since the last look
      finished.add(e.id);
      paceOpen.delete(e.id);
      keepScroll(render);
      return;
    }
    const facts = liveFacts(summary);
    const p = facts && scoreLivePace(facts, { w: liveWeights, factor: e.factor ?? 1, stakes: e.stakes });
    paceNow.set(e.id, p ?? (facts && facts.played < LIVE_FROM ? { early: true } : { failed: true }));
  } catch {
    paceNow.set(e.id, { failed: true });
  }
  const line = document.querySelector(`#cards > .card[data-id="${CSS.escape(e.id)}"] .pace`);
  if (line && !line.hidden) line.textContent = paceText(e);
}

// While live football is on screen, ask ESPN's scoreboard for the minute once a minute (one
// request per competition and day; ESPN keeps the answer for 27 seconds anyway), and refresh any
// open "Excitement so far". Only the clock is read; the rest of the answer (with every score
// that day) is thrown away. If ESPN refuses, the bot's clock from the last few minutes is used.
const LIVE_POLL_MS = 60e3;
let polling = false; // one round at a time, even if ESPN is slow
async function pollLive() {
  if (polling || prefs.view !== 'upcoming' || document.visibilityState !== 'visible') return;
  polling = true;
  try { await pollLiveNow(); } finally { polling = false; }
}
async function pollLiveNow() {
  const shown = new Set([...document.querySelectorAll('#cards > .card.soon.live')].map((li) => li.dataset.id));
  const live = upcoming.filter((e) => e.sport === 'football' && e.status === 'live' && shown.has(e.id));
  if (!live.length) return;
  const days = new Set(live.flatMap((e) => espnDays(e.start).map((d) => `${e.comp}|${d}`)));
  const ids = new Set(live.map((e) => e.id.slice(3)));
  await Promise.all([...days].map(async (key) => {
    const [comp, day] = key.split('|');
    try {
      const res = await fetch(`${ESPN}/${comp}/scoreboard?dates=${day}`, { signal: AbortSignal.timeout(20e3) });
      if (!res.ok) return;
      for (const ev of (await res.json()).events ?? []) {
        if (!ids.has(ev.id)) continue;
        const id = `fb-${ev.id}`;
        if (ev.status?.type?.state === 'post') { finished.add(id); paceOpen.delete(id); continue; }
        const clock = clockOf(ev.status);
        if (clock) freshClock.set(id, { ...clock, at: new Date().toISOString(), seen: Date.now() });
      }
    } catch { /* keep the bot's clock */ }
  }));
  for (const e of live) if (paceOpen.has(e.id) && !finished.has(e.id)) await loadPace(e);
  updateClocks();
  // A match that just ended: redraw it once (no more "Excitement so far"), and look for the
  // bot's replay every minute instead of every 5.
  const over = live.filter((e) => finished.has(e.id));
  if (over.some((e) => !redrawn.has(e.id))) {
    over.forEach((e) => redrawn.add(e.id));
    keepScroll(render);
  }
  if (over.length) fetchData({ quiet: true });
}

// Football starting line-ups, behind a button. ESPN publishes them about 75 minutes
// before kick-off; until then the button stays hidden. Each team is
// { formation: '4-2-3-1', players: [[shirt, name, position], …], bench: [[shirt, name], …] },
// goalkeeper first, then defence to attack, so the formation tells where each line starts.
function fillLineups(li, e) {
  if (!e.lineups) return;
  const btn = li.querySelector('.lineup-btn');
  const box = li.querySelector('.lineups');
  const open = lineupsOpen.has(e.id);
  btn.hidden = false;
  btn.textContent = open ? '▾ Hide line-ups' : '▸ Line-ups';
  btn.setAttribute('aria-expanded', String(open));
  btn.onclick = () => { open ? lineupsOpen.delete(e.id) : lineupsOpen.add(e.id); render(); };
  if (!open) return;
  box.hidden = false;
  box.replaceChildren(...e.lineups.map((t, i) => {
    const col = document.createElement('div');
    const h = Object.assign(document.createElement('h4'), { textContent: e.teams[i] });
    if (t.formation) h.append(' ', Object.assign(document.createElement('small'), { textContent: t.formation }));
    const sizes = [1, ...t.formation.split('-').map(Number)];
    const starts = new Set(sizes.reduce((sum, n) => sum + n, 0) === 11 ? sizes.map((_, k) => sizes.slice(0, k).reduce((a, b) => a + b, 0)) : [0]);
    const ol = document.createElement('ol');
    t.players.forEach(([n, name, pos], k) => {
      const row = document.createElement('li');
      row.classList.toggle('new-line', k > 0 && starts.has(k));
      row.append(...[['n', n], ['name', name], ['pos', pos]].map(([className, textContent]) => Object.assign(document.createElement('span'), { className, textContent })));
      ol.append(row);
    });
    col.append(h, ol);
    if (t.bench?.length) { // the bench has its own button, to keep the card short
      const key = `${e.id}:${i}`;
      const benchShown = benchOpen.has(key);
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'bench-btn' });
      b.textContent = benchShown ? '▾ Bench' : `▸ Bench (${t.bench.length})`;
      b.setAttribute('aria-expanded', String(benchShown));
      b.onclick = () => { benchShown ? benchOpen.delete(key) : benchOpen.add(key); render(); };
      col.append(b);
      if (benchShown) {
        col.append(Object.assign(document.createElement('p'), {
          className: 'bench', textContent: t.bench.map(([n, name]) => (n ? `${n}\u00a0${name}` : name)).join(' · '),
        }));
      }
    }
    return col;
  }));
}

function renderUpcoming() {
  const list = filterUpcoming(upcoming, prefs);
  const shownList = list.slice(0, limit);
  const items = [];
  let lastDay = null;
  for (const e of shownList) {
    const day = e.status === 'live' ? 'Live now' : dayLabel(e.start);
    if (day !== lastDay) {
      items.push(Object.assign(document.createElement('li'), { className: 'day', textContent: day }));
      lastDay = day;
    }
    items.push(soonCard(e));
  }
  $('#cards').replaceChildren(...items);
  moreButton(list.length);
  $('#status').textContent = list.length
    ? `${list.length} coming up or ongoing. No final scores here: they appear under Replays once the event has finished.`
    : prefs.favsOnly ? 'None of your favorites are coming up. Turn off “Only favorites” to see everything.' : 'Nothing coming up that matches these filters.';
}

function render() {
  renderControls();
  if (prefs.view === 'upcoming') return renderUpcoming();
  const list = filterEvents(events, prefs, watched);
  $('#cards').replaceChildren(...list.slice(0, limit).map(card));
  moreButton(list.length);
  const shown = list.length === 1 ? '1 event' : `${list.length} events`;
  $('#status').textContent = events.length
    ? (list.length ? shown : prefs.favsOnly
      ? 'None of your favorites match these filters. Turn off “Only favorites” to see everything.'
      : 'Nothing matches these filters. Try a longer period or fewer filters.')
    : 'No events yet.';
}

function bind() {
  $('#views').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    prefs.view = b.dataset.view;
    savePrefs();
    render();
  };
  $('#sports').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    prefs.sport = b.dataset.sport;
    savePrefs();
    render();
  };
  const on = (sel, key, parse = (v) => v) => {
    $(sel).onchange = (ev) => {
      prefs[key] = ev.target.type === 'checkbox' ? ev.target.checked : parse(ev.target.value);
      savePrefs();
      render();
    };
  };
  on('#f-days', 'days', Number);
  on('#f-min', 'minScore', Number);
  on('#f-sort', 'sort');
  on('#f-round', 'round');
  on('#f-draw', 'draw');
  on('#f-f1session', 'f1Session');
  on('#f-gender', 'gender');
  on('#f-hide-tn', 'hideTennis');
  on('#f-hide-fb', 'hideFootball');
  $('#f-reset').onclick = () => {
    Object.assign(prefs, { comp: 'all', days: 30, minScore: 0, sort: 'date', round: '', draw: '', f1Session: '', gender: '', hideWatched: false });
    savePrefs();
    render();
  };
  $('#fav-only').onclick = () => { prefs.favsOnly = !prefs.favsOnly; savePrefs(); render(); };
  $('#favs-toggle').onclick = () => {
    favsOpen = !favsOpen;
    store.save('pt-favs-open', favsOpen);
    renderFavs();
  };
  $('#fav-q').oninput = renderFavHits;
  $('#fav-q').onkeydown = (ev) => {
    if (ev.key !== 'Enter') return;
    $('#fav-hits .chip')?.click(); // Enter adds the top suggestion
  };
  $('#share-btn').onclick = shareSettings;
  on('#f-hints', 'hints');
  on('#f-prehints', 'preHints');
  on('#f-elo', 'showElo');
  on('#f-chances', 'showChances');
  on('#f-watched', 'hideWatched');
  on('#f-glass', 'glass');
}

// Re-renders without the card you're looking at jumping when a card above it comes or goes:
// notes the first card on screen and where it is, and scrolls it back to the same spot.
function keepScroll(fn) {
  const top = [...document.querySelectorAll('#cards > .card')].find((c) => c.getBoundingClientRect().bottom > 0);
  const id = top?.dataset.id, before = top?.getBoundingClientRect().top;
  fn();
  const again = id && document.querySelector(`#cards > .card[data-id="${CSS.escape(id)}"]`);
  if (again) scrollBy(0, again.getBoundingClientRect().top - before);
}

const REFRESH_MS = 5 * 60e3;
let lastFetch = 0;

// Fetches the event list. The page refreshes it every 5 minutes while it's
// open, and when you come back to the tab, without losing your place.
async function fetchData({ quiet = false } = {}) {
  try {
    const res = await fetch('./data/events.json', { cache: 'no-cache' });
    const data = await res.json();
    lastFetch = Date.now();
    if (quiet && data.generated === $('#updated').dataset.generated) return;
    events = data.events ?? [];
    upcoming = data.upcoming ?? [];
    eloRatings = data.elo ?? {};
    liveWeights = data.liveWeights ?? null;
    for (const id of finished) if (!upcoming.some((e) => e.id === id)) finished.delete(id);
    keepScroll(render); // keeps filters, "Show more" and open panels as they were
    $('#updated').dataset.generated = data.generated;
    $('#updated').textContent = `Updated ${fmt.format(new Date(data.generated))}.`;
  } catch {
    if (!quiet) $('#status').textContent = 'Could not load the event list. Check your connection and reload.';
  }
}

// "Install app": Chrome/Android fires beforeinstallprompt when the page can be
// installed, and we show a button for it. iPhones have no such event, so Safari
// gets a tip instead. Nothing shows once it's running as the installed app.
function setupInstall() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (installed) return;
  const box = $('#install'), btn = $('#install-btn');
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    box.hidden = btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!prompt) return;
    prompt.prompt();
    await prompt.userChoice;
    prompt = null;
    box.hidden = btn.hidden = true;
  });
  addEventListener('appinstalled', () => { box.hidden = true; });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) box.hidden = $('#install-ios').hidden = false;
}

// "Share my settings": the phone's share sheet where there is one, otherwise copy the link.
async function shareSettings() {
  const url = `${location.origin}${location.pathname}#s=${encodeSettings(prefs, watched, events)}`;
  const note = $('#share-note');
  if (navigator.share) {
    try {
      await navigator.share({ title: 'My PrimeTime settings', url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return; // closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    note.textContent = 'Link copied. Open it on your other device.';
  } catch {
    prompt('Copy this link and open it on your other device:', url);
  }
}

// Opening a settings link asks first, then loads it and tidies the address bar.
async function importSettings() {
  const code = location.hash.match(/^#s=([\w-]+)$/)?.[1];
  if (!code) return;
  history.replaceState(null, '', location.pathname + location.search);
  const data = decodeSettings(code, DEFAULTS);
  const dlg = $('#import-dlg');
  const okBtn = dlg.querySelector('button[value="ok"]');
  if (!data) {
    dlg.querySelector('h2').textContent = 'This settings link is broken';
    dlg.querySelector('.dlg-text').textContent = 'Try copying it again from your other device.';
    okBtn.hidden = true;
    dlg.showModal();
    return;
  }
  // Put back what a broken link changed, in case one was opened earlier in this visit.
  dlg.querySelector('h2').textContent = 'Load these settings?';
  okBtn.hidden = false;
  const favN = favCount({ ...DEFAULTS.favs, ...data.prefs.favs });
  const svcN = data.prefs.services?.length ?? 0;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  dlg.querySelector('.dlg-text').textContent =
    `It has ${plural(favN, 'favorite')}, ${plural(svcN, 'streaming service')} and ${plural(data.watched.length, 'watched mark')}, plus your filters.`;
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
  if (dlg.returnValue !== 'ok') return;
  Object.assign(prefs, { ...DEFAULTS, ...data.prefs, view: prefs.view });
  prefs.favs = { ...DEFAULTS.favs, ...prefs.favs };
  for (const id of data.watched) watched.add(id);
  savePrefs();
  store.save('pt-watched', [...watched]);
  render();
}

function load() {
  setupInstall();
  bind();
  renderControls();
  window.primetimeStarted = true; // tells the safety net in index.html that the app started (set last, so a crash above still shows it)
  fetchData();
  importSettings();
  addEventListener('hashchange', importSettings); // a link opened while the page is already open
  setInterval(() => document.visibilityState === 'visible' && fetchData({ quiet: true }), REFRESH_MS);
  setInterval(updateClocks, 30e3);
  setInterval(pollLive, LIVE_POLL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > REFRESH_MS) fetchData({ quiet: true });
    if (document.visibilityState === 'visible') { updateClocks(); pollLive(); } // back to the tab: catch up on the minute
  });
}

load();
