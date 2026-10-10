#!/usr/bin/env node
// scripts/gen-csp.cjs — emit the ONE Content-Security-Policy this build uses.
//
// The CSP is a security control, so it must not drift from what the bundle can
// actually do. Today it lived as two hand-maintained copies (an index.html
// meta tag and a vercel.json header) that could disagree, and it allowlisted
// hosts the shipped code never contacts — api.github.com was permitted with
// no consumer anywhere in src/.
//
// This generator is the single source of truth. It derives connect-src from
// the VITE_ARISE_INTEGRATIONS flag, so a build with the integrations compiled
// out does not merely refuse to call them — its CSP does not even permit the
// connection. The result is written to both index.html and vercel.json, and
// tests/security-csp.test.js asserts the two stay identical.
//
// Illustration frames are the one deliberate third-party read: they are public,
// content-addressed exercise SVG animations, they carry no user data, and they
// are declared in img-src and connect-src for the service worker to cache.
// If the illustration CDN is ever removed, remove it here too — do not leave a
// permissive allowlist entry behind.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ILLUSTRATION_HOST = 'https://bryllim.github.io';

// Loopback origins are always permitted for connect-src: the out-of-box AI
// coach runs against a local endpoint (Ollama / llama.cpp) on 127.0.0.1, and
// WebDAV sync is a user-configured option. Loopback HTTP is safe under CSP
// because no third party ever receives the traffic; the threat CSP mitigates is
// exfiltration to foreign origins, and localhost/loopback are by definition
// "this device".
const LOOPBACK_ORIGINS = ['http://127.0.0.1:11434', 'http://localhost:11434', 'http://[::1]:11434'];

// Hosts each optional integration needs. Emitted only when compiled in.
const INTEGRATION_ORIGINS = ['https://classifier.dev'];

// Pure: the tests call this with both values so they can assert on a build
// configuration they are not currently running.
function buildCsp(integrationsOn){
  const connectSrc = [
    "'self'",
    ILLUSTRATION_HOST,
    ...LOOPBACK_ORIGINS,
    ...(integrationsOn ? INTEGRATION_ORIGINS : []),
  ];
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' ${ILLUSTRATION_HOST} data:`,
    "font-src 'self' data:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const INTEGRATIONS_ON = String(process.env.VITE_ARISE_INTEGRATIONS || 'off').toLowerCase() === 'on';
const CSP = buildCsp(INTEGRATIONS_ON);

module.exports = { buildCsp, CSP, INTEGRATIONS_ON, ILLUSTRATION_HOST, INTEGRATION_ORIGINS, LOOPBACK_ORIGINS };

// Rewriting the files is a BUILD step, not a module side effect. Without this
// guard the test suite — which imports this file to check the policy — silently
// rewrote index.html and vercel.json to whatever the current environment said.
// tests/security-csp.test.js depends on requiring this being inert.
if(require.main === module) writePolicyFiles();

function replaceOnce(source, pattern, replacement, file){
  if(!pattern.test(source)){
    throw new Error(`gen-csp: could not find the CSP declaration in ${file}. ` +
      'The generator and the file have drifted — fix one of them.');
  }
  return source.replace(pattern, replacement);
}

function writePolicyFiles(){
  const indexPath = path.join(ROOT, 'index.html');
  const index = fs.readFileSync(indexPath, 'utf8');
  const nextIndex = replaceOnce(
    index,
    /(<meta http-equiv="Content-Security-Policy"\s+content=")[^"]*("\s*\/?>)/,
    (_m, open, close) => `${open}${CSP}${close}`,
    'index.html',
  );

  const vercelPath = path.join(ROOT, 'vercel.json');
  const vercel = JSON.parse(fs.readFileSync(vercelPath, 'utf8'));
  let touched = 0;
  for(const entry of (vercel.headers || [])){
    for(const header of (entry.headers || [])){
      if(header.key === 'Content-Security-Policy'){ header.value = CSP; touched += 1; }
    }
  }
  if(touched === 0) throw new Error('gen-csp: vercel.json has no Content-Security-Policy header to update.');

  if(nextIndex !== index) fs.writeFileSync(indexPath, nextIndex, 'utf8');
  fs.writeFileSync(vercelPath, `${JSON.stringify(vercel, null, 2)}\n`, 'utf8');

  const connectSrc = CSP.split('; ').find(part=> part.startsWith('connect-src'));
  console.log(`gen-csp: integrations=${INTEGRATIONS_ON ? 'on' : 'off'} · ${connectSrc}`);
}
