import { SPORTS, migratePrefs, periodOptions, facets, activeFilters, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, filterEvents, namesHidden, titleOf, f1SessionName, isFavorite, favCount, toggleFav, favNames, searchNames, winterKey, winterLabel, encodeSettings, decodeSettings, subtitleOf, hiddenTitleOf } from './logic.js';

const SERVICES = {
  viaplay: { name: 'Viaplay', url: 'https://viaplay.no/sport' },
  tv2play: { name: 'TV 2 Play', url: 'https://play.tv2.no/sport' },
  hbomax: { name: 'HBO Max', url: 'https://www.hbomax.com/no/no' },
  nrk: { name: 'NRK TV', url: 'https://tv.nrk.no/' },
  f1tv: { name: 'F1 TV', url: 'https://f1tv.formula1.com/' },
};

const DEFAULTS = {
  view: 'replays', sport: 'all', services: [], comp: 'all', days: 30, minScore: 0, sort: 'date',
  round: '', draw: '', f1Session: '', hideTennis: true, hideFootball: false, hints: true, hideWatched: false,
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
let resultsFile = null; // loaded only after the second warning is accepted
let events = [];
let upcoming = [];
const PAGE = 40;
let limit = PAGE; // cards shown; grows with "Show more"

const $ = (sel) => document.querySelector(sel);
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Oslo', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
});

function savePrefs() {
  store.save('pt-prefs', prefs);
  limit = PAGE; // a new filter starts from the top
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
  $('#f-watched').checked = prefs.hideWatched;

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
  savePrefs();
  render();
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
  $('#favs-hint').textContent = !n
    ? 'Tap ☆ after a name on a card, or search below.'
    : prefs.favsOnly && favs.players.length && prefs.view === 'replays' && ['all', 'tennis'].includes(prefs.sport)
      ? 'Tennis players only count under Coming up, so replays don\'t spoil who went through.'
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

// A small ☆ after a name; filled ★ when it's a favorite.
function star(kind, name, label) {
  const on = kind === 'f1' ? prefs.favs.f1 : (prefs.favs[kind] ?? []).includes(name);
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'star', textContent: on ? '★' : '☆' });
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `${on ? 'Unfollow' : 'Follow'} ${label}`);
  b.title = b.getAttribute('aria-label');
  b.onclick = () => setFav(kind, name);
  return b;
}

// The card title, with a star after each team or player (or after the race, to follow F1).
function fillTitle(title, e) {
  if (namesHidden(e, prefs) && !revealed.has(e.id)) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'reveal' });
    b.textContent = `${hiddenTitleOf(e)} — tap to show`;
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
    span.append(name, star(kind, name, name));
    title.append(span);
  });
}

function card(e) {
  const li = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const tier = tierOf(e.score);
  li.dataset.tier = tier.key;
  li.dataset.id = e.id;
  li.classList.toggle('is-watched', watched.has(e.id));
  li.classList.toggle('is-fav', isFavorite(e, prefs.favs, 'replays'));
  li.querySelector('.num').textContent = e.score.toFixed(1);
  li.querySelector('.tier').textContent = tier.label;
  li.querySelector('.sport').textContent = e.sport === 'winter' ? e.compName : SPORTS[e.sport];
  li.querySelector('.when').textContent = fmt.format(new Date(e.start));

  fillTitle(li.querySelector('.title'), e);
  li.querySelector('.sub').textContent = subtitleOf(e);

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
    advice.textContent = adviceText(e.advice);
  }
  strip.hidden = !prefs.hints || !e.segments.length;
  advice.hidden = !prefs.hints;

  li.querySelector('.svc').append(...e.services.map((id) => {
    const s = SERVICES[id];
    const a = Object.assign(document.createElement('a'), { href: s.url, target: '_blank', rel: 'noopener', textContent: s.name });
    a.className = 'pill';
    if (prefs.services.includes(id)) a.classList.add('mine');
    return a;
  }));

  const why = li.querySelector('.why');
  const whyBtn = li.querySelector('.why-btn');
  if (whyShown.has(e.id)) {
    whyBtn.hidden = true;
    why.hidden = false;
    fillWhy(why, e);
  }
  whyBtn.onclick = () => askSpoiler(e.id, 'why');

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
  const reasons = reasonsFile?.[e.id];
  if (!reasons) {
    box.textContent = 'No explanation saved for this event yet.';
    return;
  }
  const { lines, note } = reasonLines(reasons, e.score);
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
  if (resultShown.has(e.id)) {
    // Tennis and F1 results are one line of text; football is {text, goals: ["36' · 0–1 · Name (Team)", …]}.
    const saved = resultsFile?.[e.id] ?? 'No result saved for this event yet.';
    const { text, goals = [] } = typeof saved === 'string' ? { text: saved } : saved;
    const div = Object.assign(document.createElement('div'), { className: 'result' });
    div.append(Object.assign(document.createElement('p'), { className: 'result-text', textContent: text }));
    if (goals.length) {
      const list = Object.assign(document.createElement('ul'), { className: 'goals' });
      for (const g of goals) {
        const li = document.createElement('li');
        li.append(...g.split(' · ').map((part) => Object.assign(document.createElement('span'), { textContent: part })));
        list.append(li);
      }
      div.append(list);
    }
    box.append(div);
  } else {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'why-btn result-btn', textContent: '⚠⚠ Show the result' });
    b.onclick = () => askSpoiler(e.id, 'result');
    box.append(b);
  }
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
  if (!spoilerFiles[level]()) {
    let file = {};
    try { file = await (await fetch(cfg.file, { cache: 'no-cache' })).json(); } catch { /* shown as "not saved" */ }
    if (level === 'why') reasonsFile = file; else resultsFile = file;
  }
  cfg.shown.add(id);
  render();
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

function soonCard(e) {
  const li = $('#soon-tpl').content.firstElementChild.cloneNode(true);
  li.dataset.id = e.id;
  li.classList.toggle('live', e.status === 'live');
  li.classList.toggle('is-fav', isFavorite(e, prefs.favs, 'upcoming'));
  li.querySelector('.time').textContent = e.status === 'live' ? 'LIVE' : timeFmt.format(new Date(e.start));
  li.querySelector('.tier').textContent = e.status === 'live' ? 'now' : '';
  li.querySelector('.sport').textContent = e.sport === 'winter' ? e.compName : SPORTS[e.sport];
  li.querySelector('.comp').textContent = e.sport === 'f1' ? `${f1SessionName(e)} · ${e.circuit}`
    : e.sport === 'winter' ? e.place : e.compName;
  fillTitle(li.querySelector('.title'), e);
  li.querySelector('.sub').textContent = e.sport === 'tennis' ? subtitleOf(e) : '';
  li.querySelector('.sub').hidden = e.sport !== 'tennis'; // the meta line already says it
  li.querySelector('.svc').append(...e.services.map((id) => {
    const a = Object.assign(document.createElement('a'), { href: SERVICES[id].url, target: '_blank', rel: 'noopener', textContent: SERVICES[id].name });
    a.className = 'pill';
    if (prefs.services.includes(id)) a.classList.add('mine');
    return a;
  }));
  return li;
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
  $('.more')?.remove();
  if (list.length > limit) {
    const more = Object.assign(document.createElement('button'), { type: 'button', className: 'more' });
    more.textContent = `Show more (${list.length - limit} left)`;
    more.onclick = () => { limit += PAGE; render(); };
    $('#cards').after(more);
  }
  $('#status').textContent = list.length
    ? `${list.length} coming up. No scores here: they appear under Replays once the event has finished.`
    : prefs.favsOnly ? 'None of your favorites are coming up. Turn off “Only favorites” to see everything.' : 'Nothing coming up that matches these filters.';
}

function render() {
  renderControls();
  if (prefs.view === 'upcoming') return renderUpcoming();
  const list = filterEvents(events, prefs, watched);
  $('#cards').replaceChildren(...list.slice(0, limit).map(card));
  $('.more')?.remove();
  if (list.length > limit) {
    const more = Object.assign(document.createElement('button'), { type: 'button', className: 'more' });
    more.textContent = `Show more (${list.length - limit} left)`;
    more.onclick = () => { limit += PAGE; render(); };
    $('#cards').after(more);
  }
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
  on('#f-watched', 'hideWatched');
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
    render(); // keeps filters and "Show more" as they were
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
  if (!data) {
    dlg.querySelector('h2').textContent = 'This settings link is broken';
    dlg.querySelector('.dlg-text').textContent = 'Try copying it again from your other device.';
    dlg.querySelector('button[value="ok"]').hidden = true;
    dlg.showModal();
    return;
  }
  const f = { ...DEFAULTS.favs, ...data.prefs.favs };
  const favN = f.teams.length + f.players.length + (f.f1 ? 1 : 0);
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
  window.primetimeStarted = true; // tells the safety net in index.html that the app is running
  setupInstall();
  bind();
  renderControls();
  fetchData();
  importSettings();
  addEventListener('hashchange', importSettings); // a link opened while the page is already open
  setInterval(() => document.visibilityState === 'visible' && fetchData({ quiet: true }), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > REFRESH_MS) fetchData({ quiet: true });
  });
}

load();
