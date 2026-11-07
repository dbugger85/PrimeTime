// The notification helper (worker/): message encryption, the VAPID signature, and the
// every-minute check, with a fake database and a fake site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, createHmac, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { encrypt, vapidHeader, b64u } from '../worker/src/webpush.js';
import { sendDue } from '../worker/src/index.js';

const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// A pretend browser: its own keys, and RFC 8291 decryption written separately with node:crypto.
function browser() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = Buffer.from('0123456789abcdef');
  return {
    keys: { p256dh: b64u.encode(ecdh.getPublicKey()), auth: b64u.encode(auth) },
    decrypt(body) {
      const buf = Buffer.from(body);
      const salt = buf.subarray(0, 16);
      const idlen = buf[20];
      const asPublic = buf.subarray(21, 21 + idlen);
      const sealed = buf.subarray(21 + idlen);
      const shared = ecdh.computeSecret(asPublic);
      const prkKey = hmac(auth, shared);
      const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
      const d = createDecipheriv('aes-128-gcm', cek, nonce);
      d.setAuthTag(sealed.subarray(-16));
      const plain = Buffer.concat([d.update(sealed.subarray(0, -16)), d.final()]);
      assert.equal(plain.at(-1), 2, 'last-record marker');
      assert.equal(buf.readUInt32BE(16), 4096, 'record size');
      return plain.subarray(0, -1).toString();
    },
  };
}

async function vapidKeys() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64u.encode(await crypto.subtle.exportKey('raw', k.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', k.privateKey),
    publicJwk: await crypto.subtle.exportKey('jwk', k.publicKey),
  };
}

test('a message only the subscribed browser can read', async () => {
  const b = browser();
  const msg = JSON.stringify({ title: 'Brann – Viking', body: 'Eliteserien · TV 2 Play' });
  assert.equal(b.decrypt(await encrypt(msg, b.keys)), msg);
});

test('the VAPID header is a valid ES256 token for the push service', async () => {
  const k = await vapidKeys();
  const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', { ...k, subject: 'https://primetime.re' }, Date.parse('2026-11-07T12:00Z'));
  const [, t, key] = h.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(key, k.publicKey);
  const [head, claims, sig] = t.split('.');
  const c = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(c.aud, 'https://fcm.googleapis.com');
  assert.equal(c.exp, Date.parse('2026-11-07T12:00Z') / 1000 + 12 * 3600);
  assert.equal(c.sub, 'https://primetime.re');
  const ok = verify('sha256', Buffer.from(`${head}.${claims}`), { key: createPublicKey({ key: k.publicJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  assert.ok(ok);
});

// A tiny stand-in for D1 that understands the worker's few queries.
function fakeDb(rows) {
  const run = (sql, args) => {
    if (sql.startsWith('SELECT * FROM alerts WHERE start <=')) return { results: rows.filter((r) => r.start <= args[0]) };
    if (sql.startsWith('UPDATE alerts SET start')) { const r = rows.find((x) => x.endpoint === args[1] && x.event === args[2]); r.start = args[0]; return {}; }
    if (sql === 'DELETE FROM alerts WHERE endpoint = ? AND event = ?') { rows.splice(0, rows.length, ...rows.filter((x) => !(x.endpoint === args[0] && x.event === args[1]))); return {}; }
    if (sql === 'DELETE FROM alerts WHERE endpoint = ?') { rows.splice(0, rows.length, ...rows.filter((x) => x.endpoint !== args[0])); return {}; }
    throw new Error(`unexpected SQL: ${sql}`);
  };
  return { prepare: (sql) => ({ bind: (...args) => ({ all: async () => run(sql, args), run: async () => run(sql, args) }) }) };
}

test('every minute: sends what has started, waits for moved events, drops cancelled ones', async () => {
  const now = Date.parse('2026-11-07T20:00Z');
  const k = await vapidKeys();
  const b = browser();
  const row = (event, start, endpoint = 'https://fcm.googleapis.com/fcm/send/one') => ({ endpoint, ...b.keys, event, start: Date.parse(start), title: `T ${event}`, body: 'B' });
  const rows = [
    row('due', '2026-11-07T20:00Z'),
    row('moved', '2026-11-07T19:59Z'), // the site now says 21:00
    row('gone-recent', '2026-11-07T19:30Z'), // not on the site: wait (it might come back)
    row('gone-old', '2026-11-07T15:00Z'), // not on the site for hours: drop
    row('replay', '2026-11-07T18:00Z'), // already finished and in Replays: drop without sending
    row('later', '2026-11-07T22:00Z'),
    row('due', '2026-11-07T20:00Z', 'https://fcm.googleapis.com/fcm/send/unsubscribed'),
  ];
  const site = {
    upcoming: [{ id: 'due', start: '2026-11-07T20:00Z', status: 'live' }, { id: 'moved', start: '2026-11-07T21:00Z' }, { id: 'later', start: '2026-11-07T22:00Z' }],
    events: [{ id: 'replay' }],
  };
  const sent = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).endsWith('/data/events.json')) return new Response(JSON.stringify(site));
    sent.push({ url, body: b.decrypt(init.body), auth: init.headers.Authorization });
    return new Response(null, { status: url.endsWith('unsubscribed') ? 410 : 201 });
  };
  try {
    const env = { DB: fakeDb(rows), SITE: 'https://primetime.re', VAPID_PUBLIC: k.publicKey, VAPID_PRIVATE: JSON.stringify(k.privateJwk) };
    const r = await sendDue(env, now);
    assert.equal(r.sent, 1);
    assert.equal(sent.length, 2); // one delivered, one to a phone that has unsubscribed
    assert.deepEqual(JSON.parse(sent[0].body), { title: 'T due', body: 'B', id: 'due' });
    assert.match(sent[0].auth, /^vapid t=/);
    assert.deepEqual(rows.map((x) => x.event).sort(), ['gone-recent', 'later', 'moved']);
    assert.equal(rows.find((x) => x.event === 'moved').start, Date.parse('2026-11-07T21:00Z'));
  } finally { globalThis.fetch = realFetch; }
});
