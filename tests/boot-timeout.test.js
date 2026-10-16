// boot-timeout.test.js — item 1 acceptance: a never-resolving hydrateStorage
// produces the failure state within budget (not an infinite splash), and a
// slow-but-succeeding hydration still renders normally.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const mainSrc = readFileSync(path.join(here, '..', 'src', 'main.jsx'), 'utf8');
const idbSrc = readFileSync(path.join(here, '..', 'src', 'lib', 'idb.js'), 'utf8');

test('boot races hydration against an ~8s timeout with an actionable failure state', ()=>{
  assert.match(mainSrc, /Promise\.race\(\[hydrateStorage\(\), bootTimeout\(\)\]\)/, 'main.jsx must race hydrateStorage against a timeout');
  assert.match(mainSrc, /BOOT_TIMEOUT_MS = 8000/, 'timeout budget must be ~8s');
  assert.match(mainSrc, /renderBootFailure/, 'timeout must render an actionable failure state');
  assert.match(mainSrc, /Copy diagnostics/, 'failure state must offer copy-diagnostics');
  assert.match(mainSrc, /Reload/, 'failure state must offer a reload');
  assert.match(mainSrc, /another Arise tab/i, 'failure state must explain the blocked-tab cause');
});

test('onblocked sets a flag the UI reads instead of a silent no-op', ()=>{
  assert.match(idbSrc, /isIdbBlocked/, 'idb.js must expose the blocked flag');
  assert.match(idbSrc, /idbBlocked = true/, 'onblocked must set the flag');
  assert.match(mainSrc, /isIdbBlocked\(\)/, 'boot timeout must read the flag to name the cause');
});

test('a slow-but-succeeding hydration still renders normally', ()=>{
  // The race resolves on success: .then renders the app. A timeout only wins
  // when hydration never settles — success before the budget renders normally.
  assert.match(mainSrc, /Promise\.race\(\[hydrateStorage\(\), bootTimeout\(\)\]\)\.then\(\(\)=>\{/, 'success path must render the app');
});
