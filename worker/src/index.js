// PrimeTime's notification helper (a Cloudflare Worker, free plan).
// The page is a static site, so something has to remember "notify this phone when this match
// starts" and send the ping on time. This is it: it stores the phone's push address and the
// events it belled in a small D1 database, checks every minute, sends, and deletes the row.
// It stores nothing else: no names, no accounts, no IP addresses.
//
//   POST   /alert  { sub, id, title, body }   bell an event (it must be in "Coming up")
//   DELETE /alert  { endpoint, id }           un-bell it
//
// Secrets (`wrangler secret put`): VAPID_PRIVATE (the private key as JWK JSON).
// Vars (wrangler.toml): VAPID_PUBLIC, SITE.

import { sendPush } from './webpush.js';

const ORIGINS = ['https://primetime.re', 'https://www.primetime.re', 'http://localhost:8000'];
// Only real browser push services, so this can't be used to make requests anywhere else.
const PUSH_HOSTS = ['fcm.googleapis.com', 'push.services.mozilla.com', 'push.apple.com', 'notify.windows.com'];
const MAX_PER_PHONE = 60;
const TOO_LATE = 3 * 3600e3; // don't send for something that started over 3 hours ago (the check was down)
const EARLY = 30e3; // send up to 30 s early, since the check runs once a minute

const isPushHost = (endpoint) => {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && PUSH_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
};
const text = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

function cors(req) {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

// events.json from the live site, cached for a minute at Cloudflare.
async function siteData(env) {
  const res = await fetch(`${env.SITE}/data/events.json`, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) throw new Error(`events.json: HTTP ${res.status}`);
  return res.json();
}

async function handle(req, env) {
  const url = new URL(req.url);
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  if (url.pathname !== '/alert') return json({ ok: true, what: 'PrimeTime notifications' }, url.pathname === '/' ? 200 : 404);

  let input;
  try { input = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  if (req.method === 'DELETE') {
    if (typeof input.endpoint !== 'string' || typeof input.id !== 'string') return json({ error: 'missing fields' }, 400);
    await env.DB.prepare('DELETE FROM alerts WHERE endpoint = ? AND event = ?').bind(input.endpoint, input.id).run();
    return json({ ok: true });
  }

  if (req.method === 'POST') {
    const { sub, id } = input;
    if (!sub || !isPushHost(sub.endpoint) || typeof sub.keys?.p256dh !== 'string' || typeof sub.keys?.auth !== 'string' || typeof id !== 'string') {
      return json({ error: 'missing fields' }, 400);
    }
    // The start time comes from the site, not from the page, and only "Coming up" events can be belled.
    const data = await siteData(env);
    const e = (data.upcoming ?? []).find((x) => x.id === id);
    if (!e || !(Date.parse(e.start) > Date.now())) return json({ error: 'not coming up' }, 409);
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM alerts WHERE endpoint = ?').bind(sub.endpoint).first();
    if (n >= MAX_PER_PHONE) return json({ error: 'too many' }, 429);
    await env.DB.prepare(`INSERT INTO alerts (endpoint, p256dh, auth, event, start, title, body) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (endpoint, event) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, start = excluded.start, title = excluded.title, body = excluded.body`)
      .bind(sub.endpoint, sub.keys.p256dh.slice(0, 200), sub.keys.auth.slice(0, 100), id, Date.parse(e.start), text(input.title, 120) || 'Starting now', text(input.body, 200))
      .run();
    return json({ ok: true, start: e.start });
  }
  return json({ error: 'method' }, 405);
}

// Every minute: send what's due. Before sending, the start time is checked against the site,
// so a match that was moved waits for its new time and one that's gone is dropped.
export async function sendDue(env, now = Date.now()) {
  const { results: due } = await env.DB.prepare('SELECT * FROM alerts WHERE start <= ? LIMIT 200').bind(now + EARLY).all();
  if (!due.length) return { sent: 0 }; // the usual case: one tiny query, nothing else
  const data = await siteData(env);
  const upcoming = new Map((data.upcoming ?? []).map((e) => [e.id, e]));
  const done = new Set((data.events ?? []).map((e) => e.id));
  const vapid = { publicKey: env.VAPID_PUBLIC, privateJwk: JSON.parse(env.VAPID_PRIVATE), subject: env.SITE };
  const drop = (a) => env.DB.prepare('DELETE FROM alerts WHERE endpoint = ? AND event = ?').bind(a.endpoint, a.event).run();
  let sent = 0;
  for (const a of due) {
    const e = upcoming.get(a.event);
    const start = e ? Date.parse(e.start) : a.start;
    if (e && start > now + EARLY) { // moved to later
      await env.DB.prepare('UPDATE alerts SET start = ? WHERE endpoint = ? AND event = ?').bind(start, a.endpoint, a.event).run();
      continue;
    }
    if (!e && !done.has(a.event)) { // not on the site at all: postponed or cancelled
      if (now - a.start > TOO_LATE) await drop(a);
      continue;
    }
    if (now - start > TOO_LATE || (!e && done.has(a.event))) { await drop(a); continue; } // long over
    const payload = JSON.stringify({ title: a.title, body: a.body, id: a.event });
    let status = 0;
    try {
      status = await sendPush({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload, vapid);
    } catch (err) { console.log('push failed', String(err)); }
    if (status === 404 || status === 410) { // that phone unsubscribed: forget all its bells
      await env.DB.prepare('DELETE FROM alerts WHERE endpoint = ?').bind(a.endpoint).run();
    } else if (status >= 200 && status < 300) {
      await drop(a);
      sent++;
    } else {
      console.log('push refused', status, new URL(a.endpoint).hostname); // tried again next minute
    }
  }
  return { sent };
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); } catch (err) {
      console.log(String(err));
      return new Response(JSON.stringify({ error: 'server' }), { status: 500, headers: { ...cors(req), 'Content-Type': 'application/json' } });
    }
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(sendDue(env).then((r) => r.sent && console.log(`sent ${r.sent}`)));
  },
};
