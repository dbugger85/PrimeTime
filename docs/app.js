import { SPORTS, migratePrefs, periodOptions, facets, activeFilters, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, reasonGroups, filterEvents, namesHidden, titleOf, f1SessionName, favCount, toggleFav, favNames, searchNames, winterKey, winterLabel, encodeSettings, decodeSettings, subtitleOf, hiddenTitleOf, prematchLine, chancesLine, teamSlug, leagueGroups } from './logic.js';
import { ESPN, clockOf, liveClockText, espnDays, liveFacts, scoreLivePace, LIVE_FROM, elapsedText, PILLAR_KEYS, pillarShares, pillarWeightKey } from './live.js';
import { scoreFootball, applyTweaks, cleanTweaks, isStandard, DEFAULT_TWEAKS, TWEAK_GROUPS, STAKES, SCALE_MAX, SCALE_STEP, CURVE_STEP, BOOST_STEP, BOOST_MAX, PILLARS, PILLAR_MAX, PILLAR_STEP } from './scoring.js';

const SERVICES = {
  viaplay: { name: 'Viaplay', url: 'https://viaplay.no/sport' },
  tv2play: { name: 'TV 2 Play', url: 'https://play.tv2.no/sport' },
  hbomax: { name: 'HBO Max', url: 'https://www.hbomax.com/no/no' },
  nrk: { name: 'NRK TV', url: 'https://tv.nrk.no/' },
  f1tv: { name: 'F1 TV', url: 'https://f1tv.formula1.com/' },
  vgplus: { name: 'VG+ Sport', url: 'https://www.vg.no/vgpluss' },
};

const DEFAULTS = {
  view: 'replays', sport: 'all', services: [], leagues: [], comp: 'all', days: 30, minScore: 0, sort: 'date',
  round: '', draw: '', f1Session: '', hideTennis: true, hideFootball: false, hints: true, preHints: true, showElo: false, showChances: false, hideWatched: false, glass: true,
  favsOnly: false, favs: { teams: [], players: [], f1: false, winter: [] }, gender: '',
  tweaks: DEFAULT_TWEAKS, // "Custom scoring (football)": the sliders and competition boosts (docs/scoring.js)
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
prefs.tweaks = cleanTweaks(prefs.tweaks);
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
let footballWeights = null; // all the football weights (from events.json), for custom scoring
let sliderScale = {}; // where each slider stands with the standard weights, in points (from events.json)
let factsFile = null; // docs/data/facts.json: loaded only after the custom scoring or calibration warning
let factsFailed = false;
let custom = new Map(); // id -> the match re-scored with your settings ({ score, reasons, lines })
let customW = null; // the football weights with your sliders applied
let calibrating = false; // "Calibration mode": every result shown. This visit only, so a reload never opens full of results
const calcOpen = new Set(); // "Facts and calculation" opened (calibration mode)
const liveScore = new Map(); // id -> the live score as ESPN says it (calibration mode only)
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

// "My competitions": tap the football competitions you follow; none picked shows them all.
function renderLeagues() {
  const groups = leagueGroups([...events, ...upcoming]);
  const all = groups.flatMap((g) => g.comps.map((c) => c.key));
  const mine = prefs.leagues.filter((k) => all.includes(k));
  const toggle = (key) => () => {
    prefs.leagues = prefs.leagues.includes(key) ? prefs.leagues.filter((k) => k !== key) : [...prefs.leagues, key];
    savePrefs();
    render();
  };
  $('#leagues').replaceChildren(...groups.map((g) => {
    const box = Object.assign(document.createElement('div'), { className: 'league-group' });
    box.append(Object.assign(document.createElement('p'), { className: 'league-head', textContent: g.name }),
      Object.assign(document.createElement('div'), { className: 'chips' }));
    box.lastChild.append(...g.comps.map((c) => chip(c.name, null, prefs.leagues.includes(c.key), toggle(c.key))));
    return box;
  }));
  $('#leagues-hint').textContent = mine.length ? `${mine.length} of ${all.length}` : 'all';
  $('#leagues-all').hidden = !mine.length;
}

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

  const pool = view === 'upcoming' ? upcoming : viewEvents();
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

  renderLeagues();
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
  renderTuning();
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
  li.dataset.comp = e.comp;
  li.classList.toggle('is-watched', watched.has(e.id));
  li.querySelector('.num').textContent = e.score == null ? '–' : e.score.toFixed(1);
  li.querySelector('.tier').textContent = tier.label;
  li.querySelector('.sport').textContent = e.sport === 'winter' ? e.compName : SPORTS[e.sport];
  li.querySelector('.when').textContent = fmt.format(new Date(e.start));
  if (e.custom) { // re-scored on this device with your own settings: looks just like a standard card (the owner's choice)
    li.classList.add('custom');
    li.dataset.std = e.std;
  }
  if (e.limited) { // football scored from shot counts only: FotMob had no xG for it
    const tag = Object.assign(document.createElement('span'), { className: 'limited', textContent: ' · limited info: no xG' });
    tag.title = 'No chance-quality (xG) data for this match, so the score is based on shot counts only.';
    li.querySelector('.meta').append(tag);
  }

  fillTitle(li.querySelector('.title'), e);
  const stakes = prefs.preHints ? prematchLine(e) : ''; // replays only have the stakes, never the forecast
  li.querySelector('.sub').textContent = stakes ? `${subtitleOf(e)} · ${stakes}` : subtitleOf(e);

  fillCalibration(li, e);

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
  if (calibrating) whyBtn.textContent = unrated ? 'Show the result' : 'Why this score?'; // already warned

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
  const reasons = e.custom ? custom.get(e.id).reasons : reasonsFile?.[e.id];
  if (!reasons) {
    box.textContent = 'No explanation saved for this event yet.';
    return;
  }
  const { lines, note } = reasonLines(reasons);
  const ul = document.createElement('ul');
  const line = (l, className = '') => {
    const li = Object.assign(document.createElement('li'), { className });
    li.classList.toggle('neg', l.negative);
    li.append(Object.assign(document.createElement('span'), { className: 'pts', textContent: l.pts }), Object.assign(document.createElement('span'), { textContent: l.label }));
    return li;
  };
  // Football (since football 19): the lines grouped by pillar, each with its subtotal.
  const groups = reasonGroups(reasons, GROUP_LABELS, pillarShares(e.custom ? customW : footballWeights ?? {}));
  if (groups) for (const g of groups) ul.append(line({ pts: g.total, label: g.label, negative: g.total.startsWith('-') }, `group ${g.kind}`), ...g.lines.map((l) => line(l)));
  else ul.append(...lines.map((l) => line(l)));
  box.replaceChildren(ul);
  if (note && !groups) box.append(Object.assign(document.createElement('p'), { className: 'small', textContent: note }));

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
// Headings for the groups in "Why this score?" (football).
const GROUP_LABELS = { ...Object.fromEntries(Object.entries(PILLARS).map(([k, p]) => [k, p.label])), occasion: 'The occasion' };

const spoilerFiles = { why: () => reasonsFile, result: () => resultsFile };

// The spoiler warning dialog. Resolves to true when "show" was chosen.
async function confirmSpoiler(cfg) {
  const dlg = $('#spoiler-dlg');
  dlg.querySelector('h2').textContent = cfg.title;
  dlg.querySelector('.dlg-text').textContent = cfg.text;
  dlg.querySelector('button[value="ok"]').textContent = cfg.ok;
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
  return dlg.returnValue === 'ok';
}

async function askSpoiler(id, level) {
  const cfg = SPOILER_LEVELS[level];
  if (!calibrating && !(await confirmSpoiler(cfg))) return; // calibration mode: already warned
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
  const now = calibrating && liveScore.get(e.id);
  if (now) Object.assign(li.querySelector('.calib-result'), { hidden: false, textContent: `Now: ${now}` });
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

// The live number from ESPN's facts, with your own scoring when it's on (sliders and competition boost).
function livePace(e, facts) {
  const t = prefs.tweaks;
  const odds = e.chances ? { home: e.chances[0] / 100, draw: e.chances[1] / 100, away: e.chances[2] / 100 } : null; // for suspense
  if (!t.on || isStandard(t)) return scoreLivePace(facts, { w: liveWeights, factor: e.factor ?? 1, stakes: e.stakes, odds });
  return scoreLivePace(facts, {
    w: liveWeights && applyTweaks(liveWeights, t),
    factor: 1 + ((e.factor ?? 1) - 1) * t.sliders.bigMatch, // exact: the factor is linear in bigMatch and smallMatch
    stakes: e.stakes,
    boost: t.comps[e.comp] ?? 0,
    odds,
  });
}

function paceText(e) {
  const mine = paceNow.get(e.id);
  const fmt = (p, note) => `≈ ${p.pace.toFixed(1)} out of 10${p.rough ? ', early and rough' : ''}${note}`;
  const p = mine?.facts && livePace(e, mine.facts); // worked out again, so a slider change shows at once
  if (p) return fmt(p, '');
  if (mine?.facts && mine.facts.played < LIVE_FROM) return `Too early to tell: check back after ${LIVE_FROM}'.`;
  if (!mine) return 'Working it out…';
  if (e.pace != null) return fmt(e, ' (a few minutes old)');
  return 'Couldn\'t work it out right now. Try again in a minute.';
}

// Fetches the match summary from ESPN and works out the number. Only the facts behind it are kept
// (minutes, sides and counts: no names, no score), so a slider change can work it out again.
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
    const facts = liveFacts(summary); // minutes, sides and counts only: no names, no score
    paceNow.set(e.id, facts ? { facts } : { failed: true });
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
        if (calibrating) { // the score itself, only in calibration mode (after its warning)
          const c = ev.competitions?.[0]?.competitors ?? [];
          const [h, a] = ['home', 'away'].map((side) => c.find((x) => x.homeAway === side)?.score);
          const e = live.find((x) => x.id === id);
          if (h != null && a != null && e) liveScore.set(id, `${e.teams[0]} ${h}–${a} ${e.teams[1]}`);
        }
        if (ev.status?.type?.state === 'post') { finished.add(id); paceOpen.delete(id); continue; }
        const clock = clockOf(ev.status);
        if (clock) freshClock.set(id, { ...clock, at: new Date().toISOString(), seen: Date.now() });
      }
    } catch { /* keep the bot's clock */ }
  }));
  for (const e of live) if (paceOpen.has(e.id) && !finished.has(e.id)) await loadPace(e);
  updateClocks();
  if (calibrating) {
    for (const li of document.querySelectorAll('#cards > .card.soon.live')) {
      const now = liveScore.get(li.dataset.id);
      if (now) Object.assign(li.querySelector('.calib-result'), { hidden: false, textContent: `Now: ${now}` });
    }
  }
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
  const list = filterEvents(viewEvents(), prefs, watched);
  $('#cards').replaceChildren(...list.slice(0, limit).map(card));
  moreButton(list.length);
  const shown = (list.length === 1 ? '1 event' : `${list.length} events`) + (calibrating ? '. Calibration mode: all results shown' : '');
  $('#status').textContent = events.length
    ? (list.length ? shown : prefs.favsOnly
      ? 'None of your favorites match these filters. Turn off “Only favorites” to see everything.'
      : 'Nothing matches these filters. Try a longer period or fewer filters.')
    : 'No events yet.';
}

// ── Custom scoring and calibration mode (football) ──────────────────────────
// The page re-scores football replays itself with docs/scoring.js (the bot's own scorer), from
// the facts in docs/data/facts.json, which is only downloaded after a warning.

// Your score for every football replay that has facts. The standard score stays on the event.
function recompute() {
  custom = new Map();
  const t = prefs.tweaks;
  // Weights from before football 20 (a cached events.json just after an update) can't score the new way.
  customW = footballWeights && 'chancesScale' in footballWeights ? applyTweaks(footballWeights, t) : null;
  if (!customW || !factsFile) return;
  for (const e of events) {
    const f = e.sport === 'football' && factsFile[e.id];
    if (!f) continue;
    try {
      custom.set(e.id, scoreFootball(f, customW, { boost: t.comps[e.comp] ?? 0, boostLabel: e.compName }));
    } catch { /* keeps the standard score */ }
  }
}

// The replays as shown: with custom scoring on, re-scored matches carry your score, the
// standard one in `std`, and `custom: true` (so sorting, filters and counts use your numbers).
function viewEvents() {
  if (!prefs.tweaks.on || !custom.size) return events;
  return events.map((e) => (custom.has(e.id) ? { ...e, score: custom.get(e.id).score, std: e.score, custom: true } : e));
}

async function ensureFacts({ force = false } = {}) {
  if (factsFile && !force) return;
  try {
    factsFile = await (await fetch('./data/facts.json', { cache: 'no-cache' })).json();
    factsFailed = false;
  } catch {
    factsFailed = !factsFile;
  }
}
async function ensureResults({ force = false } = {}) {
  if (resultsFile && !force) return;
  try { resultsFile = await (await fetch('./data/results.json', { cache: 'no-cache' })).json(); } catch { /* shown as "not saved" */ }
}

const CONSENT = {
  custom: {
    title: '⚠ Custom scoring',
    text: 'To re-score matches, this device downloads the facts behind every football score: goals, cards, chances and the odds before kick-off. They are never shown, but extreme settings can hint at results (with only "Upsets" turned up, a high score means an upset).',
    ok: 'Turn it on',
  },
  calibrate: {
    title: '⚠⚠ Calibration mode',
    text: 'Calibration mode shows every result on every card, live scores included, plus the facts and the full calculation behind each football score. Everything is spoiled until you switch it off. It switches itself off when you reload the page.',
    ok: 'Show everything',
  },
};

// Calibration mode on a replay card: the result under the title, and (football) the facts and calculation.
function fillCalibration(li, e) {
  if (!calibrating) return;
  const saved = resultsFile?.[e.id];
  const text = typeof saved === 'string' ? saved : saved?.text;
  Object.assign(li.querySelector('.calib-result'), { hidden: false, textContent: text ? `Result: ${text}` : 'No result saved for this event yet.' });
  if (e.sport !== 'football' || !factsFile?.[e.id] || !footballWeights) return;
  const btn = li.querySelector('.calc-btn');
  const open = calcOpen.has(e.id);
  btn.hidden = false;
  btn.textContent = open ? '▾ Facts and calculation' : '▸ Facts and calculation';
  btn.setAttribute('aria-expanded', String(open));
  btn.onclick = () => { open ? calcOpen.delete(e.id) : calcOpen.add(e.id); keepScroll(render); };
  if (!open) return;
  const box = li.querySelector('.calc');
  box.hidden = false;
  fillCalc(box, e, factsFile[e.id]);
}

const n2 = (x) => String(Math.round(x * 100) / 100);
const mins = (a) => (a.length ? a.map((m) => `${Math.ceil(m)}'`).join(', ') : 'none');

// Which sliders move a scoring line, from the weights behind it: "Chances › Near misses".
function sliderOf(l) {
  if (l.summary) return l.pillar === 'average' ? 'Pillar weights' : 'Pillar weight';
  if (!l.keys.length) return 'Competition boost';
  if (l.keys.includes('curveFrom')) return 'Top end';
  const group = Object.values(TWEAK_GROUPS).find((g) => l.keys.some((k) => g.keys.includes(k)));
  if (!group) return '';
  return group.pillar ? `${PILLARS[group.pillar].label} › ${group.label}` : group.label;
}

// The weights behind a line: "goal 1.2", or "goal 1.2 → 1.44" when your sliders changed it.
function weightsText(keys, W) {
  return keys.filter((k) => k in footballWeights).map((k) => {
    const std = footballWeights[k], mine = W[k];
    return Math.abs(mine - std) > 1e-9 ? `${k} ${n2(std)} → ${n2(mine)}` : `${k} ${n2(std)}`;
  }).join(', ');
}

function fillCalc(box, e, f) {
  const [home, away] = e.teams;
  const useMine = e.custom;
  const W = useMine ? customW : footballWeights;
  let scored;
  try {
    scored = useMine ? custom.get(e.id) : scoreFootball(f, footballWeights);
  } catch { // weights from before football 20, in a cached events.json: try again after the next refresh
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'small', textContent: 'The calculation is being updated. Reload the page in a minute.' }));
    return;
  }
  const el = (tag, props = {}, ...kids) => { const x = Object.assign(document.createElement(tag), props); x.append(...kids); return x; };

  // The facts, as the scorer saw them.
  const facts = [];
  // A row is [label, home, away] for team numbers, or [label, text] for one value (totals, minutes).
  const pair = (p, fmt = n2) => (p ? [fmt(p.home), fmt(p.away)] : ['', '']);
  let h = 0, a = 0;
  const goals = [...f.goals].sort((x, y) => x.min - y.min).map((g) => {
    g.side === 'home' ? h++ : a++;
    const note = [g.pen && 'pen', g.own && 'own goal'].filter(Boolean).join(', ');
    return `${g.clock ?? `${Math.ceil(g.min)}'`} · ${h}–${a} · ${g.side === 'home' ? home : away}${note ? ` (${note})` : ''}`;
  });
  if (f.odds) facts.push(['Win chances', ...pair(f.odds, (x) => `${Math.round(100 * x)}%`)]); // the draw is what's left
  if (f.strength) facts.push(['Strength (0 to 1)', ...pair(f.strength)]);
  if (f.stakes) facts.push(['At stake before kick-off', STAKES[f.stakes] ?? f.stakes]);
  facts.push(f.xg ? ['xG', ...pair(f.xg)] : ['xG', 'n/a', 'n/a']);
  if (f.stats?.bigChances) facts.push(['Big chances', ...pair(f.stats.bigChances)]);
  if (f.stats?.xgot) facts.push(['xG on target', ...pair(f.stats.xgot)]);
  if (f.stats?.touchesInBox) facts.push(['Touches in the box', ...pair(f.stats.touchesInBox)]);
  if (f.shotsBy) facts.push(['Shots', ...pair(f.shotsBy)]);
  if (f.shotsOnTarget != null) facts.push(['Shots on target', String(f.shotsOnTarget)]);
  if (f.corners != null) facts.push(['Corners', String(f.corners)]);
  if (f.yellows != null) facts.push(['Yellow cards', String(f.yellows)]);
  facts.push(['Red cards', mins(f.reds)], ['Penalties', mins(f.pens)], ['Ruled out by VAR', mins(f.disallowed)], ['Woodwork', mins(f.woodwork)]);
  if (f.extraTime) facts.push(['Extra time', 'yes']);
  if (f.shootout) facts.push(['Penalty shootout', f.shootoutWinner ? `won by ${f.shootoutWinner === 'home' ? home : away}` : 'yes']);

  // A table, so each team's numbers line up in its own column.
  const dl = el('table', { className: 'facts' });
  dl.append(el('colgroup', {}, el('col', { className: 'label' }), el('col'), el('col')));
  dl.append(el('thead', {}, el('tr', {}, el('th', { scope: 'col' }), ...[home, away].map((t) => el('th', { scope: 'col', textContent: t })))));
  const rows = el('tbody');
  // Team numbers first, then the totals and minutes under their own "Both teams" heading.
  const teamRows = facts.filter((r) => r.length === 3), bothRows = facts.filter((r) => r.length === 2);
  for (const [k, ...v] of teamRows) rows.append(el('tr', {}, el('th', { scope: 'row', textContent: k }), ...v.map((x) => el('td', { textContent: x }))));
  if (bothRows.length) rows.append(el('tr', { className: 'both' }, el('td'), el('th', { scope: 'colgroup', colSpan: 2, textContent: 'Both teams' })));
  for (const [k, v] of bothRows) rows.append(el('tr', {}, el('th', { scope: 'row', textContent: k }), el('td', { colSpan: 2, textContent: v })));
  dl.append(rows);

  // The calculation, line by line in the order it's worked out: points, what for, the running
  // total, and under it the slider and the weights behind the line.
  const calc = el('ol', { className: 'calc-lines' });
  calc.append(el('li', { className: 'calc-headings' }, el('span', { textContent: 'Points' }), el('span', { textContent: 'Line' }), el('span', { textContent: 'Total' })));
  for (const l of scored.lines) {
    const how = [sliderOf(l), weightsText(l.keys, W)].filter(Boolean).join(': ');
    calc.append(el('li', { className: l.points < 0 ? 'neg' : '' },
      el('span', { className: 'pts', textContent: `${l.points > 0 ? '+' : ''}${l.points.toFixed(2)}` }),
      el('span', { textContent: l.label }),
      el('span', { className: 'run', textContent: l.total.toFixed(2) }),
      el('span', { className: 'how', textContent: how })));
  }

  const std = useMine ? scoreFootball(f, footballWeights).score : scored.score;
  const sum = el('p', { className: 'calc-sum' }, useMine
    ? `Your score ${scored.score.toFixed(1)} · standard score ${std.toFixed(1)}`
    : `Score ${scored.score.toFixed(1)} (standard scoring)`);
  box.replaceChildren(
    el('h4', { textContent: 'Goals' }), goals.length ? columnsList(goals, 'goals') : el('p', { className: 'small', textContent: 'No goals.' }),
    el('h4', { textContent: 'Facts' }), dl,
    el('h4', { textContent: 'Calculation' }), calc, sum,
    el('p', { className: 'small', textContent: 'The total is kept between 0 and 10. The heat strip and skip tips always use the standard scoring.' }),
  );
}

// The panel: built once (so a slider isn't replaced while you drag it), then kept up to date.
// Four pillar sliders (each pillar's weight, 0 to PILLAR_MAX; only the shares count), and under "Advanced" the detailed
// sliders in points, grouped by pillar, then the occasion (big match, stakes, the top end).
const PILLAR_SLIDERS = Object.entries(PILLARS).map(([key, p]) => ({ key, kind: 'pillar', ...p }));
const SLIDERS = [...Object.entries(TWEAK_GROUPS).map(([key, g]) => ({ key, kind: 'detail', ...g })),
  { key: 'curve', kind: 'curve', pillar: null, label: 'Top end', hint: 'Left: high scores are rarer. Right: more generous.', keys: ['curveFrom'] }];
const ALL_SLIDERS = [...PILLAR_SLIDERS, ...SLIDERS];
// A detailed slider shows points (see SCALE_MAX in scoring.js): its multiplier times where it stands by
// standard. Without a scale (an older events.json) it falls back to the plain multiplier.
const scaleOf = (key) => sliderScale[key] || 1;
const sliderText = (key, v) => (v === 0 ? 'Off' : `${v.toFixed(1)} points`);
// The pillars' weights now (yours or the standard ones), and a pillar's share of the match score.
const stdPillars = () => Object.fromEntries(PILLAR_KEYS.map((p) => [p, Math.round(100 * (footballWeights?.[pillarWeightKey(p)] ?? 0.25))]));
const pillarsNow = () => prefs.tweaks.pillars ?? stdPillars();
function pillarText(key) {
  const p = pillarsNow(), sum = Object.values(p).reduce((a, b) => a + b, 0);
  const share = sum ? Math.round((100 * p[key]) / sum) : 25;
  return p[key] === 0 ? 'Off' : `${share}%${p[key] === stdPillars()[key] && prefs.tweaks.pillars == null ? ' (standard)' : ''}`;
}
const multiplierOf = (key, v) => (Math.abs(v - scaleOf(key)) < SCALE_STEP / 2 ? 1 : v / scaleOf(key)); // on the mark: exactly standard
function curveText(v) {
  const std = footballWeights?.curveFrom;
  return v === std ? `Standard (${v})` : std != null && v < std ? `Stricter (${v})` : `More generous (${v})`;
}
const curveValue = () => prefs.tweaks.curveFrom ?? footballWeights?.curveFrom ?? 2;
const valueText = (s, v) => (s.kind === 'pillar' ? pillarText(s.key) : s.kind === 'curve' ? curveText(v) : sliderText(s.key, v));
const RANGES = { pillar: { min: 0, max: PILLAR_MAX, step: PILLAR_STEP }, curve: { min: 0, max: 9, step: CURVE_STEP }, detail: { min: 0, max: SCALE_MAX, step: SCALE_STEP } };

function makeSlider(s) {
  const row = Object.assign(document.createElement('div'), { className: `slider${s.kind === 'pillar' ? ' pillar' : ''}` });
  row.dataset.key = s.key;
  row.dataset.kind = s.kind;
  const id = `t-${s.kind === 'pillar' ? 'p' : 's'}-${s.key}`;
  const input = Object.assign(document.createElement('input'), { type: 'range', id, ...RANGES[s.kind] });
  // The description stays folded away behind ⓘ (the owner found the panel too wordy).
  const hint = Object.assign(document.createElement('p'), { className: 'small s-hint', textContent: s.hint, hidden: true, id: `${id}-hint` });
  const info = Object.assign(document.createElement('button'), { type: 'button', className: 's-info', textContent: 'ⓘ' });
  info.setAttribute('aria-label', `What is ${s.label}?`);
  info.setAttribute('aria-expanded', 'false');
  info.setAttribute('aria-controls', hint.id);
  info.onclick = () => { hint.hidden = !hint.hidden; info.setAttribute('aria-expanded', String(!hint.hidden)); };
  const name = Object.assign(document.createElement('span'), { className: 's-name' });
  name.append(Object.assign(document.createElement('label'), { htmlFor: id, className: 's-label', textContent: s.label }), info);
  const head = Object.assign(document.createElement('div'), { className: 's-head' });
  head.append(name, Object.assign(document.createElement('output'), { className: 's-val', htmlFor: id }));
  const track = Object.assign(document.createElement('div'), { className: 's-track' });
  // The "standard" mark under the track is a button: tap it to put this slider back on standard.
  const std = Object.assign(document.createElement('button'), { type: 'button', className: 's-std', textContent: 'standard' });
  std.setAttribute('aria-label', `${s.label}: back to standard`);
  std.onclick = () => {
    if (s.kind === 'pillar') {
      const p = { ...pillarsNow(), [s.key]: stdPillars()[s.key] };
      prefs.tweaks.pillars = PILLAR_KEYS.every((k) => p[k] === stdPillars()[k]) ? null : p;
    } else if (s.kind === 'curve') prefs.tweaks.curveFrom = null;
    else prefs.tweaks.sliders[s.key] = 1;
    prefs.tweaks = cleanTweaks(prefs.tweaks);
    tuningChanged();
  };
  track.append(input, std);
  row.append(head, track, hint, Object.assign(document.createElement('p'), { className: 'small s-weights', hidden: true }));
  const show = () => {
    if (s.kind === 'pillar') { // the shares of all four move together while you drag
      const was = prefs.tweaks.pillars;
      prefs.tweaks.pillars = { ...pillarsNow(), [s.key]: Number(input.value) };
      for (const r of document.querySelectorAll('#t-pillars .slider')) r.querySelector('.s-val').textContent = pillarText(r.dataset.key);
      prefs.tweaks.pillars = was;
    } else row.querySelector('.s-val').textContent = valueText(s, Number(input.value));
    fill(input);
  };
  input.oninput = show;
  guardSlider(track, input);
  input.onchange = () => {
    const v = Number(input.value);
    if (s.kind === 'pillar') {
      const p = { ...pillarsNow(), [s.key]: v };
      prefs.tweaks.pillars = PILLAR_KEYS.every((k) => p[k] === stdPillars()[k]) ? null : p; // back on the standard marks: standard
    }
    else if (s.kind === 'curve') prefs.tweaks.curveFrom = v === footballWeights?.curveFrom ? null : v;
    else prefs.tweaks.sliders[s.key] = multiplierOf(s.key, v);
    prefs.tweaks = cleanTweaks(prefs.tweaks);
    tuningChanged();
  };
  return row;
}

function buildTuning() {
  // Standard resets all of custom scoring (pillars, detailed sliders, top end, boosts).
  $('#t-standard').onclick = () => {
    prefs.tweaks = { ...cleanTweaks(null), on: prefs.tweaks.on };
    tuningChanged();
  };
  $('#t-pillars').replaceChildren(...PILLAR_SLIDERS.map(makeSlider));
  // The detailed sliders, one section per pillar, then the occasion.
  const sections = [...Object.entries(PILLARS).map(([key, p]) => [key, p.label]), [null, 'The occasion']];
  $('#t-sliders').replaceChildren(...sections.map(([pillar, label]) => {
    const sec = Object.assign(document.createElement('section'), { className: 't-group' });
    sec.append(Object.assign(document.createElement('h4'), { textContent: label }));
    const grid = Object.assign(document.createElement('div'), { className: 'sliders' });
    grid.append(...SLIDERS.filter((s) => s.pillar === pillar).map(makeSlider));
    sec.append(grid);
    return sec;
  }));
}

function tuningChanged() {
  savePrefs({ keepPlace: true });
  recompute();
  keepScroll(render);
}

// Marks the standard setting under a slider. The thumb's centre doesn't reach the track's ends,
// so the mark is nudged by up to half a thumb (THUMB px, as in style.css) to sit under it.
const THUMB = 26;
function placeStd(row, value, min, max) {
  const f = (value - min) / (max - min);
  row.querySelector('.s-std').style.left = `calc(${(100 * f).toFixed(2)}% + ${((0.5 - f) * THUMB).toFixed(1)}px)`;
}

// The coloured part of the track, up to the knob (style.css reads --fill).
function fill(input) {
  const f = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
  input.style.setProperty('--fill', `calc(${(100 * f).toFixed(2)}% + ${((0.5 - f) * THUMB).toFixed(1)}px)`);
}

// Sliders are hard to move by accident while scrolling on a phone: only a drag that starts on
// the knob moves one (a tap elsewhere on the track does nothing), and only once the finger has
// gone sideways; a mostly vertical swipe scrolls the page. Keyboards still work as usual.
function guardSlider(track, input) {
  input.style.pointerEvents = 'none'; // the track below handles touches and the mouse instead
  let drag = null;
  const valueAt = (x) => {
    const r = input.getBoundingClientRect();
    const min = Number(input.min), max = Number(input.max), step = Number(input.step);
    const f = Math.min(1, Math.max(0, (x - r.left - THUMB / 2) / (r.width - THUMB)));
    return Math.round((min + f * (max - min)) / step) * step;
  };
  track.addEventListener('pointerdown', (ev) => {
    if (input.disabled) return;
    const r = input.getBoundingClientRect();
    const f = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min));
    const knob = r.left + THUMB / 2 + f * (r.width - THUMB);
    if (Math.abs(ev.clientX - knob) > THUMB) return; // not on the knob
    drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY, moving: false };
  });
  track.addEventListener('pointermove', (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moving) {
      const dx = Math.abs(ev.clientX - drag.x), dy = Math.abs(ev.clientY - drag.y);
      if (dy > 8 && dy > dx) { drag = null; return; } // scrolling, not sliding
      if (dx < 6) return;
      drag.moving = true;
      track.setPointerCapture(ev.pointerId);
    }
    ev.preventDefault();
    const v = valueAt(ev.clientX);
    if (v !== Number(input.value)) {
      input.value = String(v);
      input.dispatchEvent(new Event('input'));
    }
  });
  const end = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const moved = drag.moving;
    drag = null;
    if (moved) input.dispatchEvent(new Event('change'));
  };
  track.addEventListener('pointerup', end);
  track.addEventListener('pointercancel', end);
}

let boostKey = '';
function renderTuning() {
  const t = prefs.tweaks;
  $('#t-on').checked = t.on;
  $('#t-calib').checked = calibrating;
  $('#t-count').hidden = !t.on && !calibrating;
  $('#t-count').textContent = calibrating ? (t.on ? 'on, calibrating' : 'calibrating') : 'on';
  const W = customW ?? footballWeights ?? {};
  $('#t-standard').disabled = !t.on || isStandard(t);
  for (const row of document.querySelectorAll('#tuning .slider')) {
    const s = ALL_SLIDERS.find((x) => x.key === row.dataset.key && x.kind === row.dataset.kind);
    const input = row.querySelector('input');
    const value = s.kind === 'pillar' ? pillarsNow()[s.key] : s.kind === 'curve' ? curveValue() : t.sliders[s.key] * scaleOf(s.key);
    if (document.activeElement !== input || !input.matches(':active')) input.value = String(value);
    input.disabled = !t.on;
    row.querySelector('.s-std').disabled = !t.on;
    row.querySelector('.s-val').textContent = valueText(s, Number(input.value));
    fill(input);
    if (s.kind === 'pillar') placeStd(row, stdPillars()[s.key], 0, PILLAR_MAX);
    else if (s.kind === 'curve') placeStd(row, footballWeights?.curveFrom ?? 2, 0, 9);
    else placeStd(row, scaleOf(s.key), 0, SCALE_MAX);
    // Calibration mode: the weights each slider moves, standard and yours.
    const weights = row.querySelector('.s-weights');
    weights.hidden = !calibrating || !footballWeights || s.kind === 'pillar';
    if (!weights.hidden) {
      const live = s.keys.filter((k) => !(k in footballWeights) && liveWeights && k in liveWeights);
      const liveW = live.length && applyTweaks(liveWeights, t.on ? t : DEFAULT_TWEAKS);
      weights.textContent = [weightsText(s.keys, t.on ? W : footballWeights), ...live.map((k) => `${k} (live) ${n2(liveWeights[k])}${t.on && liveW[k] !== liveWeights[k] ? ` → ${n2(liveW[k])}` : ''}`)].filter(Boolean).join(', ');
    }
  }
  // One row per football competition on the page.
  const comps = [...new Map([...events, ...upcoming].filter((e) => e.sport === 'football').map((e) => [e.comp, e.compName])).entries()]
    .sort((x, y) => x[1].localeCompare(y[1]));
  const key = comps.map(([c]) => c).join();
  if (key !== boostKey) {
    boostKey = key;
    const steps = [];
    for (let v = -BOOST_MAX; v <= BOOST_MAX + 1e-9; v += BOOST_STEP) steps.push(Math.round(v * 10) / 10);
    $('#t-boosts').replaceChildren(...comps.map(([comp, name]) => {
      const label = Object.assign(document.createElement('label'), { textContent: name });
      const sel = document.createElement('select');
      sel.dataset.comp = comp;
      sel.append(...steps.map((v) => new Option(v === 0 ? '0 (standard)' : `${v > 0 ? '+' : ''}${v.toFixed(1)} points`, v)));
      sel.onchange = () => {
        prefs.tweaks.comps[comp] = Number(sel.value);
        prefs.tweaks = cleanTweaks(prefs.tweaks);
        tuningChanged();
      };
      label.append(sel);
      return label;
    }));
  }
  for (const sel of document.querySelectorAll('#t-boosts select')) {
    sel.value = String(t.comps[sel.dataset.comp] ?? 0);
    sel.disabled = !t.on;
  }
  // How many replays got your score.
  const football = events.filter((e) => e.sport === 'football').length;
  $('#t-status').textContent = !t.on
    ? 'Off: you see the standard scores. Turn it on to use the sliders.'
    : factsFailed ? 'Could not load the match facts. Showing the standard scores for now.'
      : !factsFile ? 'Loading the match facts…'
        : `${custom.size} of ${football} football replays re-scored on this device${custom.size < football ? ' (the rest have no saved facts yet and keep the standard score)' : ''}. Live "Excitement so far" uses your settings too.`;
}

function bindTuning() {
  buildTuning();
  $('#t-on').onchange = async (ev) => {
    if (ev.target.checked) {
      ev.target.checked = false;
      if (!calibrating && !(await confirmSpoiler(CONSENT.custom))) return;
      prefs.tweaks.on = true;
      savePrefs({ keepPlace: true });
      renderTuning();
      await ensureFacts();
    } else {
      prefs.tweaks.on = false;
      savePrefs({ keepPlace: true });
    }
    recompute();
    keepScroll(render);
  };
  $('#t-calib').onchange = async (ev) => {
    if (ev.target.checked) {
      ev.target.checked = false;
      if (!(await confirmSpoiler(CONSENT.calibrate))) return;
      calibrating = true;
      await Promise.all([ensureFacts(), ensureResults()]);
      recompute();
      keepScroll(render);
      pollLive(); // the live scores
    } else {
      calibrating = false;
      calcOpen.clear();
      liveScore.clear();
      keepScroll(render);
    }
  };
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
  $('#leagues-box').open = store.load('pt-leagues-open', false); // closed until you open it, then remembered
  $('#leagues-box').ontoggle = () => store.save('pt-leagues-open', $('#leagues-box').open);
  $('#leagues-all').onclick = () => { prefs.leagues = []; savePrefs(); render(); };
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
  bindTuning();
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
    footballWeights = data.footballWeights ?? null;
    sliderScale = data.sliderScale ?? {};
    // Custom scoring or calibration: fetch the facts again when a replay is missing from them (scored since).
    if ((prefs.tweaks.on || calibrating) && (!factsFile || events.some((e) => e.sport === 'football' && !factsFile[e.id]))) await ensureFacts({ force: true });
    if (calibrating && events.some((e) => !resultsFile?.[e.id])) await ensureResults({ force: true });
    recompute();
    for (const id of finished) if (!upcoming.some((e) => e.id === id)) finished.delete(id);
    keepScroll(render); // keeps filters, "Show more" and open panels as they were
    $('#updated').dataset.generated = data.generated;
    $('#updated').textContent = `Updated ${fmt.format(new Date(data.generated))}.`;
  } catch {
    if (!quiet) $('#status').textContent = 'Could not load the event list. Check your connection and reload.';
  }
}

// The install card under the title (like the Substitutor app's). Chrome and Edge fire
// beforeinstallprompt, so "Install" opens their install popup; iPhones and iPads can only
// install from Safari's Share menu, so there it shows the steps. Hidden inside the installed
// app, and for good after ✕ ("Not now", `pt-install-hidden`).
function setupInstall() {
  const installed = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (installed || store.load('pt-install-hidden', false)) return;
  const card = $('#install-card');
  let prompt = null;
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    prompt = e;
    card.hidden = false;
  });
  addEventListener('appinstalled', () => { card.hidden = true; });
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) card.hidden = false;
  $('#install-btn').addEventListener('click', async () => {
    if (prompt) {
      prompt.prompt();
      const { outcome } = await prompt.userChoice;
      prompt = null;
      if (outcome === 'accepted') card.hidden = true;
    } else if (ios) {
      $('#ios-install-dlg').showModal();
    }
  });
  $('#install-hide').addEventListener('click', () => {
    card.hidden = true;
    store.save('pt-install-hidden', true);
  });
  $('#ios-install-close').addEventListener('click', () => $('#ios-install-dlg').close());
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
    note.textContent = 'Link copied. Open it on your other device';
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
  prefs.tweaks = { ...cleanTweaks(prefs.tweaks), on: false }; // sliders travel; switching it on shows its warning here first
  recompute();
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
  fetchData(); // fetches the facts too when custom scoring is on (agreed to on an earlier visit)
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
