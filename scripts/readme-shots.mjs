// Screenshots of the live site for the README (.github/readme/*.jpg), at phone size.
// Run: node scripts/readme-shots.mjs   (needs `npm install` and /usr/bin/chromium; `magick` turns them into JPEGs)
// Look at them before committing: a live match can catch an odd clock, and nothing may show a result.
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';

const out = new URL('../.github/readme/', import.meta.url).pathname;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || '/usr/bin/chromium' });

async function shot(name, scheme, prep) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme });
  await page.addInitScript(() => { try { localStorage.setItem('pt-install-hidden', 'true'); localStorage.setItem('pt-favs-open', 'false'); } catch {} });
  await page.goto('https://primetime.re/', { waitUntil: 'networkidle' });
  await page.waitForSelector('.card');
  await prep?.(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}${name}.png` });
  await page.close();
  execFileSync('magick', [`${out}${name}.png`, '-resize', '600x', '-quality', '85', `${out}${name}.jpg`]);
  execFileSync('rm', [`${out}${name}.png`]);
}

try {
  await shot('replays', 'dark');
  await shot('football', 'light', async (p) => { // the best football of the last 30 days
    await p.click('#sports [data-sport="football"]');
    await p.click('#filters summary');
    await p.selectOption('#f-sort', 'score');
    await p.click('#filters summary');
    await p.evaluate(() => { const c = document.querySelector('.card'); window.scrollTo(0, c.getBoundingClientRect().top + scrollY - 16); });
  });
  await shot('coming-up', 'dark', async (p) => { // from the first day heading, past any live matches
    await p.click('#views [data-view="upcoming"]');
    await p.click('#sports [data-sport="football"]');
    await p.evaluate(({ sel }) => {
      const h = [...document.querySelectorAll(sel)].find((e) => /^(today|tomorrow)$/i.test(e.textContent.trim()) && !e.closest('.card'));
      window.scrollTo(0, h.getBoundingClientRect().top + scrollY - 16);
    }, { sel: 'h2, li, p' });
  });
  await shot('settings', 'light', async (p) => {
    await p.click('#filters summary');
    await p.click('#leagues-box summary');
    await p.evaluate(() => document.querySelector('#filters').scrollIntoView());
  });
} finally {
  await browser.close();
}
