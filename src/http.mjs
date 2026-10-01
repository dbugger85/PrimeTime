// Polite JSON fetching: one request at a time per host, a pause between
// requests, and a few retries when a server says "slow down" (429) or fails.

const lastCall = new Map(); // host -> timestamp of the previous request
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const getJson = (url, opts) => fetchPolitely(url, opts, (res) => res.json());

// The same, for web pages (FIS has no API, so its results pages are read as HTML).
export const getText = (url, opts) => fetchPolitely(url, opts, (res) => res.text());

async function fetchPolitely(url, { gapMs = 300, retries = 4 } = {}, read) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const wait = (lastCall.get(host) ?? 0) + gapMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());
    let res;
    try {
      // 30 s at most: a server that hangs instead of failing would otherwise use up the whole run.
      res = await fetch(url, { headers: { 'user-agent': 'PrimeTime (github.com/dbugger85/PrimeTime)' }, signal: AbortSignal.timeout(30e3) });
    } catch (err) {
      if (attempt >= retries) throw err;
      await sleep(1000 * 2 ** attempt);
      continue;
    }
    if (res.ok) {
      try {
        return await read(res);
      } catch (err) { // the body timed out or was cut off: try again like a failed request
        if (attempt >= retries) throw err;
        await sleep(1000 * 2 ** attempt);
        continue;
      }
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    const err = new Error(`${res.status} ${res.statusText} for ${url}`);
    // OpenF1 shuts out free users (even for old races) while any F1 session is live.
    // That's expected on race weekends, so callers log it calmly and try again later.
    if (res.status === 401 && /live f1 session/i.test(await res.text().catch(() => ''))) err.f1Live = true;
    throw err;
  }
}
