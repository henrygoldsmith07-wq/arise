#!/usr/bin/env node
// benchmark/thresholds.js — benchmark performance thresholds as a CI gate.
//
// The synthetic fixture is a regression smoke test, not training evidence; the
// thresholds below are regression bounds on its measured metrics, chosen with
// headroom over the committed baseline (results.backtest.md). A breach means a
// change degraded replay quality — fix it, or consciously re-baseline in this
// file and say why in the PR.
//
// Usage: node benchmark/thresholds.js [artifact.json]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// Regression bounds on the synthetic smoke fixture (headroom over baseline):
const THRESHOLDS = [
  { key: 'loadMAE', label: 'Load MAE (kg)', max: 1.5, better: 'lower' },
  { key: 'repMAE', label: 'Rep MAE', max: 2.0, better: 'lower' },
  { key: 'completionBrier', label: 'Completion Brier', max: 0.45, better: 'lower' },
  { key: 'fatigueBrier', label: 'Fatigue Brier', max: 0.45, better: 'lower' },
];

function parseMetrics(output){
  const grab = (re)=> { const m = output.match(re); return m ? Number(m[1]) : null; };
  return {
    loadMAE: grab(/load MAE:\s*([\d.]+)kg/),
    repMAE: grab(/rep MAE:\s*([\d.]+)/),
    completionBrier: grab(/completion Brier:\s*([\d.]+)/),
    fatigueBrier: grab(/fatigue Brier:\s*([\d.]+)/),
  };
}

let output = '';
if(process.argv[2] && fs.existsSync(process.argv[2])){
  // Artifact JSON: { metrics: {...}, ... } produced by benchmark:artifact.
  const artifact = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  output = artifact.metricsText || '';
  if(artifact.metrics) Object.assign(output, {});
} else {
  output = execFileSync(process.execPath, [path.join(here, 'backtest.js')], { encoding: 'utf8', cwd: root });
}
const metrics = typeof output === 'string' ? parseMetrics(output) : output;

let failed = 0;
console.log('  threshold gate (synthetic fixture regression bounds):');
for(const t of THRESHOLDS){
  const v = metrics[t.key];
  if(v == null){ console.log(`    ? ${t.label}: not reported — skipping`); continue; }
  const ok = v <= t.max;
  if(!ok) failed++;
  console.log(`    ${ok ? '✓' : '✗'} ${t.label}: ${v} (max ${t.max})`);
}
if(failed){ console.log(`  THRESHOLD GATE FAILED (${failed})`); process.exit(1); }
console.log('  threshold gate passed.');
