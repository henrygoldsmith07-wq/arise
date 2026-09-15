import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { findRuns } from '../scripts/mojibake-gate.cjs';

const ROOT = path.resolve(import.meta.dirname, '..');

// Built from codepoints so this test file itself stays encoding-clean.
const MOJI_EMDASH = String.fromCodePoint(0xE2, 0x20AC, 0x201D); // bytes E2-80-94 read back as CP1252 chars
const MOJI_TIMES = String.fromCodePoint(0xC3, 0x2014); // bytes C3-97 read back as CP1252 chars

describe('mojibake detection', ()=>{
  it('flags the classic UTF-8-as-CP1252 sequences with their repairs', ()=>{
    const a = findRuns(`recommendation ${MOJI_EMDASH} reason`);
    assert.equal(a.length, 1);
    assert.equal(a[0].fix, '\u2014');
    const b = findRuns(`25 ${MOJI_TIMES} 3`);
    assert.equal(b.length, 1);
    assert.equal(b[0].fix, '\u00d7');
  });
  it('leaves legitimate non-ASCII untouched', ()=>{
    assert.equal(findRuns('Rest 90s — steady, élan ✓ ×2 · 30° … ─── ok').length, 0);
    assert.equal(findRuns('Plain ascii only.').length, 0);
  });
  it('the repository passes the encoding gate', ()=>{
    const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'mojibake-gate.cjs')], { cwd: ROOT, encoding: 'utf8' });
    assert.match(out, /Encoding gate passed/);
  });
});
