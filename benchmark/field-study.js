import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadParticipantFile, computeFieldStudy, renderFieldReport } from '../src/lib/fieldStudy.js';

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

function makeRng(seedStr){
  let h = 2166136261;
  for(const ch of seedStr){ h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  let state = h >>> 0;
  return ()=>{
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIXTURE_EXERCISES = [
  { exerciseId: 'bench-press-dumbbell', baseKg: 40 },
  { exerciseId: 'goblet-squat', baseKg: 24 },
  { exerciseId: 'romanian-deadlift', baseKg: 60 },
  { exerciseId: 'lat-pulldown', baseKg: 30 },
];
const FIXTURE_SESSIONS = 30; // × (4 exercises × 29 transitions) per participant
const FIXTURE_PARTICIPANTS = 12;

function syntheticParticipant(index){
  const rng = makeRng(`arise-field-fixture-${index}`);
  const startMs = Date.parse('2026-01-05T00:00:00Z');
  const history = [], readinessLog = [], eventHistory = [], sessions = [];
  let eventAt = startMs;
  // One mid-programme deload decision so validateDeloadDecisions has input.
  const deloadAt = Math.floor(FIXTURE_SESSIONS * 0.7);
  for(let s = 0; s < FIXTURE_SESSIONS; s++){
    const dateISO = new Date(startMs + s * 3 * 86400000).toISOString().slice(0, 10);
    readinessLog.push({ dateISO, score: 55 + Math.round(rng() * 35) });
    sessions.push({ id: `fx${index}-s${s}`, dateISO, status: 'done', title: s % 2 ? 'A' : 'B', blocks: [] });
    const blocks = FIXTURE_EXERCISES.map(({ exerciseId, baseKg }, ei)=>{
      const drift = s * 0.35 * (0.8 + rng() * 0.5);
      // Brief dip around the recorded deload week, then recovery.
      const cut = Math.abs(s - deloadAt) <= 1 ? -baseKg * 0.25 : 0;
      const noise = (rng() - 0.5) * 2;
      const weightKg = Math.max(4, Math.round((baseKg + drift + cut + noise) * 2) / 2);
      return {
        exerciseId,
        sets: [{ reps: String(8 + Math.round(rng() * 2)), weightKg: String(weightKg), rpe: String(rng() > 0.8 ? 9 : 7) }],
      };
    });
    history.push({ id: `fx${index}-s${s}`, dateISO, blocks });
    eventHistory.push({ id: `fx${index}-shown-${s}`, type: 'recommendation:shown', at: new Date(eventAt += 60000).toISOString() });
    eventHistory.push({
      id: `fx${index}-accepted-${s}`, type: rng() > 0.15 ? 'recommendation:accepted' : 'recommendation:dismissed',
      at: new Date(eventAt += 60000).toISOString(),
    });
    eventHistory.push({ id: `fx${index}-log-${s}`, type: 'set:complete', elapsedMs: 2500 + Math.round(rng() * 6500), at: new Date(eventAt += 60000).toISOString() });
  }
  return {
    app: 'arise',
    version: 1,
    studyParticipantId: (()=>{
      // Deterministic per-person id (fixture mode must stay reproducible).
      const rngId = makeRng(`arise-field-fixture-id-${index}`);
      let hex = '';
      for(let i = 0; i < 16; i++) hex += Math.floor(rngId() * 16).toString(16);
      return hex;
    })(),
    participantCode: `FX${String(index + 1).padStart(2, '0')}`,
    preferences: { telemetryEnabled: true },
    history,
    readinessLog,
    eventHistory,
    activeSchedule: {
      programId: 'field-fixture',
      availableEquipment: ['dumbbells', 'bench', 'cable', 'bodyweight'],
      sessions,
      adaptationHistory: [{
        dateISO: history[deloadAt].dateISO,
        decision: { deload: true, deloadSignals: ['fixture: scripted mid-programme deload'] },
      }],
    },
  };
}

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
