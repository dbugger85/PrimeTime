// Adds ?v=<version> to the page's own files before publishing, so a browser
// can never mix a cached old file with a new one (that left the page stuck on
// "Loading…" after an update). Runs in GitHub Actions only; the repo keeps the
// plain names so `npm start` works locally.
//   node scripts/stamp.mjs <version> [dir]

import { readFileSync, writeFileSync } from 'node:fs';

export function stamp(html, js, v) {
  return {
    html: html
      .replace(/(href|src)="\.\/(style\.css|app\.js)"/g, `$1="./$2?v=${v}"`),
    js: js.replace(/from '\.\/logic\.js'/g, `from './logic.js?v=${v}'`),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [v, dir = 'docs'] = process.argv.slice(2);
  if (!v) throw new Error('usage: node scripts/stamp.mjs <version> [dir]');
  const out = stamp(readFileSync(`${dir}/index.html`, 'utf8'), readFileSync(`${dir}/app.js`, 'utf8'), v);
  writeFileSync(`${dir}/index.html`, out.html);
  writeFileSync(`${dir}/app.js`, out.js);
  console.log(`stamped ${dir} with v=${v}`);
}
