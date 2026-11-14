// A small PDF text reader, just enough for IBU's result sheets (no install needed).
// It finds each page's text pieces and where they sit, then groups them into rows:
//   pdfRows(bytes) -> [[ 'cell', 'cell', … ], …]   (each row left to right, pages in order)
//
// What it understands: plain and compressed (Flate) streams, object streams,
// fonts with a ToUnicode map (IBU's sheets use Identity-H fonts) or plain one-byte
// text, and the text operators BT/ET, Tf, Td, TD, Tm, T*, Tj, TJ, ' and " plus
// q/Q/cm for positions. Everything else (drawing, images) is skipped.

import { inflateSync, inflateRawSync } from 'node:zlib';

// ---- Objects -------------------------------------------------------------

// A tiny parser for PDF values: dictionaries, arrays, names, numbers,
// strings, references ("12 0 R") and booleans.
function parseValue(s, i = 0) {
  const ws = () => { while (i < s.length && /[\s%]/.test(s[i])) { if (s[i] === '%') while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; else i++; } };
  function value() {
    ws();
    const c = s[i];
    if (c === '<' && s[i + 1] === '<') {
      i += 2;
      const d = {};
      for (;;) {
        ws();
        if (s[i] === '>' && s[i + 1] === '>') { i += 2; return d; }
        if (i >= s.length) return d;
        const k = value();
        d[typeof k === 'object' && k?.name ? k.name : String(k)] = value();
      }
    }
    if (c === '[') {
      i++;
      const a = [];
      for (;;) {
        ws();
        if (s[i] === ']') { i++; return a; }
        if (i >= s.length) return a;
        a.push(value());
      }
    }
    if (c === '/') {
      let j = i + 1;
      while (j < s.length && !/[\s/<>[\]()%{}]/.test(s[j])) j++;
      const name = s.slice(i + 1, j).replace(/#([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
      i = j;
      return { name };
    }
    if (c === '(') { const [str, j] = literal(s, i); i = j; return { str }; }
    if (c === '<') { const j = s.indexOf('>', i); const str = hex(s.slice(i + 1, j)); i = j + 1; return { str }; }
    const m = /^[+-]?(\d+\.?\d*|\.\d+)/.exec(s.slice(i, i + 32));
    if (m) {
      const ref = /^(\d+)\s+(\d+)\s+R(?![A-Za-z])/.exec(s.slice(i, i + 40));
      if (ref) { i += ref[0].length; return { ref: Number(ref[1]) }; }
      i += m[0].length;
      return Number(m[0]);
    }
    const w = /^[A-Za-z]+/.exec(s.slice(i, i + 16));
    if (w) { i += w[0].length; return w[0] === 'true' ? true : w[0] === 'false' ? false : null; }
    i++;
    return null;
  }
  const v = value();
  return [v, i];
}

// "(a\(b\)c)" -> bytes as a latin1 string, and the index after it.
function literal(s, i) {
  let depth = 0, out = '';
  for (i++; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') {
      const n = s[++i];
      const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f' }[n];
      if (esc) out += esc;
      else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1])) o += s[++i]; out += String.fromCharCode(parseInt(o, 8) & 255); }
      else if (n === '\r') { if (s[i + 1] === '\n') i++; }
      else if (n !== '\n') out += n;
    } else if (c === '(') { depth++; out += c; }
    else if (c === ')') { if (!depth) return [out, i + 1]; depth--; out += c; }
    else out += c;
  }
  return [out, i];
}

const hex = (h) => {
  const t = h.replace(/\s+/g, '');
  let out = '';
  for (let k = 0; k < t.length; k += 2) out += String.fromCharCode(parseInt((t[k] + (t[k + 1] ?? '0')), 16));
  return out;
};

// Some PDF writers (IBU's among them) declare a smaller window in the zlib header
// than they use, which zlib refuses; reading the raw data after the header works.
// Z_SYNC_FLUSH (2) tolerates a missing end.
function inflate(d) {
  try {
    return inflateSync(d, { finishFlush: 2 });
  } catch {
    return inflateRawSync(d.subarray(2), { finishFlush: 2 });
  }
}

// All objects in the file: { num: { dict, value, stream (Buffer) } }.
function readObjects(buf) {
  const s = buf.toString('latin1');
  const objs = {};
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const [value, end] = parseValue(s, m.index + m[0].length);
    const obj = { value };
    const after = /^\s*stream\r?\n/.exec(s.slice(end, end + 20));
    if (after && value && typeof value === 'object') {
      const start = end + after[0].length;
      // The length may be another object ("7 0 R") that comes later: fixed up below.
      const len = s.indexOf('endstream', start) - start;
      obj.start = start;
      obj.raw = buf.subarray(start, start + len);
      re.lastIndex = start + len;
    }
    objs[Number(m[1])] = obj; // later copies (incremental updates) replace earlier ones
  }
  const resolve = (v) => (v && typeof v === 'object' && 'ref' in v ? objs[v.ref]?.value : v);
  for (const o of Object.values(objs)) {
    const len = resolve(o.value?.Length);
    if (o.raw && typeof len === 'number' && len <= o.raw.length) o.raw = buf.subarray(o.start, o.start + len);
  }
  const data = (o) => {
    if (!o?.raw) return null;
    if (o.data) return o.data;
    const f = resolve(o.value.Filter);
    const filters = (Array.isArray(f) ? f : f ? [f] : []).map((x) => resolve(x)?.name);
    let d = o.raw;
    for (const name of filters) {
      if (name === 'FlateDecode') d = inflate(d);
      else return null; // other filters (images) aren't needed
    }
    return (o.data = d);
  };
  // Objects packed inside object streams.
  for (const o of Object.values(objs)) {
    if (resolve(o.value?.Type)?.name !== 'ObjStm') continue;
    const d = data(o)?.toString('latin1');
    if (!d) continue;
    const first = resolve(o.value.First);
    const head = d.slice(0, first).trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < head.length; k += 2) {
      if (objs[head[k]]) continue;
      objs[head[k]] = { value: parseValue(d, first + head[k + 1])[0] };
    }
  }
  return { objs, resolve, data };
}

// ---- Fonts -----------------------------------------------------------------

// A font's codes -> text. ToUnicode maps (bfchar / bfrange), or one byte per character.
function fontDecoder(font, ctx) {
  const { objs, resolve, data } = ctx;
  const map = new Map();
  let width = 1;
  const tu = font?.ToUnicode;
  const cmap = tu?.ref ? data(objs[tu.ref])?.toString('latin1') : null;
  if (cmap) {
    const cs = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(cmap);
    width = cs ? cs[1].length / 2 : 2;
    const utf16 = (h) => {
      let out = '';
      for (let k = 0; k + 3 < h.length + 1; k += 4) out += String.fromCharCode(parseInt(h.slice(k, k + 4), 16));
      return out;
    };
    for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const [, src, dst] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(src, 16), utf16(dst));
    }
    for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const [, lo, hi, rest] of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
        const a = parseInt(lo, 16), b = parseInt(hi, 16);
        if (rest.startsWith('[')) {
          [...rest.matchAll(/<([0-9a-fA-F]*)>/g)].forEach(([, d], k) => map.set(a + k, utf16(d)));
        } else {
          const d = rest.slice(1, -1);
          const base = parseInt(d.slice(-4), 16);
          for (let c = a; c <= b && c - a < 65536; c++) map.set(c, utf16(d.slice(0, -4)) + String.fromCharCode(base + c - a));
        }
      }
    }
  } else {
    width = resolve(font?.Subtype)?.name === 'Type0' ? 2 : 1;
  }
  return (bytes) => {
    let out = '';
    for (let k = 0; k + width <= bytes.length; k += width) {
      let code = 0;
      for (let j = 0; j < width; j++) code = code * 256 + bytes.charCodeAt(k + j);
      out += map.get(code) ?? (width === 1 ? String.fromCharCode(code) : '');
    }
    return out;
  };
}

// ---- Pages ----------------------------------------------------------------

const mul = (a, b) => [
  a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5],
];

// Content-stream tokens: numbers, names, strings, arrays and operators.
function* tokens(s) {
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(' || c === '[' || c === '/' || (c === '<' && s[i + 1] !== '<') || /[\d.+-]/.test(c)) {
      const [v, j] = parseValue(s, i);
      i = j > i ? j : i + 1;
      yield { v };
      continue;
    }
    if (c === '<' && s[i + 1] === '<') { const [v, j] = parseValue(s, i); i = j; yield { v }; continue; }
    if (c === 'B' && s[i + 1] === 'I' && /\s/.test(s[i + 2] ?? '')) { // inline image: skip to EI
      const j = s.indexOf('EI', i + 2);
      i = j < 0 ? s.length : j + 2;
      continue;
    }
    let j = i;
    while (j < s.length && !/[\s/<>[\]()%]/.test(s[j])) j++;
    if (j === i) j++;
    yield { op: s.slice(i, j) };
    i = j;
  }
}

// Every text piece on every page: [{ page, x, y, text }], y growing downwards.
export function pdfTexts(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const ctx = readObjects(buf);
  const { objs, resolve, data } = ctx;
  const catalog = Object.values(objs).find((o) => resolve(o.value?.Type)?.name === 'Catalog')?.value;
  const pages = [];
  const walk = (node, inherited, seen = new Set()) => {
    if (!node || seen.has(node)) return;
    seen.add(node);
    const res = node.Resources ?? inherited;
    if (resolve(node.Type)?.name === 'Page' || (!node.Kids && node.Contents)) pages.push({ node, res: resolve(res) });
    for (const kid of resolve(node.Kids) ?? []) walk(resolve(kid), res, seen);
  };
  walk(resolve(catalog?.Pages), null);
  const out = [];
  pages.forEach(({ node, res }, p) => {
    const fonts = resolve(res?.Font) ?? {};
    const decoders = {};
    const decoder = (name) => (decoders[name] ??= fontDecoder(resolve(fonts[name]), ctx));
    const c = resolve(node.Contents) ? node.Contents : null;
    const parts = Array.isArray(resolve(c)) ? resolve(c) : c ? [c] : [];
    const content = parts.map((r) => data(objs[r.ref])?.toString('latin1') ?? '').join('\n');
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    let tm = [1, 0, 0, 1, 0, 0], tlm = tm, font = null, size = 1, leading = 0;
    const args = [];
    const show = (str) => {
      const text = decoder(font)(str);
      if (!text.trim()) return;
      const m = mul(tm, ctm);
      out.push({ page: p, x: m[4], y: m[5], size: Math.abs(size * m[3]) || Math.abs(size), text });
    };
    const nextLine = (tx, ty) => { tlm = mul([1, 0, 0, 1, tx, ty], tlm); tm = tlm; };
    for (const t of tokens(content)) {
      if (!t.op) { args.push(t.v); continue; }
      const a = args.splice(0);
      switch (t.op) {
        case 'q': stack.push(ctm); break;
        case 'Q': ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0]; break;
        case 'cm': if (a.length >= 6) ctm = mul(a.slice(-6), ctm); break;
        case 'BT': tm = tlm = [1, 0, 0, 1, 0, 0]; break;
        case 'Tf': font = a[0]?.name ?? font; size = Number(a[1]) || size; break;
        case 'TL': leading = Number(a[0]) || 0; break;
        case 'Td': nextLine(Number(a[0]) || 0, Number(a[1]) || 0); break;
        case 'TD': leading = -(Number(a[1]) || 0); nextLine(Number(a[0]) || 0, Number(a[1]) || 0); break;
        case 'Tm': if (a.length >= 6) tm = tlm = a.slice(-6).map(Number); break;
        case 'T*': nextLine(0, -leading); break;
        case 'Tj': if (a[0]?.str != null) show(a[0].str); break;
        case "'": nextLine(0, -leading); if (a[0]?.str != null) show(a[0].str); break;
        case '"': nextLine(0, -leading); if (a[2]?.str != null) show(a[2].str); break;
        case 'TJ': if (Array.isArray(a[0])) show(a[0].filter((x) => x?.str != null).map((x) => x.str).join('')); break;
        default:
      }
    }
  });
  // Pages are drawn upside down (y up); flip so rows read top to bottom.
  for (const t of out) t.y = -t.y;
  return out;
}

// Text pieces grouped into rows (the same line within `tolerance` points), left to right.
export function pdfRows(bytes, { tolerance = 2 } = {}) {
  return rowsFromTexts(pdfTexts(bytes), { tolerance });
}

export function rowsFromTexts(texts, { tolerance = 2 } = {}) {
  const rows = [];
  const byPage = new Map();
  for (const t of texts) byPage.set(t.page, [...(byPage.get(t.page) ?? []), t]);
  for (const page of [...byPage.keys()].sort((a, b) => a - b)) {
    const list = byPage.get(page).sort((a, b) => a.y - b.y || a.x - b.x);
    let row = [], y = null;
    for (const t of list) {
      if (y != null && Math.abs(t.y - y) > tolerance) { rows.push(row.sort((a, b) => a.x - b.x).map((r) => r.text.trim())); row = []; }
      if (!row.length) y = t.y;
      row.push(t);
    }
    if (row.length) rows.push(row.sort((a, b) => a.x - b.x).map((r) => r.text.trim()));
  }
  return rows;
}
