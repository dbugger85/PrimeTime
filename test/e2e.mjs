// Browser test on a phone-sized screen, using the real docs/data/events.json.
//
//   npm install && npm run e2e                                    # tests local files
//   BASE_URL=https://dbugger85.github.io/PrimeTime/ npm run e2e   # tests the live site
//
// Needs Chromium (CHROMIUM=/path/to/chromium if not /usr/bin/chromium).
// Screenshots go to test/screenshots/ (ignored by git).

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { liveWeightsFrom } from '../docs/live.js';
import * as WEIGHTS from '../src/scoring/weights.mjs';

// Services and custom scoring live inside "Filters and settings": open it first when it's closed.
const openSettings = async (page) => { if (!(await page.$eval('#filters', (d) => d.open))) await page.click('#filters summary'); };
const docs = fileURLToPath(new URL('../docs', import.meta.url));
const shots = fileURLToPath(new URL('./screenshots', import.meta.url));
mkdirSync(shots, { recursive: true });

let server = null;
let base = process.env.BASE_URL;
if (!base) {
  server = spawn('python3', ['-m', 'http.server', '8766', '--bind', '127.0.0.1'], { cwd: docs, stdio: 'ignore' });
  base = 'http://127.0.0.1:8766/';
  for (let i = 0; i < 50; i++) {
    try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
}

// Follows a team, player or sport with the search box in "My favorites" (cards only
// show a ★ for things you follow). `label` is the suggestion's text if it's not `query`.
async function follow(page, query, label = query) {
  if (await page.$eval('#favs-body', (e) => e.hidden)) await page.click('#favs-toggle');
  await page.fill('#fav-q', query);
  await page.click(`#fav-hits .chip:has-text("${label}")`);
  await page.fill('#fav-q', '');
}

// Line-ups stay closed until the button is tapped, then show 11 players per team.
async function checkLineups(page, name) {
  const card = await page.$('.card:has(.lineup-btn:not([hidden]))');
  if (!card) return console.log(`no ${name} card with line-ups to test`);
  assert.ok(await card.$eval('.lineups', (e) => e.hidden), 'line-ups start closed');
  await card.$eval('.lineup-btn', (e) => e.scrollIntoView({ block: 'start' }));
  await (await card.$('.lineup-btn')).click();
  const open = await page.$(`.card[data-id="${await card.getAttribute('data-id')}"]`);
  assert.equal(await open.$eval('.lineup-btn', (e) => e.getAttribute('aria-expanded')), 'true');
  assert.equal(await open.$$eval('.lineups li', (els) => els.length), 22, '11 players per team');
  assert.equal(await open.$$eval('.lineups .bench', (els) => els.length), 0, 'benches start closed');
  await open.screenshot({ path: `${shots}/lineups-${name}.png` });
  const benchBtn = await open.$('.bench-btn');
  if (benchBtn) {
    await benchBtn.click();
    const opened = await page.$(`.card[data-id="${await open.getAttribute('data-id')}"]`);
    assert.equal(await opened.$$eval('.lineups .bench', (els) => els.length), 1, 'only that team\'s bench opens');
    await opened.screenshot({ path: `${shots}/lineups-${name}-bench.png` });
  }
  await (await page.$(`.card[data-id="${await open.getAttribute('data-id')}"] .lineup-btn`)).click();
  assert.ok(await page.$eval(`.card[data-id="${await open.getAttribute('data-id')}"] .lineups`, (e) => e.hidden), 'tapping again closes them');
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium' });
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
    const errors = [];
    const reasonRequests = [];
    const resultRequests = [];
    page.on('request', (r) => r.url().includes('reasons.json') && reasonRequests.push(r.url()));
    page.on('request', (r) => r.url().includes('results.json') && resultRequests.push(r.url()));
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.card');
    await page.screenshot({ path: `${shots}/home-${scheme}.png` });

    const cards = await page.$$eval('.card', (els) => els.length);
    assert.ok(cards > 0 && cards <= 40, `first page shows up to 40 cards, got ${cards}`);

    // No result-like text in the card titles or subtitles (skip tips like "laps 4–15" are fine).
    const text = await page.$$eval('.title, .sub', (els) => els.map((e) => e.textContent).join('\n'));
    assert.doesNotMatch(text, /\b\d+\s*[-–]\s*\d+\b/, 'something that looks like a score is shown');

    if (scheme === 'dark') {
      assert.deepEqual(errors, []);
      await page.close();
      continue;
    }

    // Sport tabs.
    for (const sport of ['football', 'tennis', 'f1']) {
      await page.click(`#sports [data-sport="${sport}"]`);
      const metas = await page.$$eval('.card .sport', (els) => [...new Set(els.map((e) => e.textContent))]);
      assert.ok(metas.length <= 1, `${sport} tab shows only ${sport}`);
      await page.screenshot({ path: `${shots}/${sport}.png` });
    }

    // F1: races and qualifying, with a filter for each.
    await page.click('#sports [data-sport="f1"]');
    await page.click('#filters summary');
    await page.selectOption('#f-days', '400');
    await page.selectOption('#f-f1session', 'qualifying');
    const qTitles = await page.$$eval('.card .title', (els) => els.map((e) => e.textContent));
    if (qTitles.length) {
      assert.ok(qTitles.every((t) => /qualifying/.test(t)), 'only qualifying shows');
      assert.match(await page.$eval('.card .sub', (e) => e.textContent), /^Formula 1 · Qualifying · /);
      await page.$eval('.card', (e) => e.scrollIntoView());
      await page.screenshot({ path: `${shots}/f1-qualifying.png` });
    }
    await page.selectOption('#f-f1session', 'sprint');
    const sTitles = await page.$$eval('.card .title', (els) => els.map((e) => e.textContent));
    if (sTitles.length) {
      assert.ok(sTitles.every((t) => /sprint/.test(t)), 'only sprints and sprint qualifying show');
      await page.$eval('.card', (e) => e.scrollIntoView());
      await page.screenshot({ path: `${shots}/f1-sprint.png` });
    }
    await page.selectOption('#f-f1session', 'race');
    assert.ok((await page.$$eval('.card .title', (els) => els.map((e) => e.textContent))).every((t) => !/qualifying/.test(t)));
    await page.selectOption('#f-f1session', '');
    await page.click('#filters summary');

    // Winter: one tab, chips per sport, a gender filter, and favorites per sport and gender.
    await page.click('#sports [data-sport="winter"]');
    await page.click('#filters summary');
    await page.selectOption('#f-days', '400');
    if (await page.$('.card')) {
      const chips = await page.$$eval('#comps .chip', (els) => els.map((e) => e.firstChild.textContent));
      assert.ok(chips.includes('Biathlon') && chips.includes('Alpine'), `winter chips: ${chips}`);
      await page.click('#comps .chip:has-text("Biathlon")');
      assert.ok((await page.$$eval('.card .sport', (els) => els.map((e) => e.textContent))).every((t) => t === 'Biathlon'));
      await page.selectOption('#f-gender', 'women');
      assert.ok((await page.$$eval('.card .title', (els) => els.map((e) => e.textContent))).every((t) => /^Women/.test(t)));
      await page.$eval('.card', (e) => e.scrollIntoView());
      await page.screenshot({ path: `${shots}/winter.png` });
      await follow(page, 'biathlon', 'Biathlon (women)');
      assert.ok(await page.$('#favs .fav:has-text("Biathlon (women)")'), 'following a winter sport');
      assert.ok(await page.$('.card .title .star'), 'its cards get a ★');
      await page.click('#favs .fav:has-text("Biathlon (women)")');
      await page.selectOption('#f-gender', '');
      await page.click('#comps .chip:has-text("All")');
    }
    await page.click('#filters summary');

    // Tennis names are hidden until tapped.
    await page.click('#sports [data-sport="tennis"]');
    await page.click('#filters summary');
    await page.selectOption('#f-days', '400');
    if (await page.$('.card .reveal')) {
      await page.click('.card .reveal');
      const title = await page.$eval('.card .title', (e) => e.textContent);
      assert.match(title, / vs /);
    }

    // Dynamic filters: each tab only offers what applies to it.
    await page.click('#sports [data-sport="f1"]');
    const f1Services = await page.$$eval('#services .chip', (els) => els.map((e) => e.firstChild.textContent));
    assert.deepEqual(f1Services, ['Viaplay', 'F1 TV']);
    assert.ok(await page.$eval('#comps', (e) => e.hidden), 'no competition chips for F1');
    assert.ok(await page.$eval('#f-round', (e) => e.closest('label').hidden), 'tennis rounds hidden on F1');
    await page.click('#sports [data-sport="football"]');
    assert.ok(!(await page.$eval('#comps', (e) => e.hidden)), 'competition chips for football');
    assert.deepEqual(await page.$$eval('#f-days option', (els) => els.map((e) => e.value)), ['7', '30']);
    await page.click('#comps .chip:nth-child(2)');
    const comp = await page.$eval('#comps .chip[aria-pressed="true"]', (e) => e.firstChild.textContent);
    const shownComps = await page.$$eval('.card .sub', (els) => [...new Set(els.map((e) => e.textContent.split(' · ')[0]))]); // stakes tags follow the name
    assert.deepEqual(shownComps, [comp]);
    assert.equal(await page.$eval('#filter-count', (e) => e.textContent), '1 on');
    await page.screenshot({ path: `${shots}/football-filtered.png` });
    await page.click('#f-reset');
    assert.ok(await page.$eval('#filter-count', (e) => e.hidden));

    // "My competitions": following one competition hides the others' football (no favorites yet).
    await openSettings(page);
    const league = await page.$eval('#leagues .chip', (e) => e.firstChild.textContent);
    await page.click('#leagues .chip');
    assert.match(await page.$eval('#leagues-hint', (e) => e.textContent), /^1 of \d+$/);
    const followed = await page.$$eval('.card .sub', (els) => [...new Set(els.map((e) => e.textContent.split(' · ')[0]))]);
    assert.deepEqual(followed, [league]);
    await (await page.$('.leagues')).screenshot({ path: `${shots}/my-competitions.png` });
    await page.click('#leagues-all');
    assert.ok(await page.$eval('#leagues-all', (e) => e.hidden));
    await page.click('#filters summary');

    // Services filter: with only HBO Max chosen (tennis), the F1 tab is empty. Between Grand Slams the
    // default period can hold no tennis at all, and then there's no chip to choose.
    await page.click('#sports [data-sport="tennis"]');
    await openSettings(page);
    if (await page.locator('#services .chip:has-text("HBO Max")').count()) {
      await page.click('#services .chip:has-text("HBO Max")');
      await page.click('#sports [data-sport="f1"]');
      assert.equal(await page.$$eval('.card', (els) => els.length), 0);
      await page.click('#sports [data-sport="tennis"]');
      await page.click('#services .chip:has-text("HBO Max")');
    } else console.log('no tennis in the default period: the services filter is not tested');

    // Skip tips can be switched off.
    await page.uncheck('#f-hints');
    assert.equal(await page.$$eval('.advice:not([hidden])', (els) => els.length), 0);
    await page.check('#f-hints');

    // "Why this score?" warns first, and the spoiler file isn't even downloaded until you agree.
    await page.click('#sports [data-sport="football"]');
    assert.equal(reasonRequests.length, 0, 'reasons.json loaded before any warning');
    await page.click('.card .why-btn');
    await page.waitForSelector('#spoiler-dlg[open]');
    await page.screenshot({ path: `${shots}/spoiler-warning.png` });
    await page.click('#spoiler-dlg button[value="cancel"]');
    assert.equal(reasonRequests.length, 0, 'reasons.json loaded after cancelling');
    assert.equal(await page.$$eval('.why:not([hidden])', (els) => els.length), 0);
    await page.click('.card .why-btn');
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForSelector('.why:not([hidden]) li');
    assert.equal(await page.$$eval('.why:not([hidden])', (els) => els.length), 1, 'only the tapped card is revealed');
    await page.screenshot({ path: `${shots}/spoiler-shown.png` });
    assert.equal(resultRequests.length, 0, 'results.json loaded before the second warning');

    // Second level: the actual result, behind a second warning.
    await page.click('.why:not([hidden]) .result-btn');
    await page.waitForSelector('#spoiler-dlg[open]');
    assert.match(await page.$eval('#spoiler-dlg h2', (e) => e.textContent), /result/i);
    await page.click('#spoiler-dlg button[value="cancel"]');
    assert.equal(resultRequests.length, 0, 'results.json loaded after cancelling');
    await page.click('.why:not([hidden]) .result-btn');
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForSelector('.why .result');
    assert.equal(await page.$$eval('.why .result', (els) => els.length), 1);
    await page.screenshot({ path: `${shots}/result-shown.png` });
    if (await page.$('.why .subs-btn')) { // football: substitutions stay closed until tapped
      assert.equal(await page.$$eval('.why .subs', (els) => els.length), 0, 'substitutions start closed');
      await page.click('.why .subs-btn');
      assert.ok(await page.$$eval('.why .subs li', (els) => els.length) > 0);
      await page.$eval('.why .result', (e) => e.scrollIntoView());
      await page.screenshot({ path: `${shots}/result-subs.png` });
    }
    // ✕ hides the spoilers again, and they come back only through the warning.
    const shownId = await page.$eval('.why:not([hidden])', (e) => e.closest('.card').dataset.id);
    await page.click('.why:not([hidden]) .why-close');
    assert.equal(await page.$$eval('.why:not([hidden])', (els) => els.length), 0, 'spoilers still shown after ✕');
    await page.click(`.card[data-id="${shownId}"] .why-btn`);
    await page.waitForSelector('#spoiler-dlg[open]');
    await page.click('#spoiler-dlg button[value="ok"]');
    assert.equal(await page.$$eval('.why .result', (els) => els.length), 0, 'the result came back without its own warning');

    // Coming up: no scores, just times (or LIVE) and services, grouped by day.
    await page.click('#views [data-view="upcoming"]');
    await page.click('#sports [data-sport="all"]');
    if (await page.$('.card.soon')) {
      assert.equal(await page.$$eval('.card .num', (els) => els.length), 0, 'a score is shown on an upcoming event');
      assert.ok(await page.$('.day'));
      await page.screenshot({ path: `${shots}/upcoming.png` });
    }
    await checkLineups(page, 'upcoming');
    // Pre-match hints: one quiet line on some football cards, gone when switched off.
    await page.click('#sports [data-sport="football"]');
    const hints = await page.$$eval('.card.soon .sub:not([hidden])', (els) => els.map((e) => e.textContent));
    assert.ok(hints.every((t) => /^(Title race|Relegation battle|Top-4 race|Top-8 race|European spots|Play-off spots|Top of the group|Qualifying race|Looks even on paper|Could be lively|Looks one-sided|Promising|Could be quiet)/.test(t)), `odd hint: ${hints}`);
    assert.doesNotMatch(hints.join(' '), /\d|%/, 'no numbers in the hints');
    if (hints.length) {
      await page.$eval('.card.soon:has(.sub:not([hidden]))', (e) => e.scrollIntoView({ block: 'start' }));
      await page.screenshot({ path: `${shots}/upcoming-hints.png` });
      const wasOpen = await page.$eval('#filters', (d) => d.open);
      await page.$eval('#filters', (d) => { d.open = true; });
      await page.click('#f-prehints');
      assert.equal(await page.$$eval('.card.soon .sub:not([hidden])', (els) => els.length), 0, 'switch hides the hints');
      await page.click('#f-prehints');
      await page.$eval('#filters', (d, open) => { d.open = open; }, wasOpen);
    }
    // "Show win chances": off by default; on, one line per upcoming football match with odds.
    assert.equal(await page.$$eval('.card.soon .chances:not([hidden])', (els) => els.length), 0, 'no chances by default');
    await page.$eval('#filters', (d) => { d.open = true; });
    await page.click('#f-chances');
    const chances = await page.$$eval('.card.soon .chances:not([hidden])', (els) => els.map((e) => e.textContent));
    assert.ok(chances.length && chances.every((t) => /^Win chance: .+ \d+% · draw \d+% · .+ \d+%$/.test(t)), `odd chances: ${chances.slice(0, 3)}`);
    await page.$eval('.card.soon:has(.chances:not([hidden]))', (e) => e.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${shots}/upcoming-chances.png` });
    await page.click('#f-chances');
    await page.$eval('#filters', (d) => { d.open = false; });
    await page.click('#sports [data-sport="all"]');
    await page.click('#views [data-view="replays"]');
    await page.waitForSelector('.card .num');
    // "Show Elo ratings": off by default; on, a number in brackets after football team names.
    assert.equal(await page.$$eval('.title .elo', (els) => els.length), 0, 'no ratings by default');
    await page.$eval('#filters', (d) => { d.open = true; });
    await page.click('#f-elo');
    const elos = await page.$$eval('.title .elo', (els) => els.map((e) => e.textContent));
    assert.ok(elos.length && elos.every((t) => /^ \(\d{3,4}\)$/.test(t)), `odd Elo: ${elos.slice(0, 5)}`);
    await page.screenshot({ path: `${shots}/elo-ratings.png` });
    await page.click('#f-elo');
    await page.$eval('#filters', (d) => { d.open = false; });
    await checkLineups(page, 'replay');
    // Direct links: a ▶ on the button, straight to the match on the service's own site.
    const direct = await page.$$eval('.card .svc a.pill:has(.go)', (els) => els.map((a) => a.href));
    if (direct.length) assert.ok(direct.every((u) => /^https:\/\/(play\.tv2\.no|viaplay\.no|tv\.nrk\.no)\//.test(u)), `odd direct link: ${direct[0]}`);

    // Starring a team after "Show more" keeps your place (it used to jump back to 40 cards).
    await page.click('#sports [data-sport="football"]');
    if (await page.$('.more')) {
      await page.click('.more');
      const shownBefore = await page.$$eval('#cards > .card', (els) => els.length);
      const lastTeam = await page.$eval('#cards > .card:last-child .title .name', (e) => e.dataset.name);
      await follow(page, lastTeam);
      assert.equal(await page.$$eval('#cards > .card', (els) => els.length), shownBefore, 'still the same cards after following');
      await page.click(`#favs .fav:has-text("${lastTeam}")`); // unfollow again
      await page.click('#sports [data-sport="all"]');
      await page.click('#sports [data-sport="football"]');
    }

    // Favorites: no stars until you follow something; follow a team, filter to favorites only, search, remove.
    assert.ok(await page.$eval('#fav-only', (e) => e.disabled), '"Only favorites" is off until you have one');
    assert.equal(await page.$$eval('.card .star', (els) => els.length), 0, 'no stars on names you don\'t follow');
    const team = await page.$eval('.card .title .name', (e) => e.dataset.name);
    const other = await page.$eval('.card .title .name:nth-child(2)', (e) => e.dataset.name);
    await follow(page, team);
    assert.equal(await page.$eval('.card .title .name .star', (e) => e.textContent), '★');
    const named = await page.$eval('.card .title .name', (e) => e.textContent);
    assert.ok(named === `${team}★` || new RegExp(`^${team.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(\\d+\\)★$`).test(named), `the star sits right after the name (and its Elo): ${named}`);
    await page.click('#fav-only');
    const titles = await page.$$eval('.card .title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.length > 0 && titles.every((t) => t.includes(team)), `only ${team} matches show`);
    await page.screenshot({ path: `${shots}/favorites.png` });

    // Calendar: closed until tapped, then a webcal link to a feed that exists.
    assert.ok(await page.$eval('#cal-body', (e) => e.hidden), 'calendar starts closed');
    await page.click('#cal-btn');
    const feed = await page.$eval('#cal-links a', (a) => a.href);
    assert.match(feed, /^webcal:\/\/.+\/cal\/[a-z0-9-]+\.ics$/);
    if (process.env.BASE_URL || existsSync(new URL('../docs/cal/', import.meta.url))) { // made by the bot, or a local build
      const res = await page.evaluate(async (u) => { const r = await fetch(u); return [r.status, (await r.text()).slice(0, 15)]; }, feed.replace(/^webcal:/, new URL(base).protocol));
      assert.deepEqual(res, [200, 'BEGIN:VCALENDAR'], `${feed} is served`);
    }
    await page.$eval('#cal', (e) => e.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: `${shots}/favorites-calendar.png` });
    await page.click('#cal-btn');
    await page.$eval('.card', (e) => e.scrollIntoView());
    await page.screenshot({ path: `${shots}/favorites-cards.png` });
    await page.fill('#fav-q', 'f1');
    await page.click('#fav-hits .chip:has-text("F1")');
    await page.click('#sports [data-sport="f1"]');
    assert.ok((await page.$$eval('.card', (els) => els.length)) > 0, 'followed F1 races show');
    await page.click('#favs .fav:has-text("F1")');
    assert.equal(await page.$$eval('.card', (els) => els.length), 0, 'unfollowed F1 races are gone');
    await page.fill('#fav-q', other.slice(0, 4));
    assert.ok(await page.$(`#fav-hits .chip:has-text("${other}")`), 'search suggests the other team');
    await page.fill('#fav-q', team);
    assert.match(await page.$eval('#fav-hits', (e) => e.textContent), /Already/);
    await page.fill('#fav-q', other.slice(0, 4));
    await page.screenshot({ path: `${shots}/favorites-search.png` });
    await page.fill('#fav-q', '');
    await page.click(`#favs .fav:has-text("${team}")`);
    assert.ok(await page.$eval('#fav-only', (e) => e.disabled && e.getAttribute('aria-pressed') === 'false'), 'removing the last favorite turns the filter off');
    // The section folds up, but "Only favorites" stays reachable, and it remembers.
    await page.click('#sports [data-sport="football"]');
    await follow(page, team);
    await page.click('#favs-toggle');
    assert.ok(await page.$eval('#favs-body', (e) => e.hidden));
    assert.ok(await page.$eval('#fav-only', (e) => !e.disabled && e.offsetParent !== null));
    assert.equal(await page.$eval('#favs-count', (e) => e.textContent), '1');
    await page.screenshot({ path: `${shots}/favorites-closed.png` });
    await page.reload();
    await page.waitForSelector('.card');
    assert.ok(await page.$eval('#favs-body', (e) => e.hidden), 'stays folded after a reload');
    await page.click('#favs-toggle');
    await page.click('#favs .fav');
    await page.click('#sports [data-sport="all"]');

    // Mark watched survives a reload.
    const firstId = await page.$eval('.card', (e) => e.dataset.id);
    await page.click('.card .watched');
    await page.reload();
    await page.waitForSelector('.card');
    assert.ok(await page.$eval(`.card[data-id="${firstId}"]`, (e) => e.classList.contains('is-watched')));

    // Installable as an app: Chrome's own check finds nothing missing, and every icon loads.
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    // The test browser is always incognito, which Chrome never installs from; anything else is our fault.
    const problems = installabilityErrors.map((e) => e.errorId).filter((id) => id !== 'in-incognito');
    assert.deepEqual(problems, [], 'the page is not installable');
    const manifest = await (await fetch(new URL('manifest.webmanifest', base))).json();
    for (const icon of manifest.icons) {
      assert.ok((await fetch(new URL(icon.src, base))).ok, `icon ${icon.src} is missing`);
    }
    assert.ok(await page.$eval('#install-card', (e) => e.hidden), 'the install card shows without an install offer (not iPhone, no beforeinstallprompt)');

    assert.deepEqual(errors, []);
    await page.close();
  }

  // "Share my settings": copy the link on one device, open it on another (a fresh browser profile).
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
    await ctx.addInitScript(() => { delete Navigator.prototype.share; }); // use the "copy" path
    const one = await ctx.newPage();
    await one.goto(base);
    await one.waitForSelector('.card');
    await one.click('#sports [data-sport="football"]');
    const team = await one.$eval('.card .title .name', (e) => e.dataset.name);
    await follow(one, team);
    await one.click('.card .watched');
    await one.click('#share-btn');
    await one.waitForSelector('#share-note:has-text("copied")');
    const link = await one.evaluate(() => navigator.clipboard.readText());
    assert.match(link, /#s=[\w-]+$/);

    const other = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
    await other.goto(link);
    await other.waitForSelector('#import-dlg[open]');
    assert.match(await other.$eval('#import-dlg .dlg-text', (e) => e.textContent), /1 favorite, 0 streaming services and 1 watched mark/);
    await other.screenshot({ path: `${shots}/import-settings.png` });
    await other.click('#import-dlg button[value="ok"]');
    await other.waitForSelector('#favs .fav');
    assert.equal(await other.$eval('#favs .fav', (e) => e.firstChild.textContent), team);
    assert.equal(await other.$eval('#sports [aria-pressed="true"]', (e) => e.dataset.sport), 'football');
    assert.equal(new URL(other.url()).hash, '', 'the address bar is tidied');
    assert.equal(await other.$$eval('.card.is-watched', (els) => els.length), 1);
    await other.goto(base + '#s=abc');
    await other.waitForSelector('#import-dlg[open]');
    assert.match(await other.$eval('#import-dlg h2', (e) => e.textContent), /broken/);
    await other.close();
    await ctx.close();
  }

  // "Glass look": on by default, can be switched off, and stays off after a reload (no flash of glass).
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.card');
    assert.ok(await page.$eval('body', (b) => b.classList.contains('glass')), 'glass is on by default');
    await page.click('.filters summary');
    assert.ok(await page.$eval('#f-glass', (e) => e.checked));
    await page.click('#f-glass');
    assert.ok(!(await page.$eval('body', (b) => b.classList.contains('glass'))), 'glass still on after switching it off');
    await page.reload();
    assert.ok(!(await page.$eval('body', (b) => b.classList.contains('glass'))), 'glass came back after a reload');
    await page.waitForSelector('.card');
    await page.screenshot({ path: `${shots}/glass-off.png` });
    await page.close();
  }

  // Custom scoring (football): off by default, the facts file only after the warning, your scores
  // marked on the cards and used for sorting, competition boosts, reset, and calibration mode.
  if (existsSync(`${docs}/data/facts.json`) || process.env.BASE_URL) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    const errors = [];
    const factRequests = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => r.url().includes('facts.json') && factRequests.push(r.url()));
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.click('#sports [data-sport="football"]');
    await page.waitForSelector('.card');
    await openSettings(page);
    await page.click('#tuning summary');
    assert.ok(await page.$eval('#t-s-goals', (e) => e.disabled), 'sliders work only when it is on');
    assert.equal(await page.$$eval('#t-pillars .slider', (els) => els.length), 4, 'four pillar sliders');
    assert.equal(await page.$$eval('#t-pillars .s-hint', (els) => els.filter((e) => e.textContent.length > 20 && e.hidden).length), 4, 'each pillar has a description, folded away');
    await page.click('#t-pillars .s-info');
    assert.ok(await page.$eval('#t-pillars .s-hint', (e) => !e.hidden), 'ⓘ shows the description');
    await page.click('#t-pillars .s-info');
    assert.equal(await page.$$eval('#t-sliders .slider', (els) => els.length), 13, '12 detailed sliders and the top end');
    assert.deepEqual(await page.$$eval('#t-sliders h4', (els) => els.map((e) => e.textContent)), ['Chances', 'Tempo', 'Tension', 'Drama', 'The occasion']);
    assert.equal(await page.$$eval('.card.custom', (els) => els.length), 0);
    await page.click('#t-on');
    await page.waitForSelector('#spoiler-dlg[open]');
    await page.click('#spoiler-dlg button[value="cancel"]');
    assert.ok(!(await page.$eval('#t-on', (e) => e.checked)), 'still off after cancelling');
    assert.equal(factRequests.length, 0, 'facts.json loaded before agreeing');
    await page.click('#t-on');
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForSelector('.card.custom');
    assert.equal(factRequests.length, 1);
    // Standard sliders: every re-scored card shows the same number as the standard one.
    const pairs = () => page.$$eval('.card.custom', (els) => els.map((c) => [Number(c.querySelector('.num').textContent), Number(c.dataset.std)]));
    assert.ok((await pairs()).every(([mine, std]) => mine === std), 'standard sliders give the standard scores');
    await page.locator('#tuning').screenshot({ path: `${shots}/custom-scoring.png` });
    // Hard to move by accident: a tap on the track does nothing, a vertical swipe neither; dragging the knob does.
    {
      const box = await page.locator('#t-p-chances').boundingBox();
      const before = await page.$eval('#t-p-chances', (e) => e.value);
      const y = box.y + box.height / 2;
      await page.mouse.click(box.x + box.width - 10, y);
      assert.equal(await page.$eval('#t-p-chances', (e) => e.value), before, 'a tap on the track moved the slider');
      const knob = box.x + 13 + (Number(before) / 100) * (box.width - 26);
      await page.mouse.move(knob, y);
      await page.mouse.down();
      await page.mouse.move(knob + 3, y + 40, { steps: 5 }); // mostly down: scrolling
      await page.mouse.up();
      assert.equal(await page.$eval('#t-p-chances', (e) => e.value), before, 'a vertical swipe moved the slider');
      await page.mouse.move(knob, y);
      await page.mouse.down();
      await page.mouse.move(knob + 80, y, { steps: 8 });
      await page.mouse.up();
      assert.ok(Number(await page.$eval('#t-p-chances', (e) => e.value)) > Number(before), 'dragging the knob did not move it');
      await page.click('#t-standard');
    }
    // The pillars: shares in percent; more Drama reorders the matches but keeps the average; pillar values never on a card.
    {
      assert.match(await page.$eval('#t-p-drama', (e) => e.closest('.slider').querySelector('.s-val').textContent), /^\d+% \(standard\)$/);
      assert.ok(await page.$eval('#t-standard', (e) => e.disabled), 'Standard is greyed out while it is standard');
      await page.$eval('#t-p-drama', (e) => { e.value = '60'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
      await page.waitForFunction(() => !/standard/.test(document.querySelector('#t-p-drama').closest('.slider').querySelector('.s-val').textContent));
      const pct = await page.$$eval('#t-pillars .s-val', (els) => els.map((e) => Number(e.textContent.match(/\d+/)[0])));
      assert.ok(Math.abs(pct.reduce((a, b) => a + b, 0) - 100) <= 2, `shares add up to 100: ${pct}`);
      const p = await pairs();
      assert.ok(p.some(([mine, std]) => mine !== std), 'a different mix changes some scores');
      const avg = (i) => p.reduce((a, x) => a + x[i], 0) / p.length;
      assert.ok(Math.abs(avg(0) - avg(1)) < 0.4, `the average stays about the same (${avg(0).toFixed(2)} vs ${avg(1).toFixed(2)})`);
      assert.doesNotMatch(await page.$eval('#cards', (e) => e.innerText), /Chances|Tension|Drama|Tempo/, 'pillar names on a card');
      await page.locator('#tuning').screenshot({ path: `${shots}/pillars.png` });
      // Tapping "standard" under one slider puts just that one back.
      await page.click('#t-p-drama ~ .s-std');
      await page.waitForFunction(() => /standard/.test(document.querySelector('#t-p-drama').closest('.slider').querySelector('.s-val').textContent));
      assert.ok((await pairs()).every(([mine, std]) => mine === std), 'the standard mark brings back the standard scores');
      assert.ok(await page.$eval('#t-standard', (e) => e.disabled), 'all standard again: the Standard button is greyed out');
    }
    const setSlider = (key, v) => page.$eval(`#t-s-${key}`, (e, x) => { e.value = String(x); e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }, v);
    await setSlider('goals', 0);
    await page.waitForFunction(() => document.querySelector('#t-s-goals').closest('.slider').querySelector('.s-val').textContent === 'Off');
    assert.ok((await pairs()).some(([mine, std]) => mine < std), 'Goals off lowers the scores');
    // A competition boost shows in "Why this score?".
    await page.evaluate(() => window.scrollTo(0, 0));
    const first = await page.$eval('.card.custom', (c) => c.dataset.id);
    const comp = await page.$eval('.card.custom', (c) => c.dataset.comp);
    await page.selectOption(`#t-boosts select[data-comp="${comp}"]`, '2');
    await page.$eval(`.card[data-id="${first}"] .why-btn`, (b) => b.scrollIntoView({ block: 'center' }));
    await page.click(`.card[data-id="${first}"] .why-btn`);
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForSelector(`.card[data-id="${first}"] .why li`);
    const whyText = await page.$eval(`.card[data-id="${first}"] .why`, (e) => e.textContent);
    assert.match(whyText, /: your boost/);
    assert.ok(await page.$$eval(`.card[data-id="${first}"] .why li.group`, (els) => els.some((e) => /The occasion/.test(e.textContent))), 'lines grouped by pillar');
    await page.screenshot({ path: `${shots}/custom-cards.png` });
    // Best first follows your scores.
    await openSettings(page);
    await page.selectOption('#f-sort', 'score');
    const nums = await page.$$eval('.card .num', (els) => els.map((e) => Number(e.textContent)).filter(Number.isFinite));
    assert.deepEqual(nums, [...nums].sort((a, b) => b - a), 'Best first sorts by your scores');
    await page.selectOption('#f-sort', 'date');
    // Reset to standard, and the setting survives a reload.
    await page.click('#t-standard');
    assert.ok((await pairs()).every(([mine, std]) => mine === std), 'reset brings back the standard scores');
    await page.reload();
    await page.waitForSelector('.card.custom');
    // Calibration mode: a stronger warning, then every result, and the facts and calculation.
    await openSettings(page);
    await page.click('#tuning summary');
    await page.click('#t-calib');
    await page.waitForSelector('#spoiler-dlg[open]');
    assert.match(await page.$eval('#spoiler-dlg h2', (e) => e.textContent), /Calibration/);
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForSelector('.card .calib-result:not([hidden])');
    assert.match(await page.$eval('.card .calib-result', (e) => e.textContent), /^Result: /);
    assert.ok(!(await page.$eval('#t-sliders .s-weights', (e) => e.hidden)), 'the weights show under the sliders');
    await page.click('#t-advanced summary');
    await page.locator('#tuning').screenshot({ path: `${shots}/calibration-panel.png` });
    await page.$eval('.card .calc-btn:not([hidden])', (b) => b.scrollIntoView({ block: 'start' }));
    const calcCard = await page.$eval('.card .calc-btn:not([hidden])', (b) => b.closest('.card').dataset.id);
    await page.click(`.card[data-id="${calcCard}"] .calc-btn`);
    await page.waitForSelector(`.card[data-id="${calcCard}"] .calc-lines li:nth-child(2)`);
    assert.match(await page.$eval(`.card[data-id="${calcCard}"] .calc-sum`, (e) => e.textContent), /score \d+\.\d/i);
    await page.locator(`.card[data-id="${calcCard}"]`).screenshot({ path: `${shots}/calibration-card.png` });
    await page.reload();
    await page.waitForSelector('.card');
    assert.equal(await page.$$eval('.calib-result:not([hidden])', (els) => els.length), 0, 'calibration mode is off after a reload');
    await page.close();
    assert.deepEqual(errors, []);
  } else {
    console.log('no docs/data/facts.json yet: custom scoring not tested in the browser');
  }

  // Live cards, with a made-up live match: the minute counts up and is refreshed from ESPN (routed
  // to test data here), "Excitement so far" only shows after a tap, and no score ever shows.
  {
    const now = Date.parse('2026-10-10T15:10:00Z');
    const real = JSON.parse(readFileSync(`${docs}/data/events.json`, 'utf8'));
    const liveMatch = {
      id: 'fb-999001', sport: 'football', comp: 'eng.1', compName: 'Premier League', start: '2026-10-10T14:00:00Z', status: 'live',
      services: ['viaplay'], teams: ['Testford United', 'Mockham City'], stakes: 'title', factor: 1.1,
      clock: { min: 67, plus: 0, period: 2, paused: false, at: new Date(now).toISOString() }, pace: 5.2,
    };
    const liveRace = { id: 'f1-999002', sport: 'f1', comp: 'f1', compName: 'Test Grand Prix', start: '2026-10-10T13:47:00Z', status: 'live', services: ['viaplay'], circuit: 'Testville' };
    const fake = { ...real, liveWeights: liveWeightsFrom(WEIGHTS.FOOTBALL, WEIGHTS.FOOTBALL_LIVE), upcoming: [liveMatch, liveRace, ...real.upcoming.filter((e) => e.status !== 'live')] };
    const status = (state, name, clock, displayClock, period) => ({ type: { state, name, completed: state === 'post' }, clock, displayClock, period });
    // The summary of a real thriller (France 4–6 England), pretending it's still on at 70'.
    const summary = JSON.parse(readFileSync(new URL('./fixtures/football/760516.json', import.meta.url), 'utf8'));
    summary.header.competitions[0].status = status('in', 'STATUS_SECOND_HALF', 4200, "70'", 2);
    const scoreboard = { events: [
      { id: '999001', date: liveMatch.start, status: status('in', 'STATUS_SECOND_HALF', 4200, "70'", 2), competitions: [{ competitors: [{ homeAway: 'home', score: '3' }, { homeAway: 'away', score: '2' }] }] },
    ] };
    const openLive = async (espn) => {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      await page.clock.install({ time: now });
      await page.route('**/data/events.json', (r) => r.fulfill({ json: fake }));
      await page.route('https://site.api.espn.com/**', espn);
      await page.goto(base);
      await page.evaluate(() => localStorage.clear());
      await page.reload();
      await page.click('#views [data-view="upcoming"]');
      return page;
    };
    const paceOf = (page) => page.waitForFunction(() => {
      const t = document.querySelector('.card[data-id="fb-999001"] .pace')?.textContent ?? '';
      return /≈ \d+\.\d out of 10/.test(t) && t;
    }).then((h) => h.jsonValue());

    const page = await openLive((r) => r.fulfill({ json: r.request().url().includes('/summary') ? summary : scoreboard, headers: { 'access-control-allow-origin': '*' } }));
    assert.equal(await page.$eval('#views [data-view="upcoming"]', (e) => e.textContent), 'Coming up/ongoing');
    const card = page.locator('.card.soon.live[data-id="fb-999001"]');
    await card.waitFor();
    assert.equal(await card.locator('.tier').textContent(), "67'", 'the bot\'s minute');
    assert.match(await card.locator('.comp').textContent(), /started \d\d:\d\d/);
    assert.equal(await page.locator('.card.soon.live[data-id="f1-999002"] .tier').textContent(), '1 h 23');
    assert.ok(await card.locator('.pace').isHidden(), 'excitement shown before the tap');
    await page.clock.fastForward(61e3); // the page asks ESPN once a minute
    await page.waitForFunction(() => document.querySelector('.card[data-id="fb-999001"] .tier').textContent === "70'");
    await card.locator('.pace-btn').click();
    const pace = await paceOf(page);
    assert.doesNotMatch(pace, /few minutes old/, 'worked out from ESPN, not the bot\'s number');
    const text = await page.$eval('#cards', (e) => e.innerText);
    assert.doesNotMatch(text, /\b\d+\s*[-–]\s*\d+\b/, 'a score-like text on the page');
    for (const leak of ['Kane', 'Mbapp', 'France', 'England']) assert.ok(!text.includes(leak), `"${leak}" from the summary on the page`);
    await card.screenshot({ path: `${shots}/live-card.png` });
    // Custom scoring changes the live number too (Goals doubled, a boost for the Premier League).
    await page.evaluate(() => {
      const p = JSON.parse(localStorage.getItem('pt-prefs') ?? '{}');
      p.tweaks = { v: 4, on: true, sliders: { goals: 2 }, curveFrom: null, comps: { 'eng.1': 1 } };
      localStorage.setItem('pt-prefs', JSON.stringify(p));
    });
    await page.reload();
    await page.locator('.card[data-id="fb-999001"] .pace-btn').click();
    const mine = await paceOf(page);
    assert.ok(Number(mine.match(/[\d.]+/)[0]) > Number(pace.match(/[\d.]+/)[0]), 'more for goals and the boost');
    // Calibration mode shows the live score from ESPN.
    assert.equal(await page.$$eval('.calib-result:not([hidden])', (els) => els.length), 0, 'a live score before calibration mode');
    await openSettings(page);
    await page.click('#tuning summary');
    await page.click('#t-calib');
    await page.click('#spoiler-dlg button[value="ok"]');
    await page.waitForFunction(() => document.querySelector('.card[data-id="fb-999001"] .calib-result')?.textContent === 'Now: Testford United 3–2 Mockham City');
    await page.close();
    assert.deepEqual(page.errors, []);

    // ESPN refuses: the bot's minute and number (marked as a few minutes old).
    const off = await openLive((r) => r.abort());
    await off.locator('.card[data-id="fb-999001"] .pace-btn').click();
    assert.match(await paceOf(off), /≈ 5\.2 out of 10 \(a few minutes old\)/);
    await off.clock.fastForward(61e3);
    assert.equal(await off.locator('.card[data-id="fb-999001"] .tier').textContent(), "68'", 'the bot\'s minute, counted up');
    await off.close();
  }

  // iPhone Safari has no install popup, so the card's Install button shows the steps; ✕ hides it for good.
  const iphone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iphone.goto(base);
  await iphone.waitForSelector('.card');
  assert.ok(await iphone.$eval('#install-card', (e) => !e.hidden), 'no install card on iPhone');
  await iphone.locator('#install-card').screenshot({ path: `${shots}/install-card.png` });
  await iphone.click('#install-btn');
  await iphone.waitForSelector('#ios-install-dlg[open]');
  await iphone.screenshot({ path: `${shots}/install-steps-iphone.png` });
  await iphone.click('#ios-install-close');
  await iphone.click('#install-hide');
  assert.ok(await iphone.$eval('#install-card', (e) => e.hidden));
  await iphone.reload();
  await iphone.waitForSelector('.card');
  assert.ok(await iphone.$eval('#install-card', (e) => e.hidden), '"Not now" is remembered');
  await iphone.close();

  console.log('e2e passed');
} finally {
  await browser.close();
  server?.kill();
}
