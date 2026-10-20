#!/usr/bin/env node
// scripts/gen-sw.cjs — stamp the built service worker with its precache list.
//
// Runs after `vite build`. public/sw.js ships two placeholders:
//   const CACHE = 'arise-v6';   → 'arise-v6-<hash of the build>'
//   const PRECACHE = [];        → every emitted file under assets/, plus boot.js
//
// Without this the SW cached only the HTML shell: the entry bundle loads before
// the worker controls the page, so it never reached the cache, and a user who
// installed the app and went offline reopened it to a blank screen. A per-build
// cache name also lets activate() drop the previous build's files instead of
// accumulating every deploy's hashed chunks in one cache forever.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');
const CACHE_PATTERN = /const CACHE = '([^']+)';/;
const PRECACHE_PATTERN = /const PRECACHE = \[\];/;

function listAssets(dir, prefix = 'assets'){
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry)=> entry.isDirectory()
    ? listAssets(path.join(dir, entry.name), `${prefix}/${entry.name}`)
    : [`${prefix}/${entry.name}`]);
}

// Pure: the tests call this on the committed public/sw.js.
function stampServiceWorker(source, files){
  if(!CACHE_PATTERN.test(source) || !PRECACHE_PATTERN.test(source)){
    throw new Error('gen-sw: sw.js no longer declares the CACHE / PRECACHE placeholders. Fix one of them.');
  }
  const urls = [...files].sort().map((f)=> `./${f}`);
  const hash = crypto.createHash('sha256').update(urls.join('\n')).update(source).digest('hex').slice(0, 10);
  return source
    .replace(CACHE_PATTERN, (_m, base)=> `const CACHE = '${base}-${hash}';`)
    .replace(PRECACHE_PATTERN, `const PRECACHE = ${JSON.stringify(urls)};`);
}

module.exports = { stampServiceWorker };

if(require.main === module){
  const swPath = path.join(DIST, 'sw.js');
  const files = [...listAssets(path.join(DIST, 'assets')), 'boot.js'];
  const stamped = stampServiceWorker(fs.readFileSync(swPath, 'utf8'), files);
  fs.writeFileSync(swPath, stamped, 'utf8');
  console.log(`gen-sw: ${files.length} files precached · ${stamped.match(CACHE_PATTERN)[1]}`);
}
