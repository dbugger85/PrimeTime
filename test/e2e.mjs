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
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(base);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForSelector('.card');
    await page.screenshot({ path: `${shots}/home-${scheme}.png` });

    const cards = await page.$$eval('.card', (els) => els.length);
    assert.ok(cards > 0 && cards <= 40, `first page shows up to 40 cards, got ${cards}`);

    // No result-like text anywhere in the card titles, subtitles or advice.
    const text = await page.$$eval('.title, .sub, .advice', (els) => els.map((e) => e.textContent).join('\n'));
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

    // Services filter: only HBO Max shows tennis, so F1 should go empty with just HBO Max.
    await page.click('#sports [data-sport="f1"]');
    await page.click('.chip:has-text("HBO Max")');
    assert.equal(await page.$$eval('.card', (els) => els.length), 0);
    await page.click('.chip:has-text("HBO Max")');

    // Skip tips can be switched off.
    await page.uncheck('#f-hints');
    assert.equal(await page.$$eval('.advice:not([hidden])', (els) => els.length), 0);
    await page.check('#f-hints');

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
