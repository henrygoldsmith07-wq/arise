#!/usr/bin/env node
// bundle-budget.cjs — enforce bundle size budgets as a build/CI gate.
//
// Baselines (this branch, measured locally after route splitting):
//   boot (index + vendor, gzip): 160.8 kB → budget 190 kB
//   single lazy chunk (gzip):     37 kB   → budget 45 kB (largest is the
//                                            analytics worker, on-demand)
//   total JS (gzip):             305.3 kB → budget 310 kB (worker included;
//                                            it never blocks the main thread)
//
// Re-baseline history: 300 → 310 kB with the resilience/expansion round
// (support diagnostics, salvage export, share codes, voice input, CSV
// importers, print report) — all lazy-route code, boot budget unchanged.
//
// 310 → 325 kB with the exercise-instruction round: every programme-used
// exercise now ships setup steps and common mistakes. This is primary
// product content in the data module, not incidental dependency/code growth;
// boot and largest-lazy budgets stay unchanged.
//
// 325 → 330 kB with the prospective-prescription audit trail: frozen snapshot
// identity (prescriptionId/revision) and supersede provenance
// (supersedesPrescriptionId/previousExerciseId/changeReason) plus the early
// observed follow-through signal. This is the requested evidence-chain feature
// in the core progression/product modules (boot chunk), not dependency growth;
// boot (184.3) and largest-lazy (43.0) budgets stay unchanged.
//
// boot 190 → 195 kB and total 330 → 340 kB with the learning layer: named
// prospective outcome labels, prospective-only calibration with sample-gated
// shrinkage, and history-derived conservative personalisation. longitudinal.js
// is reached from App (boot) so the classifier/calibration land in the boot
// chunk, and the same code is bundled into the on-demand analytics worker
// (largest-lazy 45 → 48). All of it is requested product logic, not incidental
// dependency growth; headroom above measured (boot 191.2, lazy 45.1, total 335.4).
//
// total 340 → 342 kB with the prospective field-validation round: the
// gradeable prospective field comparison (evaluation.js, also bundled into the
// analytics worker), pooled prospective comparison + local field-study status
// (fieldStudy.js), logging-friction stats (telemetry.js), the coaching-evidence
// selector (product.js) and the two runner instrumentations plus the expert
// Coaching-evidence / field-study-status surfaces. Requested product logic in
// boot + worker chunks, not dependency growth; measured boot 194.1 (budget 195
// unchanged), largest-lazy 46.9 (budget 48 unchanged), total 341.6.
//
// boot 195 → 196 kB and total 342 → 344 kB with the assigned-arm validation
// fix: pooled assigned-arm comparison with participant-clustered bootstrap
// (fieldStudy.js), shadow-evidence labelling (evaluation.js), primary-based
// coaching evidence + shadow diagnostic (product.js), write-time timing/target
// gating plus the value-free interaction taxonomy and friction v2
// (telemetry.js), and field-commit/swap/add instrumentation in both runners.
// Measured boot 195.0, largest-lazy 47.0 (budget 48 unchanged), total 343.0.
//
// total 344 → 345 kB with the participant-identity integrity pass: the
// canonical participantOf/participantOfStore helpers in longitudinalCore
// (imported from both evaluation and fieldStudy, boot + worker chunks), the
// between-person clustered-bootstrap branch, and the study-loader
// restoration of participant-consented exports. Zero identity drift — one
// person is one participant everywhere. Boot and largest-lazy budgets
// unchanged (195.1 / 47.1); measured total 344.1.
//
// total 345 → 346 kB with the observed-evidence scoping pass: the shared
// all/prospective/trusted scope helpers, trusted-only observed summaries and
// shadow gates in evaluation, and the trusted-scoped dashboard metrics with
// separate diagnostic disclosure in evidenceMetrics. Requested product logic
// in boot + worker chunks, not dependency growth; boot (195.5) and
// largest-lazy (47.4) budgets unchanged; measured total 345.3.
//
// total 346 → 347 kB with the per-mode timing pass: value-free mode:enter
// anchors (runner mount + gym toggle) and the latest-entry anchor lookup in
// the friction core. Requested product logic, not dependency growth; boot
// (195.5) and largest-lazy (47.4) budgets unchanged; measured total 346.0.
//
// total 358 → 359 kB with the study-lifecycle pass: withdraw/rejoin actions,
// the full eligibility→consent→export→withdraw onboarding card, and the
// participation.js state machine in the More chunk. Operator-side study
// modules (cohortOps.js, productSuccess.js) ship ZERO bundle bytes — they are
// imported only by scripts/ and tests/. Boot (196.2) and largest-lazy (47.4)
// unchanged; measured total 358.1.
//
// total 357 → 358 kB with the guided both-arms treatment pass: one shared
// application path in guidedMode (reps/load/assistance, value-diffed so
// re-application is a no-op), the generalised study-policy disclosure line,
// and the treatment.js extraction. Guided now executes whichever arm it was
// assigned — the same prescription recorded, displayed and performed. Requested
// product logic, no dependency growth; boot (196.1) and largest-lazy (47.4)
// unchanged; measured total 357.1.
//
// boot 196 → 197 kB and total 347 → 357 kB with the competitive-gaps pass:
// the exercise teaching layer (derived setup/execution/breathing/mistakes/
// safety/progressions content + the lazy TeachingPanel chunk + richer browser
// detail), the template editor (rest, reorder, duplicate, kit preview —
// isolated in a lazy templateEditor module so boot never pays for it), the
// peer-device sync registry, the study self-onboarding card, and the
// participant-balanced friction report wiring. All requested product
// content/logic in existing chunks, no new dependencies; largest-lazy
// unchanged (47.4 ≤ 48); measured boot 196.1, total 356.1.
//
// total 359 → 362 kB with the dedicated study-export boundary pass: the study
// serializers move OUT of export.js into a dedicated lazy-loaded studyExport.js
// chunk (every scalar type-locked — hostile shapes fail closed to null), so the
// study export no longer rides in the backup path. The lazy chunk's own closure
// (longitudinal, telemetry, exportPolicy data-source adapters) is the +2.4 kB;
// MoreView, boot and every other chunk are byte-identical, and boot (196.2 ≤ 197)
// plus largest-lazy (47.4 ≤ 48) budgets are UNCHANGED — user-perceived load is
// untouched. Re-baseline is the documented total only; measured total 361.8.
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

const BOOT_BUDGET_KB = 197;
const CHUNK_BUDGET_KB = 48;
const TOTAL_BUDGET_KB = 362;

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
