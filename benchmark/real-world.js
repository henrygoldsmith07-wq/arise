// benchmark/real-world.js — real-world validation harness for Arise.
//
// Runs the full validation battery from src/lib/realWorldValidation.js against
// either a portable app export or an already-formatted benchmark dataset:
// outcome classes (success/failure/stagnation/regression), noisy-session
// detection, substitution quality, load rounding, and longitudinal
// effectiveness. A synthetic fixture result is a smoke test, never evidence.
//
// Usage: node benchmark/real-world.js [path-to-export.json] [--consent] [--write]
//   --consent  records that the export was supplied with consent (required in
//              the metadata before any result may be described as validated)
//   --write    writes benchmark/results.real-world.md

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { datasetFromPortableExport, realWorldValidationReport } from '../src/lib/realWorldValidation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const inputPath = args.find(arg=> !arg.startsWith('--')) || path.join(here, 'fixtures', 'real-history.example.json');
const consent = args.includes('--consent');
const write = args.includes('--write');

let payload;
try{
  payload = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}catch(error){
  console.error(`Could not read ${inputPath}: ${error.message}`);
  process.exit(1);
}

const isDataset = payload?.formatVersion != null && Array.isArray(payload?.history);
const dataset = isDataset ? payload : datasetFromPortableExport(payload, { consent });
if(!isDataset && !consent){
  console.log('Note: loaded as a portable export without --consent; metadata records no consent.\n');
}

const report = realWorldValidationReport(dataset);
if(report.status === 'invalid'){
  console.error(`Dataset invalid (${inputPath}):`);
  for(const issue of report.validation.issues) console.error(`  - ${issue}`);
  process.exit(1);
}

const pct = value=> value == null ? '—' : `${(value * 100).toFixed(1)}%`;
console.log(`Arise real-world validation (${dataset.kind}, status: ${report.status})`);
console.log(`  input: ${path.relative(process.cwd(), inputPath)}`);
console.log(`  comparisons: ${report.comparisons} across ${report.provenance.coverage.sessions} sessions`);
console.log(`  consent recorded: ${report.provenance.metadata?.consent ? 'yes' : 'NO — not evidence-grade'}`);

console.log('\nOutcomes (prescription vs next-session performance)');
for(const cls of ['success', 'failure', 'stagnation', 'regression']){
  const count = report.outcomes.counts[cls];
  console.log(`  ${cls.padEnd(11)} ${String(count).padStart(4)}  ${pct(report.outcomes.rates[cls])}`);
}
console.log(`  unknown     ${String(report.outcomes.counts.unknown).padStart(4)}  (no prior exposure)`);

console.log('\nNoisy-session detection');
const noisy = report.noisySessionDetection;
if(noisy.n){
  console.log(`  n=${noisy.n}, predicted bad ${noisy.predictedBad}, actually bad ${noisy.actualBad}`);
  console.log(`  precision=${pct(noisy.precision)} recall=${pct(noisy.recall)} specificity=${pct(noisy.specificity)} accuracy=${pct(noisy.accuracy)} Brier=${noisy.brier}`);
}else{
  console.log(`  ${noisy.note}`);
}

console.log('\nSubstitution quality');
const pairs = report.substitutions.pairs;
if(pairs.available){
  console.log(`  audited pairs: ${pairs.n} (engine-proposed substitutes with enough shared history)`);
  console.log(`  muscle preserved ${pct(pairs.musclePreservationRate)}, pattern preserved ${pct(pairs.patternPreservationRate)}, declared alternatives ${pct(pairs.declaredRate)}`);
  console.log(`  median rank of logged substitutes: ${pairs.medianRankOfSubstitutes ?? '—'} · top-ranked share ${pct(pairs.topRankedShare)}`);
  console.log(`  progression aligned ${pairs.alignedCount}, divergent ${pairs.divergentCount}, both flat ${pairs.bothFlatCount} (alignment rate ${pct(pairs.progressionAlignmentRate)})`);
}else{
  console.log(`  pairs: ${pairs.note}`);
}
const swaps = report.substitutions.swaps;
if(swaps.available){
  console.log(`  swap events vs schedule: ${swaps.n} · muscle preserved ${pct(swaps.musclePreservationRate)}, pattern preserved ${pct(swaps.patternPreservationRate)}`);
}

console.log('\nLoad rounding');
const rounding = report.loadRounding;
if(rounding.n){
  console.log(`  load recommendations checked: ${rounding.n}`);
  console.log(`  on priors rounding grid: ${pct(rounding.onRoundingGridRate)}`);
  if(rounding.barbellProfile){
    console.log(`  plate-achievable: ${pct(rounding.plateAchievableRate)} · mean |Δ| ${rounding.meanPlateDeltaKg ?? '—'}kg · max |Δ| ${rounding.maxPlateDeltaKg ?? '—'}kg`);
    console.log(`  rounded rec within tolerance of actual next load: ${pct(rounding.usableAgainstActualRate)}`);
    console.log(`  logged loads plate-achievable: ${pct(rounding.loggedLoadsPlateAchievableRate)}`);
  }else{
    console.log('  profile has no barbell — plate checks skipped (grid check still applies)');
  }
}else{
  console.log('  No load recommendations were evaluable.');
}

console.log('\nLongitudinal effectiveness');
const long = report.longitudinal;
console.log(`  ${long.sessions} sessions over ${long.spanDays ?? '—'} days (${long.sessionsPerWeek ?? '—'}/week${long.scheduledSessionsPerWeek != null ? `, planned ${long.scheduledSessionsPerWeek}/week` : ''})`);
if(long.cycles.length >= 2 && long.cycleComparison){
  console.log(`  cycle ${long.cycles.length - 1} → ${long.cycles.length}: e1RM ${long.cycleComparison.e1rmChangePct ?? '—'}%, volume ${long.cycleComparison.volumeChangePct ?? '—'}%`);
}else if(long.cycles.length === 1){
  console.log('  one ~28-day cycle so far — log another block to compare');
}
console.log(`  exercises progressing=${long.progressingExercises} flat=${long.flatExercises} regressing=${long.regressingExercises} insufficient=${long.insufficientExercises}`);
console.log(`  verdict: ${long.verdict}${report.note ? ` · ${report.note}` : ''}`);

if(write){
  const lines = [
    '# Arise — real-world validation result',
    '',
    `Input: \`${path.relative(path.join(here, '..'), inputPath)}\` · kind: **${dataset.kind}** · status: **${report.status}**`,
    `Consent recorded: ${report.provenance.metadata?.consent ? 'yes' : '**no — structural check only, not evidence about real training**'}.`,
    `Generated: ${report.generatedAt} · comparisons: ${report.comparisons}`,
    '',
    '| Section | Metric | Result |',
    '|---|---|---|',
    `| Outcomes | success / failure / stagnation / regression | ${report.outcomes.counts.success} / ${report.outcomes.counts.failure} / ${report.outcomes.counts.stagnation} / ${report.outcomes.counts.regression} (unknown ${report.outcomes.counts.unknown}) |`,
    ...(['success', 'failure', 'stagnation', 'regression'].map(cls=> `| Outcomes | ${cls} rate | ${pct(report.outcomes.rates[cls])} |`)),
    `| Noisy sessions | precision / recall / accuracy | ${pct(noisy.precision)} / ${pct(noisy.recall)} / ${pct(noisy.accuracy)} (Brier ${noisy.brier ?? '—'}, n=${noisy.n}) |`,
    `| Substitutions | muscle / pattern preservation | ${pct(pairs.musclePreservationRate)} / ${pct(pairs.patternPreservationRate)} over ${pairs.n} pairs |`,
    `| Substitutions | progression alignment rate | ${pct(pairs.progressionAlignmentRate)} (aligned ${pairs.alignedCount}, divergent ${pairs.divergentCount}) |`,
    swaps.available ? `| Substitutions | swap events | ${swaps.n} events, muscle preserved ${pct(swaps.musclePreservationRate)} |` : '| Substitutions | swap events | no schedule provided |',
    `| Load rounding | on grid / plate-achievable | ${pct(rounding.onRoundingGridRate)} / ${rounding.plateAchievableRate == null ? 'skipped (no barbell)' : pct(rounding.plateAchievableRate)} |`,
    `| Load rounding | usable vs actual next load | ${rounding.usableAgainstActualRate == null ? '—' : pct(rounding.usableAgainstActualRate)} |`,
    `| Longitudinal | sessions / span | ${long.sessions} over ${long.spanDays ?? '—'} days (${long.sessionsPerWeek ?? '—'}/week) |`,
    `| Longitudinal | last cycle comparison | e1RM ${long.cycleComparison?.e1rmChangePct ?? '—'}%, volume ${long.cycleComparison?.volumeChangePct ?? '—'}% |`,
    `| Longitudinal | verdict | ${long.verdict} |`,
    '',
    report.note || '',
    '',
  ].filter(line=> line !== '');
  fs.writeFileSync(path.join(here, 'results.real-world.md'), lines.join('\n'));
  console.log('\nWrote benchmark/results.real-world.md');
}
