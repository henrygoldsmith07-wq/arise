import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STORE_SCHEMA_VERSION } from '../src/lib/store.js';
import { VALIDATION_SCHEMA_VERSION, validateStoreData } from '../src/lib/storeValidation.js';
import * as exportMod from '../src/lib/export.js';

const ROOT = path.resolve('src');
const STATIC_IMPORT = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+'([^']+)'|(?:^|\n)\s*import\s+'([^']+)'/g;

function staticClosure(entry){
  const seen = new Set([entry]);
  const queue = [entry];
  while(queue.length){
    const file = queue.shift();
    const src = fs.readFileSync(file, 'utf8');
    for(const m of src.matchAll(STATIC_IMPORT)){
      const spec = m[1] || m[2];
      if(!spec || !spec.startsWith('.')) continue;
      let target = path.resolve(path.dirname(file), spec);
      if(!fs.existsSync(target) || fs.statSync(target).isDirectory()) continue;
      if(!seen.has(target)){ seen.add(target); queue.push(target); }
    }
  }
  return [...seen].map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
}

test('boot (main.jsx static closure) never pulls the export/evidence/progression graph', () => {
  const closure = staticClosure(path.join(ROOT, 'main.jsx'));
  for(const heavy of ['lib/export.js', 'lib/longitudinal.js', 'lib/evaluation.js', 'lib/study.js', 'lib/priors.js', 'lib/progression.js', 'lib/trainingExperiments.js']){
    assert.ok(!closure.includes(heavy), `${heavy} leaked into the first-paint graph`);
  }
  assert.ok(closure.includes('lib/storeValidation.js'), 'integrity gate still reaches the standalone validator');
});

test('validator schema constant tracks the store schema version', () => {
  assert.equal(VALIDATION_SCHEMA_VERSION, STORE_SCHEMA_VERSION);
});

test('export.js re-exports the same validator and it still rejects bad stores', () => {
  assert.equal(exportMod.validateStoreData, validateStoreData);
  assert.equal(validateStoreData({ history: 'x' }).ok, false);
  assert.equal(validateStoreData({ version: STORE_SCHEMA_VERSION + 1 }).ok, false);
  assert.equal(validateStoreData({ history: [{ id: 'a', dateISO: '2026-10-01', blocks: [] }] }).ok, true);
});
