// What GitHub Actions runs every 15 minutes: the full build when one is due
// (every 3 hours, or when FULL=1), otherwise the light live check.

import { loadData } from '../src/store.mjs';

const FULL_EVERY_MS = 3 * 3600e3 - 10 * 60e3; // a little under 3 hours, since scheduled runs drift
const { lastFull } = loadData().state;
const due = process.env.FULL === '1' || !lastFull || Date.now() - Date.parse(lastFull) >= FULL_EVERY_MS;

console.log(due ? 'Running the full build' : `Running the live check (last full build ${lastFull})`);
await import(due ? './build.mjs' : './live.mjs');
