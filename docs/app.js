import { SPORTS, tierOf, adviceText, filterEvents, namesHidden, titleOf, subtitleOf, hiddenTitleOf } from './logic.js';

const SERVICES = {
  viaplay: { name: 'Viaplay', url: 'https://viaplay.no/sport' },
  tv2play: { name: 'TV 2 Play', url: 'https://play.tv2.no/sport' },
  hbomax: { name: 'HBO Max', url: 'https://www.hbomax.com/no/no' },
  nrk: { name: 'NRK TV', url: 'https://tv.nrk.no/' },
  f1tv: { name: 'F1 TV', url: 'https://f1tv.formula1.com/' },
};

const DEFAULTS = {
  sport: 'all', services: [], comp: 'all', days: 30, minScore: 0, sort: 'date',
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
let events = [];
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

  const comps = [...new Set(events.filter((e) => prefs.sport === 'all' || e.sport === prefs.sport).map((e) => e.compName))].sort();
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

function render() {
  renderControls();
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

async function load() {
  bind();
  renderControls();
  try {
    const res = await fetch('./data/events.json', { cache: 'no-cache' });
    const data = await res.json();
    events = data.events ?? [];
    render();
    const updated = new Date(data.generated);
    $('.foot').insertAdjacentHTML('beforeend', `<p>Updated ${fmt.format(updated)}.</p>`);
  } catch {
    $('#status').textContent = 'Could not load the event list. Check your connection and reload.';
  }
}

load();
