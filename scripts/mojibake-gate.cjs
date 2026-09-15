// mojibake-gate.cjs — CI gate: fails on UTF-8-read-as-CP1252 damage.
// Detection is codepoint-based (no literal mojibake in this file, which
// would otherwise make the scanner flag itself). A run is reported only
// when its characters are all CP1252-reversible AND the bytes form valid,
// LONGER-DECODED UTF-8 — i.e. exactly the corruption class produced by
// Windows PowerShell round-trips. Legitimate non-ASCII (é, —, ×, ✓, ─, °,
// …) never matches, so this never asks anyone to delete real text.
const fs = require('fs');
const path = require('path');

const EXTRA = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
const REV = {};
for(const [b, u] of Object.entries(EXTRA)) REV[u] = Number(b);
for(let b = 0xA0; b <= 0xFF; b++) REV[b] = b;

function findRuns(text){
  const hits = [];
  let i = 0;
  while(i < text.length){
    const cp = text.codePointAt(i);
    if(cp >= 0x80 && cp in REV){
      let j = i;
      while(j < text.length){
        const c = text.codePointAt(j);
        if(c < 0x80 || !(c in REV)) break;
        j += c > 0xFFFF ? 2 : 1;
      }
      const run = [...text.slice(i, j)];
      if(run.length >= 2){
        const bytes = Buffer.from(run.map(ch => REV[ch.codePointAt(0)]));
        try{
          const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          if(!decoded.includes('\uFFFD') && decoded.length < run.length){
            hits.push({ text: run.join(''), fix: decoded });
          }
        }catch{}
      }
      i = j; continue;
    }
    i += cp > 0xFFFF ? 2 : 1;
  }
  return hits;
}

const SKIP = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'coverage']);
const EXT = /\.(js|jsx|ts|mjs|cjs|json|md|html|css|txt)$/;
function walk(dir, out = []){
  for(const e of fs.readdirSync(dir, { withFileTypes: true })){
    if(SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if(e.isDirectory()) walk(p, out);
    else if(EXT.test(e.name)) out.push(p);
  }
  return out;
}

let bad = 0;
if(require.main !== module){ module.exports = { findRuns }; return; }
for(const f of walk('.')){
  const text = fs.readFileSync(f, 'utf8');
  const hits = findRuns(text);
  if(hits.length){
    bad += hits.length;
    for(const h of hits.slice(0, 5)){
      const line = text.slice(0, text.indexOf(h.text)).split('\n').length;
      console.error(`mojibake: ${f}:${line} “${h.text}” should be “${h.fix}”`);
    }
    if(hits.length > 5) console.error(`mojibake: ${f}: ${hits.length - 5} more…`);
  }
}
if(bad){
  console.error(`\nEncoding gate failed: ${bad} mojibake run(s). Fix with: node scripts/repair-mojibake.cjs <files>`);
  process.exit(1);
}
console.log('Encoding gate passed — no mojibake in tracked text files.');
