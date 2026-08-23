import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runComparativeStudy, validateDeloadDecisions } from '../src/lib/study.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = process.argv[2] || path.join(here, 'fixtures', 'synthetic-history.json');
const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// Retrospective bootstrap of the comparative study on the synthetic corpus.
// This validates the harness mechanics (prior-only replay, pairing, gates) —
// it is NOT external evidence; real conclusions need the prospective ledger.
const study = runComparativeStudy(dataset.history || []);
const deloads = validateDeloadDecisions(dataset.deloadDecisions || [], dataset.history || []);

const pct = v => v == null ? '—' : `${Math.round(v * 100)}%`;
console.log(`Comparative progression study (${dataset.kind}, ${study.transitions} transitions)`);
console.log(`  priors version: ${study.priorsVersion} · sample gate: ${study.minimumSamples}`);
for(const [arm, row] of Object.entries(study.overall)){
  console.log(`  ${arm.padEnd(20)} n=${String(row.n).padEnd(4)} met ${pct(row.targetAchievementRate).padEnd(5)} success ${pct(row.progressionSuccessRate).padEnd(5)} stagnation ${pct(row.stagnationRate).padEnd(5)} regression ${pct(row.regressionRate).padEnd(6)} over-conservative ${pct(row.unnecessaryConservatismRate)} ${row.conclusive ? '' : '(inconclusive)'}`);
}
for(const [arm, pair] of Object.entries(study.pairedVsArise)){
  if(!pair.pairs) continue;
  console.log(`  paired vs arise [${arm}] arise wins ${pair.ariseWins} · baseline wins ${pair.baselineWins} · both ${pair.bothMetTarget} · neither ${pair.neitherMetTarget}`);
}

const DIMS=['byStructure','byEquipmentClass','byStrategy','byRepRange','byFrequency','byReadiness'];
for(const dim of DIMS){
  for(const [key,arms] of Object.entries(study.segments?.[dim]||{})){
    const a=arms.arise,d=arms['double-progression'];
    if(a?.conclusive&&d) console.log(  segment = n=+a.n+' arise met '+Math.round((a.targetAchievementRate||0)*100)+'% vs DP '+Math.round((d.targetAchievementRate||0)*100)+'%');
  }
}
console.log('Deload decisions observed:');
if(deloads.decisions){
  console.log(`  cuts actually applied: ${pct(deloads.cutsObservedRate)} · volume normalised ≤2wks: ${pct(deloads.normalisedWithinTwoWeeksRate)}`);
}else{
  console.log('  none recorded in this fixture.');
}
