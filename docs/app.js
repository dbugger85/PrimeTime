import { SPORTS, filterUpcoming, dayLabel, tierOf, adviceText, skipShades, reasonLines, filterEvents, namesHidden, titleOf, subtitleOf, hiddenTitleOf } from './logic.js';

const SERVICES = {
  viaplay: { name: 'Viaplay', url: 'https://viaplay.no/sport' },
  tv2play: { name: 'TV 2 Play', url: 'https://play.tv2.no/sport' },
  hbomax: { name: 'HBO Max', url: 'https://www.hbomax.com/no/no' },
  nrk: { name: 'NRK TV', url: 'https://tv.nrk.no/' },
  f1tv: { name: 'F1 TV', url: 'https://f1tv.formula1.com/' },
};

const DEFAULTS = {
  view: 'replays', sport: 'all', services: [], comp: 'all', days: 30, minScore: 0, sort: 'date',
  round: '', draw: '', names: 'tennis', hints: true, hideWatched: false,
};

const store = {
  load(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
  },
};

const prefs = { ...DEFAULTS, ...store.load('pt-prefs', {}) };
const watched = new Set(store.load('pt-watched', []));
const revealed = new Set(); // names revealed this visit only
const whyShown = new Set(); // "Why this score?" opened this visit only
let reasonsFile = null; // loaded only after the spoiler warning is accepted
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

function renderControls() {
  for (const b of document.querySelectorAll('#views button')) {
    b.setAttribute('aria-pressed', String(b.dataset.view === prefs.view));
  }
  document.body.dataset.view = prefs.view;
  for (const b of document.querySelectorAll('#sports button')) {
    b.setAttribute('aria-pressed', String(b.dataset.sport === prefs.sport));
  }
  $('#services').replaceChildren(...Object.entries(SERVICES).map(([id, s]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s.name;
    b.setAttribute('aria-pressed', String(prefs.services.includes(id)));
    b.onclick = () => {
      prefs.services = prefs.services.includes(id) ? prefs.services.filter((x) => x !== id) : [...prefs.services, id];
      savePrefs();
      render();
    };
    return b;
  }));

  const pool = prefs.view === 'upcoming' ? upcoming : events;
  const comps = [...new Set(pool.filter((e) => prefs.sport === 'all' || e.sport === prefs.sport).map((e) => e.compName))].sort();
  if (prefs.comp !== 'all' && !comps.includes(prefs.comp)) prefs.comp = 'all';
  $('#f-comp').replaceChildren(new Option('All', 'all'), ...comps.map((c) => new Option(c, c)));
  $('#f-comp').value = prefs.comp;
  $('#f-days').value = String(prefs.days);
  $('#f-min').value = String(prefs.minScore);
  $('#f-sort').value = prefs.sort;
  $('#f-round').value = prefs.round;
  $('#f-draw').value = prefs.draw;
  $('#f-names').value = prefs.names;
  $('#f-hints').checked = prefs.hints;
  $('#f-watched').checked = prefs.hideWatched;
  document.body.dataset.sport = prefs.sport;
}

function card(e) {
  const li = $('#card-tpl').content.firstElementChild.cloneNode(true);
  const tier = tierOf(e.score);
  li.dataset.tier = tier.key;
  li.dataset.id = e.id;
  li.classList.toggle('is-watched', watched.has(e.id));
  li.querySelector('.num').textContent = e.score.toFixed(1);
  li.querySelector('.tier').textContent = tier.label;
  li.querySelector('.sport').textContent = SPORTS[e.sport];
  li.querySelector('.when').textContent = fmt.format(new Date(e.start));

  const title = li.querySelector('.title');
  if (namesHidden(e, prefs.names) && !revealed.has(e.id)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'reveal';
    b.textContent = `${hiddenTitleOf(e)} — tap to show`;
    b.onclick = () => { revealed.add(e.id); render(); };
    title.append(b);
  } else {
    title.textContent = titleOf(e);
  }
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
  whyBtn.onclick = () => askSpoiler(e.id);

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
}

async function askSpoiler(id) {
  const dlg = $('#spoiler-dlg');
  dlg.returnValue = '';
  dlg.showModal();
  await new Promise((r) => dlg.addEventListener('close', r, { once: true }));
  if (dlg.returnValue !== 'ok') return;
  if (!reasonsFile) {
    try {
      reasonsFile = await (await fetch('./data/reasons.json', { cache: 'no-cache' })).json();
    } catch {
      reasonsFile = {};
    }
  }
  whyShown.add(id);
  render();
}

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Oslo', hour: '2-digit', minute: '2-digit' });

function soonCard(e) {
  const li = $('#soon-tpl').content.firstElementChild.cloneNode(true);
  li.dataset.id = e.id;
  li.classList.toggle('live', e.status === 'live');
  li.querySelector('.time').textContent = e.status === 'live' ? 'LIVE' : timeFmt.format(new Date(e.start));
  li.querySelector('.tier').textContent = e.status === 'live' ? 'now' : '';
  li.querySelector('.sport').textContent = SPORTS[e.sport];
  li.querySelector('.comp').textContent = e.sport === 'f1' ? e.circuit : e.compName;
  const title = li.querySelector('.title');
  if (namesHidden(e, prefs.names) && !revealed.has(e.id)) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'reveal' });
    b.textContent = `${hiddenTitleOf(e)} — tap to show`;
    b.onclick = () => { revealed.add(e.id); render(); };
    title.append(b);
  } else {
    title.textContent = titleOf(e);
  }
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
    : 'Nothing coming up that matches these filters.';
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
    ? (list.length ? shown : 'Nothing matches these filters. Try a longer period or fewer filters.')
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
  on('#f-comp', 'comp');
  on('#f-days', 'days', Number);
  on('#f-min', 'minScore', Number);
  on('#f-sort', 'sort');
  on('#f-round', 'round');
  on('#f-draw', 'draw');
  on('#f-names', 'names');
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

function load() {
  bind();
  renderControls();
  fetchData();
  setInterval(() => document.visibilityState === 'visible' && fetchData({ quiet: true }), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastFetch > REFRESH_MS) fetchData({ quiet: true });
  });
}

load();
