// Adds ?v=<version> to the page's own files before publishing, so a browser
// can never mix a cached old file with a new one (that left the page stuck on
// "Loading…" after an update). Runs in GitHub Actions only; the repo keeps the
// plain names so `npm start` works locally.
//   node scripts/stamp.mjs <version> [dir]
// Every module in docs/ gets its imports of the other modules stamped (app.js imports
// logic.js, live.js and scoring.js; scoring.js imports live.js), so a new module needs nothing here.

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

export function stamp(html, js, v) {
  return {
    html: html
      .replace(/(href|src)="\.\/(style\.css|app\.js)"/g, `$1="./$2?v=${v}"`),
    js: js.replace(/from '\.\/([\w-]+)\.js'/g, `from './$1.js?v=${v}'`),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [v, dir = 'docs'] = process.argv.slice(2);
  if (!v) throw new Error('usage: node scripts/stamp.mjs <version> [dir]');
  writeFileSync(`${dir}/index.html`, stamp(readFileSync(`${dir}/index.html`, 'utf8'), '', v).html);
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    writeFileSync(`${dir}/${file}`, stamp('', readFileSync(`${dir}/${file}`, 'utf8'), v).js);
  }
  console.log(`stamped ${dir} with v=${v}`);
}
