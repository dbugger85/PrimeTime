// Browser test on a phone-sized screen, using the real docs/data/events.json.
//
//   npm install && npm run e2e                                    # tests local files
//   BASE_URL=https://dbugger85.github.io/PrimeTime/ npm run e2e   # tests the live site
//
// Needs Chromium (CHROMIUM=/path/to/chromium if not /usr/bin/chromium).
// Screenshots go to test/screenshots/ (ignored by git).

import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

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
      await page.click('.card .title .star');
      assert.ok(await page.$('#favs .fav:has-text("Biathlon (women)")'), 'following a winter sport from a card');
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
    const shownComps = await page.$$eval('.card .sub', (els) => [...new Set(els.map((e) => e.textContent))]);
    assert.deepEqual(shownComps, [comp]);
    assert.equal(await page.$eval('#filter-count', (e) => e.textContent), '1 on');
    await page.screenshot({ path: `${shots}/football-filtered.png` });
    await page.click('#f-reset');
    assert.ok(await page.$eval('#filter-count', (e) => e.hidden));

    // Services filter: with only HBO Max chosen (tennis), the F1 tab is empty.
    await page.click('#sports [data-sport="tennis"]');
    await page.click('#services .chip:has-text("HBO Max")');
    await page.click('#sports [data-sport="f1"]');
    assert.equal(await page.$$eval('.card', (els) => els.length), 0);
    await page.click('#sports [data-sport="tennis"]');
    await page.click('#services .chip:has-text("HBO Max")');

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

    // Coming up: no scores, just times (or LIVE) and services, grouped by day.
    await page.click('#views [data-view="upcoming"]');
    await page.click('#sports [data-sport="all"]');
    if (await page.$('.card.soon')) {
      assert.equal(await page.$$eval('.card .num', (els) => els.length), 0, 'a score is shown on an upcoming event');
      assert.ok(await page.$('.day'));
      await page.screenshot({ path: `${shots}/upcoming.png` });
    }
    await checkLineups(page, 'upcoming');
    await page.click('#views [data-view="replays"]');
    await page.waitForSelector('.card .num');
    await checkLineups(page, 'replay');

    // Favorites: star a team on a card, filter to favorites only, search, remove.
    await page.click('#sports [data-sport="football"]');
    assert.ok(await page.$eval('#fav-only', (e) => e.disabled), '"Only favorites" is off until you have one');
    const team = await page.$eval('.card .title .name', (e) => e.firstChild.textContent);
    const other = await page.$eval('.card .title .name:nth-child(2)', (e) => e.firstChild.textContent);
    await page.click('.card .title .name .star');
    assert.equal(await page.$eval('.card .title .name .star', (e) => e.textContent), '★');
    await page.click('#fav-only');
    const titles = await page.$$eval('.card .title', (els) => els.map((e) => e.textContent));
    assert.ok(titles.length > 0 && titles.every((t) => t.includes(team)), `only ${team} matches show`);
    await page.screenshot({ path: `${shots}/favorites.png` });
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
    await page.click('.card .title .name .star');
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
    assert.ok(await page.$eval('#install-ios', (e) => e.hidden), 'the iPhone tip shows on Android/desktop');

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
    const team = await one.$eval('.card .title .name', (e) => e.firstChild.textContent);
    await one.click('.card .title .name .star');
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

  // iPhone Safari has no install button, so it gets the "Add to Home Screen" tip.
  const iphone = await browser.newPage({
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  await iphone.goto(base);
  await iphone.waitForSelector('.card');
  assert.ok(await iphone.$eval('#install-ios', (e) => !e.hidden), 'no install tip on iPhone');
  assert.ok(await iphone.$eval('#install-btn', (e) => e.hidden));
  await iphone.evaluate(() => document.querySelector('.foot').scrollIntoView());
  await iphone.screenshot({ path: `${shots}/install-tip-iphone.png` });
  await iphone.close();

  console.log('e2e passed');
} finally {
  await browser.close();
  server?.kill();
}
