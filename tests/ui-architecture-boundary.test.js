import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const COMPONENT_ROOT = join(process.cwd(), 'src', 'components');
const FORBIDDEN = [
  '../lib/storage.js',
  '../lib/storageQuota.js',
  '../lib/idb.js',
  '../lib/idb-tx.js',
  '../lib/archive.js',
  '../lib/audit.js',
  '../lib/snapshots.js',
  '../lib/migrationLog.js',
  '../repositories/',
];

function sourceFiles(dir){
  const out = [];
  for(const entry of readdirSync(dir, { withFileTypes:true })){
    const path = join(dir, entry.name);
    if(entry.isDirectory()) out.push(...sourceFiles(path));
    else if(/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) out.push(path);
  }
  return out;
}

describe('feature UI architecture boundary', ()=>{
  it('keeps persistence and repositories behind services', ()=>{
    const violations = [];
    for(const path of sourceFiles(COMPONENT_ROOT)){
      const source = readFileSync(path, 'utf8');
      for(const forbidden of FORBIDDEN){
        if(source.includes(forbidden)) violations.push(`${relative(process.cwd(), path)} -> ${forbidden}`);
      }
    }
    assert.deepEqual(violations, [], `Feature components bypassed application services:\n${violations.join('\n')}`);
  });
});
