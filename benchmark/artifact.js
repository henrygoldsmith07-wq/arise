#!/usr/bin/env node
// benchmark/artifact.js — write benchmark artifacts for cross-commit comparison,
// and compare the current artifact against a checked-in baseline.
//
//   node benchmark/artifact.js write   → benchmark/results.artifact.json (hash+seed stamped)
//   node benchmark/artifact.js compare [baseline.json] → exit 1 on drift
//
// The artifact carries the fixture hash, priors/policy versions and the metrics
// text, so two commits are comparable ONLY when the corpus and the decision
// versions match — a fixture or policy change is a conscious re-baseline.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveArisePriors } from '../src/lib/priors.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const artifactPath = path.join(here, 'results.artifact.json');

async function collect(){
  const fixturePath = path.join(here, 'fixtures', 'synthetic-history.json');
  const out = execFileSync(process.execPath, [path.join(here, 'backtest.js'), fixturePath], { encoding: 'utf8', cwd: root });
  const grab = (re)=> { const m = out.match(re); return m ? Number(m[1]) : null; };
  const metrics = {
    loadMAE: grab(/load MAE:\s*([\d.]+)kg/),
    repMAE: grab(/rep MAE:\s*([\d.]+)/),
    completionBrier: grab(/completion Brier:\s*([\d.]+)/),
    fatigueBrier: grab(/fatigue Brier:\s*([\d.]+)/),
    comparisons: grab(/Comparisons:\s*(\d+)/),
  };
  const priors = resolveArisePriors(null);
  return {
    schema: 'arise.benchmark.artifact.v1',
    generatedAtISO: new Date().toISOString(),
    corpus: { fixture: 'synthetic-history.json', sha256: crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex') },
    versions: { priors: priors.version, progressionModel: priors.progressionModel?.version ?? null, policy: 1 },
    metricsText: out,
    metrics,
  };
}

function write(){
  // Async import dance: collect is async because of the dynamic import.
  return collect().then((artifact)=>{
    fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2) + '\n');
    console.log(`  artifact written: ${path.relative(root, artifactPath)} (corpus ${artifact.corpus.sha256.slice(0, 12)}, priors v${artifact.versions.priors})`);
  });
}

function compare(baselinePath = artifactPath){
  if(!fs.existsSync(baselinePath)){
    console.log(`  no baseline artifact at ${path.relative(root, baselinePath)} — nothing to compare (write one first).`);
    return;
  }
  const base = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  return collect().then((cur)=>{
    const sameCorpus = base.corpus?.sha256 === cur.corpus.sha256;
    const sameVersions = JSON.stringify(base.versions) === JSON.stringify(cur.versions);
    if(!sameCorpus) console.log('  ⚠ fixture changed since baseline — metric drift is expected; re-baseline consciously.');
    if(!sameVersions) console.log('  ⚠ priors/policy versions changed since baseline — re-baseline consciously.');
    let drifted = false;
    for(const [k, v] of Object.entries(cur.metrics)){
      const b = base.metrics?.[k];
      if(b == null || v == null) continue;
      if(Math.abs(v - b) > 1e-9){ drifted = true; console.log(`  Δ ${k}: baseline ${b} → now ${v}`); }
    }
    if(drifted && sameCorpus && sameVersions){
      console.log('  METRIC DRIFT on an unchanged corpus+versions — investigate before committing.');
      process.exitCode = 1;
    } else {
      console.log('  comparison done: no unexplained drift.');
    }
  });
}

const mode = process.argv[2] || 'write';
if(mode === 'write') await write();
else if(mode === 'compare') await compare(process.argv[3]);
else { console.error('usage: node benchmark/artifact.js [write|compare]'); process.exit(2); }
