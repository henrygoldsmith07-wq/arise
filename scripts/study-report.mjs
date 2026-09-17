#!/usr/bin/env node
// study-report.mjs — study-operations CLI over a directory of participant exports.
//
// Ingests every *.json export in a directory (repeated exports of the same
// person fold into one participant by their pseudonymous study id), then
// writes two reports next to it:
//   study-ops-report.md    — cohort operations (enrollment, activity, arms,
//                            data quality, analysis-gate eligibility)
//   product-success.md     — consented product-success metrics
//
// The operator workflow: collect consented exports into a folder, run
//   node scripts/study-report.mjs path/to/exports
// and read the two markdown files. Exits 0 when reports were written;
// exit 2 only when the analysis GATES are met and a real comparative run is
// due — mirroring benchmark/field-study.js so CI conventions hold.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ingestParticipantFiles, summariseCohort, renderCohortReport } from '../src/lib/cohortOps.js';
import { computeProductSuccessReport, renderProductSuccessReport } from '../src/lib/productSuccess.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirArg = args.find(a => !a.startsWith('--')) || path.join(here, '..', 'field');
const outDir = path.resolve(args.find(a => a.startsWith('--out='))?.split('=')[1] || path.dirname(path.resolve(dirArg)));
const minParticipants = Number(args.find(a => a.startsWith('--min-participants='))?.split('=')[1]) || 10;
const minTransitions = Number(args.find(a => a.startsWith('--min-transitions='))?.split('=')[1]) || 1000;

const dir = path.resolve(dirArg);
if(!fs.existsSync(dir)){
  console.log(`No participant directory at ${dir}`);
  console.log('Collect consented exports (More → Backup & portability → Export) into a folder and pass its path.');
  console.log('Every export folds into one participant per pseudonymous study id — repeated files are expected.');
  process.exit(0);
}
const files = fs.readdirSync(dir)
  .filter(f => f.toLowerCase().endsWith('.json') && !f.startsWith('study-ops-report') && !f.startsWith('product-success'))
  .sort()
  .map(name => ({ name, text: fs.readFileSync(path.join(dir, name), 'utf8') }));
if(!files.length){
  console.log('No participant JSON exports found — nothing to aggregate yet.');
  console.log('This report says so honestly rather than inventing results.');
  process.exit(0);
}

const ingest = ingestParticipantFiles(files);
const cohort = summariseCohort(ingest.participants, { gates: { minParticipants, minTransitions, minTransitionsPerArm: Math.floor(minTransitions / 2) } });
// Product success pools IDENTIFIED participants only — an export without a
// valid study id cannot be proven to be a distinct person.
const success = computeProductSuccessReport(ingest.participants);

const cohortMd = renderCohortReport(cohort, { ingest });
const successMd = renderProductSuccessReport(success);

fs.mkdirSync(outDir, { recursive: true });
const cohortPath = path.join(outDir, 'study-ops-report.md');
const successPath = path.join(outDir, 'product-success.md');
fs.writeFileSync(cohortPath, cohortMd);
fs.writeFileSync(successPath, successMd);

console.log(cohortMd);
console.log('');
console.log(successMd);
console.log(`Written: ${cohortPath}`);
console.log(`Written: ${successPath}`);
console.log(`${files.length} file(s) read → ${ingest.counts.uniqueParticipants} unique participant(s), ${ingest.counts.unidentifiedExports} unidentified, ${ingest.counts.duplicateFiles} duplicate file(s), ${ingest.counts.importErrors} import error(s), ${ingest.warnings.length} warning(s).`);
process.exit(cohort.gate.eligible ? 2 : 0);
