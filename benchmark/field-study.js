import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadParticipantFile, computeFieldStudy, renderFieldReport } from '../src/lib/fieldStudy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const dirArg = args.find(a => !a.startsWith('--')) || path.join(here, 'field');
const minParticipants = Number(args.find(a => a.startsWith('--min-participants='))?.split('=')[1]) || 10;
const minTransitions = Number(args.find(a => a.startsWith('--min-transitions='))?.split('=')[1]) || 1000;

const dir = path.resolve(dirArg);
if(!fs.existsSync(dir)){
  console.log(`No participant directory at ${dir}`);
  console.log('Ask consenting participants to export their backup (More -> Export) and drop the JSON files there.');
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
