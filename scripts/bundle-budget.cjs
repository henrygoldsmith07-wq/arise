#!/usr/bin/env node
// bundle-budget.cjs — enforce bundle size budgets as a build/CI gate.
//
// Baselines (this branch, measured locally after route splitting):
//   boot (index + vendor, gzip): 160.8 kB → budget 190 kB
//   single lazy chunk (gzip):     37 kB   → budget 45 kB (largest is the
//                                            analytics worker, on-demand)
//   total JS (gzip):             266 kB   → budget 300 kB (worker included;
//                                            it never blocks the main thread)
//
// The budgets are regression bounds with headroom, not aspirations: a change
// that crosses one must either undo the bloat or consciously re-baseline here
// and say why in the PR.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const dist = path.join(__dirname, '..', 'dist');
if(!fs.existsSync(dist)){
  console.error('bundle-budget: dist/ missing — run the build first.');
  process.exit(2);
}

const BOOT_BUDGET_KB = 190;
const CHUNK_BUDGET_KB = 45;
const TOTAL_BUDGET_KB = 300;

function gzipSize(file){
  return zlib.gzipSync(fs.readFileSync(file)).length;
}

const files = fs.readdirSync(path.join(dist, 'assets')).filter((f)=> f.endsWith('.js'));
let bootKb = 0, totalKb = 0, worstChunkKb = 0, worstChunk = '';
const rows = [];
for(const f of files){
  const kb = gzipSize(path.join(dist, 'assets', f)) / 1024;
  totalKb += kb;
  if(f.startsWith('index') || f.startsWith('vendor')) bootKb += kb;
  else if(kb > worstChunkKb){ worstChunkKb = kb; worstChunk = f; }
  rows.push(`  ${f.padEnd(44)} ${kb.toFixed(1).padStart(7)} kB gz`);
}

console.log('Bundle sizes (gzip):');
console.log(rows.join('\n'));

const failures = [];
if(bootKb > BOOT_BUDGET_KB) failures.push(`boot chunk ${bootKb.toFixed(1)} kB > ${BOOT_BUDGET_KB} kB budget`);
if(worstChunkKb > CHUNK_BUDGET_KB) failures.push(`largest lazy chunk ${worstChunk} ${worstChunkKb.toFixed(1)} kB > ${CHUNK_BUDGET_KB} kB budget`);
if(totalKb > TOTAL_BUDGET_KB) failures.push(`total JS ${totalKb.toFixed(1)} kB > ${TOTAL_BUDGET_KB} kB budget`);

console.log(`boot ${bootKb.toFixed(1)} / ${BOOT_BUDGET_KB} kB · largest lazy ${worstChunkKb.toFixed(1)} / ${CHUNK_BUDGET_KB} kB · total ${totalKb.toFixed(1)} / ${TOTAL_BUDGET_KB} kB`);

if(failures.length){
  console.error('\nbundle-budget FAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('bundle-budget passed.');
