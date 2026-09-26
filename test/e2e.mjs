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
    await page.click('#views [data-view="replays"]');
    await page.waitForSelector('.card .num');

    // Mark watched survives a reload.
    const firstId = await page.$eval('.card', (e) => e.dataset.id);
    await page.click('.card .watched');
    await page.reload();
    await page.waitForSelector('.card');
    assert.ok(await page.$eval(`.card[data-id="${firstId}"]`, (e) => e.classList.contains('is-watched')));

    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log('e2e passed');
} finally {
  await browser.close();
  server?.kill();
}
