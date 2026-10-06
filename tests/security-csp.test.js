import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.join(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const read = (rel)=> fs.readFileSync(path.join(ROOT, rel), 'utf8');

function cspFromIndex(){
  const match = read('index.html').match(/<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)"/);
  assert.ok(match, 'index.html declares a Content-Security-Policy meta tag');
  return match[1];
}

function cspFromVercel(){
  const vercel = JSON.parse(read('vercel.json'));
  for(const entry of (vercel.headers || [])){
    for(const header of (entry.headers || [])){
      if(header.key === 'Content-Security-Policy') return header.value;
    }
  }
  throw new Error('vercel.json has no Content-Security-Policy header');
}

describe('content security policy', ()=>{
  it('is identical in index.html and vercel.json', ()=>{
    // These were two hand-maintained copies that could silently disagree.
    assert.equal(
      cspFromIndex(),
      cspFromVercel(),
      'index.html and vercel.json declare different policies. Run `npm run build` to regenerate both.',
    );
  });

  it('matches what the generator produces for the shipped default', ()=>{
    // buildCsp(false), not buildCsp(INTEGRATIONS_ON): the files on disk always
    // describe the shipped default, whichever configuration the test run is in.
    const { buildCsp } = require('../scripts/gen-csp.cjs');
    assert.equal(cspFromIndex(), buildCsp(false));
    assert.equal(cspFromVercel(), buildCsp(false));
  });

  it('permits no third-party connect target by default', ()=>{
    const connectSrc = cspFromIndex().split(';').map(s=> s.trim()).find(s=> s.startsWith('connect-src'));
    assert.ok(connectSrc, 'the policy declares connect-src');
    const external = connectSrc.replace('connect-src', '').trim().split(/\s+/).filter(o=> o !== "'self'");
    assert.deepEqual(
      external,
      ['https://bryllim.github.io'],
      'with integrations compiled out, the illustration CDN is the only external connect target',
    );
  });

  it('does not allowlist any host the app never contacts', ()=>{
    // api.github.com was permitted for years with no caller anywhere in src/.
    assert.ok(!cspFromIndex().includes('api.github.com'), 'the unused api.github.com origin must not be allowlisted');
  });

  it('keeps the integration origins out of the default build', ()=>{
    const policy = cspFromIndex();
    assert.ok(!policy.includes('integrate.api.nvidia.com'), 'NVIDIA must not be reachable in the default build');
    assert.ok(!policy.includes('classifier.dev'), 'classifier.dev must not be reachable in the default build');
  });

  it('does not require unsafe-inline for scripts', ()=>{
    const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const header = vercel.headers.flatMap(row=> row.headers || []).find(row=> row.key === 'Content-Security-Policy')?.value || '';
    assert.match(index, /script-src 'self'/);
    assert.doesNotMatch(index, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(header, /script-src[^;]*'unsafe-inline'/);
    assert.match(index, /<script src="\/boot\.js"><\/script>/);
  });

  it('keeps the generated offline fallback free of inline event handlers', ()=>{
    const generator = fs.readFileSync(new URL('../scripts/gen-offline.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(generator, /onclick=/i);
  });

  it('forbids framing, plugins and form posts to elsewhere', ()=>{
    const policy = cspFromIndex();
    assert.match(policy, /frame-ancestors 'none'/);
    assert.match(policy, /object-src 'none'/);
    assert.match(policy, /form-action 'self'/);
    assert.match(policy, /base-uri 'self'/);
  });
});

describe('integration build flag', ()=>{
  it('defaults to off for the hosted build', ()=>{
    const { buildCsp } = require('../scripts/gen-csp.cjs');
    const off = buildCsp(false);
    const on = buildCsp(true);
    assert.ok(!off.includes('integrate.api.nvidia.com'));
    assert.ok(!off.includes('classifier.dev'));
    // The flag must actually change the policy, or "off" is meaningless.
    assert.ok(on.includes('https://integrate.api.nvidia.com'));
    assert.ok(on.includes('https://classifier.dev'));
  });

  it('is a compile-time constant, not a runtime setting', ()=>{
    const source = read('src/lib/integrations.js');
    assert.match(source, /import\.meta\.env\.VITE_ARISE_INTEGRATIONS/);
    // No storage, URL parameter or toggle may flip it at runtime — that would
    // defeat the entire point of the flag. Comments are stripped first: this
    // module discusses localStorage precisely to rule it out.
    const code = source.split('\n').filter(line=> !/^\s*(\/\/|\*|\/\*)/.test(line)).join('\n');
    assert.ok(
      !/localStorage|sessionStorage|URLSearchParams|searchParams/i.test(code),
      'the integration flag must not be readable from or writable through runtime state',
    );
  });

  it('rewrites policy files only when run, not when imported', ()=>{
    // The first version of gen-csp.cjs rewrote index.html at require() time,
    // so `npm run test:integrations` silently shipped the integrations-ON
    // policy into the source tree. Importing it must be inert.
    const generator = read('scripts/gen-csp.cjs');
    assert.match(generator, /require\.main === module/);
  });
});
