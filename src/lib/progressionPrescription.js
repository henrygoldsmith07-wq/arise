// Prescription snapshots, stable set identity and exercise-swap transitions.
// Extracted from progression.js; public compatibility remains via re-export.

import { resolveArisePriors } from './priors.js';

export const PRESCRIPTION_SNAPSHOT_VERSION = 1;

// The explicit reasons a shown prescription may legitimately change. A reason
// is required for every supersede; unknown reasons are preserved verbatim so
// the audit trail never silently invents one.
export const PRESCRIPTION_CHANGE_REASONS = Object.freeze([
  'initial-prescription',
  'exercise-substituted',
  'policy-changed',
  'equipment-changed',
  'programme-adjusted',
  'user-requested-change',
  'prescription-updated',
]);

function plannedSetCount(block){
  if(block == null) return 0;
  if(!Array.isArray(block.sets)){
    const count = Math.round(Number(block.sets));
    return Number.isFinite(count) && count > 0 ? count : 0;
  }
  return block.sets.length;
}

// Recursively freeze an object graph (arrays and nested plain objects), so a
// frozen snapshot cannot be mutated at any depth. Cycles are tolerated via a
// seen set; already-frozen subtrees are skipped.
function deepFreeze(value, seen){
  if(value == null || typeof value !== 'object') return value;
  const visited = seen || new WeakSet();
  if(visited.has(value) || Object.isFrozen(value)) return value;
  visited.add(value);
  Object.freeze(value);
  for(const key of Object.keys(value)) deepFreeze(value[key], visited);
  return value;
}

export function deepFreezePrescription(prescription){
  return deepFreeze(prescription, new WeakSet());
}

// `previous` (a superseded snapshot) and `changeReason` are the ONLY way a
// snapshot legitimately changes: an exercise swap, or a policy/kit/programme/
// user change that made Arise show a different target than the one it first
// froze. Passing `previous` never mutates it — it records provenance
// (supersedesPrescriptionId, previousExerciseId, revision) so the old snapshot
// stays auditable. `shownAt`/`createdAt` are the first-visible timestamp and
// the construction timestamp; `prescribedAt` mirrors shownAt for the
// first-visible moment this snapshot governed. A rebuild with no `previous`
// over a block that already has a snapshot is what an unfaithful
// reconstruction looks like — callers must attach/carry, never rebuild.
export function buildPrescriptionSnapshot({ session = null, block = null, blockIndex = null, recommendation = null, prescribedAt = null, shownAt = null, createdAt = null, policy = 'standard', config = null, previous = null, changeReason = null } = {}){
  if(!session?.id || !block?.exerciseId) return null;
  const prescribedSets = plannedSetCount(block);
  if(!(prescribedSets > 0)) return null;
  const shownISO = shownAt || prescribedAt || session.startedAt || null;
  if(!shownISO) return null;
  const createdISO = createdAt || shownISO;
  const priors = resolveArisePriors(config);
  const hasPrevious = !!(previous && previous.prescriptionId);
  const revision = hasPrevious && Number.isFinite(previous.revision) ? previous.revision + 1 : (hasPrevious ? 2 : 1);
  const blockIndexPart = Number.isInteger(blockIndex) ? blockIndex : 'x';
  const prescriptionId = `${session.id}:${blockIndexPart}:${block.exerciseId}:r${revision}`;
  return deepFreezePrescription({
    schemaVersion: PRESCRIPTION_SNAPSHOT_VERSION,
    prescriptionId,
    revision,
    supersedesPrescriptionId: hasPrevious ? previous.prescriptionId : null,
    previousExerciseId: hasPrevious ? (previous.exerciseId ?? null) : null,
    changeReason: changeReason || (hasPrevious ? 'prescription-updated' : 'initial-prescription'),
    source: recommendation ? 'engine' : 'schedule',
    sessionId: session.id,
    exerciseId: block.exerciseId,
    blockIndex: Number.isInteger(blockIndex) ? blockIndex : null,
    prescribedSets,
    prescribedReps: recommendation?.reps ?? null,
    prescribedRepRange: block?.reps ?? null,
    prescribedLoadKg: recommendation?.load ?? null,
    prescribedAssistKg: recommendation?.assistKg ?? null,
    rpeTarget: recommendation?.rpe ?? null,
    rirTarget: recommendation?.rir ?? null,
    shownAt: shownISO,
    firstShownAt: shownISO,
    createdAt: createdISO,
    prescribedAt: shownISO,
    priorCutoffDateISO: session.dateISO || null,
    engine: recommendation ? {
      name: 'arise-engine',
      priorsVersion: recommendation.priorsVersion ?? priors.version,
      policy: recommendation.policy || policy || 'standard',
      policyVersion: recommendation.policyVersion ?? null,
      modelVersion: recommendation.modelVersion ?? priors.progressionModel?.version ?? null,
      strategy: recommendation.strategy || null,
      guard: recommendation.guard || null,
    } : null,
    reason: recommendation?.reason || 'Scheduled programme prescription.',
    confidence: recommendation?.confidence ?? null,
    uncertainty: recommendation?.uncertainty ?? null,
  });
}

// The audit entry point that LEGITIMATELY replaces a shown prescription. It
// never edits the previous snapshot: it pushes it into `prescriptionHistory`
// and installs the new one. If the incoming snapshot is the one already on the
// block it is a no-op, so reruns of a first-visible effect cannot duplicate or
// mutate history (and a policy/kit change that would rebuild the same frozen
// identity cannot overwrite what was actually shown).
export function attachPrescription(block, snapshot){
  if(!block || typeof block !== 'object' || !snapshot) return block;
  const prior = block.prescription;
  if(prior && prior.prescriptionId === snapshot.prescriptionId) return block;
  const history = prior ? [...(copyPrescriptionHistory(block.prescriptionHistory) || []), deepFreezePrescription(prior)] : copyPrescriptionHistory(block.prescriptionHistory);
  const next = { ...block, prescription: deepFreezePrescription(snapshot) };
  if(history) next.prescriptionHistory = history; else delete next.prescriptionHistory;
  return next;
}

// Explicit, reason-carrying supersede: the ONLY sanctioned way to replace a
// block's shown prescription mid-session (e.g. an exercise swap). The old
// snapshot is preserved in history and the new revision records provenance.
export function supersedePrescription(block, { session = null, block: rxBlock = null, blockIndex = null, recommendation = null, shownAt = null, createdAt = null, policy = 'standard', config = null, changeReason = 'prescription-updated' } = {}){
  const previous = block?.prescription || null;
  const snapshot = buildPrescriptionSnapshot({
    session,
    block: rxBlock || block,
    blockIndex,
    recommendation,
    shownAt,
    createdAt,
    policy,
    config,
    previous,
    changeReason,
  });
  return snapshot ? attachPrescription(block, snapshot) : block;
}

// ── Stable per-set identity ──────────────────────────────────────────
// Every set carries: setId (stable for the set's life), plannedSlot (the
// original prescription position, or null for user-added), origin
// ('prescribed' | 'user-added'), and governingPrescriptionId (the revision that
// owns it). Historical identity is NEVER derived from the current array index.
// A removed prescribed set is voided into `block.removedSlots` (plannedSlot +
// governingPrescriptionId kept) so its slot survives as an explicit 'removed'
// target instead of collapsing positions; a removed user-added set is simply
// deleted. This lets follow-through tell apart completed / failed / skipped /
// removed / user-added, and keeps user-added work out of the denominator.
export const SET_ORIGINS = Object.freeze(['prescribed', 'user-added']);

function defaultIdFactory(){
  let n = 0;
  const stamp = Date.now().toString(36);
  return ()=> `set_${stamp}_${(n++).toString(36)}`;
}

export function isSetIdentified(set){
  return !!(set && (set.origin || set.plannedSlot != null || set.governingPrescriptionId != null || set.setId));
}

function blockHasSetIdentity(block){
  return (block?.sets || []).some(isSetIdentified);
}

// When a prescription is first shown, give each planned set a stable slot + id
// and bind it to the revision. Idempotent: sets already attributed to this
// revision are left untouched; user-added sets keep their own identity.
export function attributePrescribedSets(block, prescriptionId, makeId = null){
  if(!block || !prescriptionId) return block;
  const uid = makeId || defaultIdFactory();
  let changed = false;
  const sets = (block.sets || []).map((set, i)=>{
    if(!set) return set;
    if(set.origin === 'user-added') return set.setId ? set : ((changed = true), { ...set, setId: uid() });
    if(set.setId && set.origin === 'prescribed' && set.governingPrescriptionId === prescriptionId && Number.isInteger(set.plannedSlot)) return set;
    changed = true;
    return { ...set, setId: set.setId || uid(), origin: 'prescribed', plannedSlot: Number.isInteger(set.plannedSlot) ? set.plannedSlot : i, governingPrescriptionId: prescriptionId, removed: false };
  });
  return changed ? { ...block, sets } : block;
}

// A fresh set the user tapped "+ Set" onto: it belongs to training history, not
// to any prescription revision, so it never raises a follow-through denominator.
export function userAddedSet(base, makeId = null){
  const uid = makeId || defaultIdFactory();
  return { ...(base || {}), setId: uid(), origin: 'user-added', plannedSlot: null, governingPrescriptionId: null, removed: false };
}

// Whether a set already records performed work (completed or failed). This
// outcome must never be destroyed by an accidental delete.
export function isSetPerformed(set){
  return !!set && (!!set.completed || !!set.failed);
}

// Remove a set by position WITHOUT destroying performed history or collapsing
// a planned slot. The invariant holds for EVERY set regardless of origin,
// prescription status, workout mode, exercise, or reload state:
//   • completed / failed set (prescribed OR user-added) → PROTECTED first, so a
//     direct delete can never destroy real work; the user must undo
//     completion/failure to return it to pending before removing.
// Only unfinished sets fall through to:
//   • unfinished prescribed set    → voided into `removedSlots` (its plannedSlot
//     + governingPrescriptionId preserved) = "removed before it was performed";
//     it stays a governed target, never a collapsed position.
//   • unfinished user-added set    → simply deleted (no prescription slot).
//   • invalid index                → no-op.
// Returns the new block plus an `action` describing what happened.
export function removeSetAt(block, index){
  const sets = block?.sets || [];
  const set = sets[index];
  if(!set) return { block, preserved: false, blocked: false, action: 'none' };
  if(isSetPerformed(set)){
    return { block, preserved: false, blocked: true, action: 'protected' };
  }
  const isPrescribedSlot = set.origin === 'prescribed' && set.governingPrescriptionId != null && Number.isInteger(set.plannedSlot);
  if(isPrescribedSlot){
    const removedSlots = [...(Array.isArray(block.removedSlots) ? block.removedSlots : []), { setId: set.setId || null, plannedSlot: set.plannedSlot, governingPrescriptionId: set.governingPrescriptionId }];
    return { block: { ...block, sets: sets.filter((_, i)=> i !== index), removedSlots }, preserved: true, blocked: false, action: 'removed-prescribed-slot' };
  }
  return { block: { ...block, sets: sets.filter((_, i)=> i !== index) }, preserved: false, blocked: false, action: 'deleted' };
}

// The outcomes of one block's ACTIVE prescription, per governed slot. Identity
// first (live sets + removedSlots carrying this revision's id); legacy blocks
// without set identity fall back to position-counted governed slots and never
// fabricate an attribution that a record does not have.
export function activePrescriptionOutcomes(block, rx = block?.prescription){
  if(!rx) return { identified: false, targets: 0 };
  const rxId = rx.prescriptionId;
  if(!blockHasSetIdentity(block)){
    const positions = governedSlotsFor(block, rx);
    return { identified: false, targets: positions.length };
  }
  const live = (block.sets || []).filter((s)=> s && s.origin !== 'user-added' && s.governingPrescriptionId === rxId);
  const removed = (Array.isArray(block.removedSlots) ? block.removedSlots : []).filter((r)=> r && r.governingPrescriptionId === rxId);
  return { identified: true, live, removed, targets: live.length + removed.length };
}

// A partial swap must NEVER relabel completed work. When the block still has
// no completed/failed set, swapping replaces it in place (nothing was done
// under the old identity). As soon as real work exists, the block is SPLIT:
// the original keeps only its completed/failed sets and its original exerciseId
// + prescription (byte-for-byte, so history/e1RM/progression attribute that
// work to the movement actually performed), and a fresh replacement block takes
// the remaining slots under the new exerciseId with a superseding prescription
// linked back through provenance. Pure and deterministic so every invariant is
// unit-testable; the runner supplies the recommendation + set factory.
//
// Set-slot attribution: each block records `governedSlots` — the ABSOLUTE
// planned-set positions that its active revision actually governed. Splitting
// partitions those positions so completed slots stay with the original revision
// and only unfinished slots move to the replacement. This lets follow-through
// score the governed targets (never the full immutable `prescribedSets` of a
// partially-handed-off revision) while the historical snapshot stays unchanged.
// With stable set identity, a swap transfers only unfinished PRESCRIBED slots —
// user-added sets (and already-removed slots) never become prescription targets.
export function applySwapToBlocks({ blocks = [], index, option, session = null, recommendation = null, priorSets = [], planIndex = index, policy = 'standard', config = null, nowISO = null, newSet = null, makeId = null } = {}){
  const target = blocks[index];
  if(!target || !option || !option.id || option.id === target.exerciseId) return blocks;
  const identified = blockHasSetIdentity(target);
  return identified
    ? swapIdentifiedBlock({ blocks, index, target, option, session, recommendation, priorSets, planIndex, policy, config, nowISO, newSet, makeId })
    : swapLegacyBlock({ blocks, index, target, option, session, recommendation, priorSets, planIndex, policy, config, nowISO, newSet });
}

function swapCore({ target, option, session, recommendation, planIndex, policy, config, now, priorSets, newSet, unilateral, origin, repsFor }){
  const makeFreshSlot = (si)=>{
    const prev = priorSets[si] || priorSets[priorSets.length - 1] || null;
    if(newSet) return { ...newSet(repsFor, unilateral, prev), completed: false };
    return { reps: prev?.reps != null ? String(prev.reps) : '', weightKg: prev?.weightKg != null ? String(prev.weightKg) : '', rpe: '', side: unilateral ? (prev?.side || 'L') : '', rom: '', assistedKg: '', tempo: '', completed: false };
  };
  const buildBlock = (remainingSets, governed, identityFor)=> {
    const base = {
      ...target,
      exerciseId: option.id,
      unilateral,
      warmups: [],
      loadHint: option.supportsWeighted ? 'use a controlled load' : 'bodyweight',
      substitutionFrom: origin,
      substitutionReason: option.reason || 'user-requested change',
      substitutedFromBlockIndex: Number.isInteger(planIndex) ? planIndex : null,
      substitutedAt: now,
      planIndex,
      prescriptionHistory: null,
      removedSlots: null,
      governedSlots: governed.slice().sort((a, b)=> a - b),
      sets: remainingSets,
    };
    const planned = { ...(session?.blocks?.[planIndex] || {}), exerciseId: option.id, sets: remainingSets };
    const swapped = supersedePrescription(base, {
      session,
      block: planned,
      blockIndex: Number.isInteger(planIndex) ? planIndex : null,
      recommendation: recommendation || null,
      shownAt: now,
      policy,
      config,
      changeReason: 'exercise-substituted',
    });
    return identityFor ? swapped : { ...swapped, sets: remainingSets };
  };
  return { makeFreshSlot, buildBlock };
}

function swapLegacyBlock({ blocks, index, target, option, session, recommendation, priorSets, planIndex, policy, config, nowISO, newSet }){
  const now = nowISO || new Date().toISOString();
  const unilateral = !!option.unilateral;
  const origin = target.substitutionFrom || target.exerciseId;
  const repsFor = target.reps || session?.blocks?.[planIndex]?.reps || '';
  const { makeFreshSlot, buildBlock } = swapCore({ target, option, session, recommendation, planIndex, policy, config, now, priorSets, newSet, unilateral, origin, repsFor });
  const absPosition = (si)=> Number.isInteger(target.governedSlots?.[si]) ? target.governedSlots[si] : si;
  const sets = target.sets || [];
  const doneIdx = [], pendingIdx = [];
  sets.forEach((s, si)=> (s && (s.completed || s.failed) ? doneIdx : pendingIdx).push(si));
  const absPositions = (idxList)=> idxList.map(absPosition);
  const allPositions = sets.map((_, si)=> absPosition(si));
  const nextSynthetic = (count)=>{
    const base = allPositions.length ? Math.max(...allPositions) + 1 : 0;
    return Array.from({ length: count }, (_, i)=> base + i);
  };
  if(!doneIdx.length){
    const remainingSets = Array.from({ length: Math.max(1, pendingIdx.length || 1) }, (_, si)=> makeFreshSlot(si));
    const governed = pendingIdx.length ? absPositions(pendingIdx) : nextSynthetic(remainingSets.length);
    return blocks.map((b, i)=> i === index ? buildBlock(remainingSets, governed, false) : b);
  }
  const doneOriginal = freezePrescriptionBlock({ ...target, sets: doneIdx.map((si)=> ({ ...sets[si] })), governedSlots: absPositions(doneIdx).sort((a, b)=> a - b) });
  const plannedCount = Math.max(1, Number(session?.blocks?.[planIndex]?.sets) || 1);
  const remainingSets = Array.from({ length: Math.max(1, pendingIdx.length || plannedCount) }, (_, si)=> makeFreshSlot(si));
  const replacementGoverned = pendingIdx.length ? absPositions(pendingIdx) : nextSynthetic(remainingSets.length);
  const replacement = buildBlock(remainingSets, replacementGoverned, false);
  return blocks.flatMap((b, i)=> i === index ? [doneOriginal, replacement] : [b]);
}

function swapIdentifiedBlock({ blocks, index, target, option, session, recommendation, priorSets, planIndex, policy, config, nowISO, newSet, makeId }){
  const now = nowISO || new Date().toISOString();
  const unilateral = !!option.unilateral;
  const origin = target.substitutionFrom || target.exerciseId;
  const repsFor = target.reps || session?.blocks?.[planIndex]?.reps || '';
  const rxId = target.prescription?.prescriptionId;
  const uid = makeId || defaultIdFactory();
  const { makeFreshSlot, buildBlock } = swapCore({ target, option, session, recommendation, planIndex, policy, config, now, priorSets, newSet, unilateral, origin, repsFor });
  const sets = target.sets || [];
  const carriedRemoved = Array.isArray(target.removedSlots) ? target.removedSlots.slice() : [];
  const isUserAdded = (s)=> !!s && (s.origin === 'user-added' || (s.governingPrescriptionId == null && s.plannedSlot == null && s.origin !== 'prescribed'));
  const performed = (s)=> !!s && (s.completed || s.failed);
  const transferable = (s)=> !!s && !isUserAdded(s) && !performed(s) && s.governingPrescriptionId === rxId && Number.isInteger(s.plannedSlot);

  const keepLive = sets.filter((s)=> !transferable(s));
  const transfers = sets.map((s, si)=> ({ s, si })).filter(({ s })=> transferable(s));

  if(!transfers.length){
    const doneOriginal = freezePrescriptionBlock({ ...target, removedSlots: carriedRemoved.length ? carriedRemoved : null });
    return blocks.map((b, i)=> i === index ? doneOriginal : b);
  }

  const keepPrescribedSlots = keepLive.filter((s)=> !isUserAdded(s) && Number.isInteger(s.plannedSlot)).map((s)=> s.plannedSlot);
  const removedPositions = carriedRemoved.filter((r)=> Number.isInteger(r.plannedSlot)).map((r)=> r.plannedSlot);
  const originalGoverned = [...new Set([...keepPrescribedSlots, ...removedPositions])].sort((a, b)=> a - b);
  const doneOriginal = freezePrescriptionBlock({
    ...target,
    sets: keepLive,
    removedSlots: carriedRemoved.length ? carriedRemoved : null,
    governedSlots: originalGoverned.length ? originalGoverned : null,
  });

  const remainingSets = transfers.map(({ s }, k)=>{
    const base = makeFreshSlot(k);
    return { ...base, setId: s.setId || uid(), origin: 'prescribed', plannedSlot: s.plannedSlot, governingPrescriptionId: null, removed: false, completed: false, failed: false, skipped: false };
  });
  const replacementGoverned = transfers.map(({ s })=> s.plannedSlot);
  const built = buildBlock(remainingSets, replacementGoverned, true);
  const newRxId = built.prescription?.prescriptionId || null;
  const replacement = { ...built, sets: (built.sets || []).map((s)=> s.origin === 'user-added' ? s : { ...s, governingPrescriptionId: newRxId }) };
  return blocks.flatMap((b, i)=> i === index ? [doneOriginal, replacement] : [b]);
}

// The set positions an active prescription revision actually governed. Explicit
// `block.governedSlots` wins (set after a partial swap). Otherwise fall back
// conservatively to the revision's own planned count (legacy/whole blocks) —
// never fabricating a revision history for records that have none.
export function governedSlotsFor(block, rx = block?.prescription){
  if(!rx) return [];
  const explicit = block?.governedSlots;
  if(Array.isArray(explicit) && explicit.length && explicit.every((v)=> Number.isInteger(v) && v >= 0)) return explicit.slice();
  const planned = Number(rx.prescribedSets);
  const count = Number.isFinite(planned) && planned > 0 ? Math.round(planned) : (Array.isArray(block?.sets) ? block.sets.length : 0);
  return Array.from({ length: Math.max(0, count) }, (_, i)=> i);
}

// Every governed-slot position across a session's blocks — for auditing the
// core invariant that each planned set position is governed exactly once.
export function sessionGovernedSlots(session){
  const out = [];
  for(const block of session?.blocks || []){
    if(!block?.prescription) continue;
    for(const slot of governedSlotsFor(block)) out.push({ exerciseId: block.exerciseId, prescriptionId: block.prescription.prescriptionId, slot });
  }
  return out;
}

function copyPrescriptionHistory(history){
  if(!Array.isArray(history) || !history.length) return null;
  return history.map(deepFreezePrescription).slice();
}

// Draft/crash-recovery restore path: an existing prescription (a plain object
// once it has been through IDB) is re-frozen so the deep-immutability promise
// survives a reload. This NEVER rebuilds anything from the engine.
export function freezePrescriptionBlock(block){
  if(!block || typeof block !== 'object') return block;
  const out = { ...block };
  if(out.prescription) out.prescription = deepFreezePrescription(out.prescription); else delete out.prescription;
  const history = copyPrescriptionHistory(out.prescriptionHistory);
  if(history) out.prescriptionHistory = history; else delete out.prescriptionHistory;
  return out;
}

// Final-save path: copy whatever prescription is already on the block, exactly.
// Returns the fields to spread into the saved block — never calls the engine,
// so a save can never silently restamp historical truth.
export function carryPrescription(block){
  if(!block || typeof block !== 'object') return {};
  const out = {};
  if(block.prescription) out.prescription = deepFreezePrescription(block.prescription);
  const history = copyPrescriptionHistory(block.prescriptionHistory);
  if(history) out.prescriptionHistory = history;
  return out;
}
