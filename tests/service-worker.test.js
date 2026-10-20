import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { stampServiceWorker } = require('../scripts/gen-sw.cjs');
const source = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');

describe('service worker', ()=>{
  it('leaves activation to the app: install never calls skipWaiting()', ()=>{
    // An unconditional skipWaiting() in install activated every update at
    // once, so the app's "defer the update while a workout runs" path never
    // had a waiting worker to defer.
    const install = source.slice(source.indexOf("addEventListener('install'"), source.indexOf("addEventListener('activate'"));
    assert.ok(install.length > 0, 'sw.js has an install handler');
    assert.doesNotMatch(install.replace(/\/\/.*$/gm, ''), /skipWaiting\(/);
    assert.match(source, /e\.data==='SKIP_WAITING'\) self\.skipWaiting\(\)/, 'the app can still activate an update on request');
  });

  it('precaches every built file and versions the cache per build', ()=>{
    const files = ['assets/index-abc.js', 'assets/vendor-def.js', 'assets/index-ghi.css', 'boot.js'];
    const stamped = stampServiceWorker(source, files);
    for(const f of files) assert.ok(stamped.includes(`"./${f}"`), `${f} is precached`);
    assert.match(stamped, /const CACHE = 'arise-v6-[0-9a-f]{10}';/);
    assert.match(stamped, /c\.addAll\(\[\.\.\.SHELL, \.\.\.PRECACHE\]\)/);
    const other = stampServiceWorker(source, ['assets/index-zzz.js', 'boot.js']);
    assert.notEqual(other.match(/const CACHE = '([^']+)'/)[1], stamped.match(/const CACHE = '([^']+)'/)[1], 'a new build gets a new cache name');
  });

  it('is deterministic for the same build', ()=>{
    assert.equal(stampServiceWorker(source, ['b.js', 'a.js']), stampServiceWorker(source, ['a.js', 'b.js']));
  });

  it('fails loudly when the placeholders drift', ()=>{
    assert.throws(()=> stampServiceWorker(source.replace('const PRECACHE = [];', 'const PRECACHE = [1];'), []), /placeholders/);
  });
});
