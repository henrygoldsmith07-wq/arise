import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadParticipantFile, computeFieldStudy, renderFieldReport } from '../src/lib/fieldStudy.js';
import { syntheticParticipant, FIXTURE_SESSIONS, FIXTURE_PARTICIPANTS } from './field-fixture.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const fixtureMode = args.includes('--fixture');
const dirArg = args.find(a => !a.startsWith('--')) || path.join(here, 'field');
const minParticipants = Number(args.find(a => a.startsWith('--min-participants='))?.split('=')[1]) || 10;
const minTransitions = Number(args.find(a => a.startsWith('--min-transitions='))?.split('=')[1]) || 1000;

// ── Fixture mode ─────────────────────────────────────────────────────────
// CI has no consenting participants. This generates deterministic SYNTHETIC
// export packages (seeded PRNG, fixed dates — no wall clock, no randomness)
// and pushes them through the exact same loader/validation/aggregation path
// as real data. It proves the pipeline works and clears its gates; it is NOT
// real-world evidence and never appears in results as such.

if(fixtureMode){
  console.log(`Field-study FIXTURE mode: generating ${FIXTURE_PARTICIPANTS} deterministic synthetic participants × ${FIXTURE_SESSIONS} sessions (+1 repeat export to prove dedupe).`);
  const packages = [];
  for(let i = 0; i < FIXTURE_PARTICIPANTS; i++){
    try{
      packages.push(loadParticipantFile(JSON.stringify(syntheticParticipant(i)), i));
    }catch(err){
      console.error(`Fixture participant ${i} failed import validation: ${err.message}`);
      process.exit(1);
    }
  }
  // The FIRST participant "re-exports" next week: same id, cumulative log.
  const repeat = loadParticipantFile(JSON.stringify(syntheticParticipant(0)), FIXTURE_PARTICIPANTS);
  packages.push(repeat);

  const result = computeFieldStudy(packages, { minParticipants, minTransitions });
  const uniqueIds = new Set(packages.map(p => p.studyParticipantId).filter(Boolean)).size;
  if(result.gates.participants !== uniqueIds){
    console.error(`Participant counting broken: ${packages.length} exports / ${uniqueIds} unique ids, but gate saw ${result.gates.participants}.`);
    process.exit(1);
  }
  // Deliberately does NOT write results.field.md — that file is reserved for
  // real aggregated evidence; a fixture run must never clobber it.
  console.log(renderFieldReport(result));
  console.log(`\n${packages.length} files read → ${uniqueIds} unique participants (repeat export folded). Fixture mode — synthetic data, not real evidence.`);
  process.exit(result.status === 'sufficient-evidence' ? 0 : 2);
}

const dir = path.resolve(dirArg);
if(!fs.existsSync(dir)){
  console.log(`No participant directory at ${dir}`);
  console.log('Ask consenting participants to export their backup (More -> Export) and drop the JSON files there.');
  console.log('(CI uses --fixture to smoke-test this pipeline without real data.)');
  process.exit(0);
}
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
if(!files.length){
  console.log('No participant JSON packages found — nothing to aggregate yet.');
  console.log('This benchmark reports honestly with zero data rather than inventing results.');
  process.exit(0);
}

let participants = [];
let skipped = 0;
for(const [i, file] of files.entries()){
  try{
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    participants.push(loadParticipantFile(text, i));
  }catch(err){ skipped++; }
}

const result = computeFieldStudy(participants, { minParticipants, minTransitions });
const report = renderFieldReport(result);
fs.writeFileSync(path.join(here, 'results.field.md'), report);

console.log(report);
console.log(`\nWritten to benchmark/results.field.md (${files.length} files read, ${skipped} invalid skipped).`);
process.exit(result.status === 'sufficient-evidence' ? 0 : 2);
