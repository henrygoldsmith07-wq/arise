// historyEditor.js — fix or remove a past logged workout. Pure functions:
// they take the store and return the next store, so the UI, tests and sync
// share one deterministic transition. A deleted session leaves a tombstone so
// peers and re-imports do not resurrect it.
import { makeTombstone } from './domain.js';
import { upsertHistory } from './store.js';

export const MAX_LOAD_KG = 500;
export const MAX_REPS = 100;

/** Validate one set patch. Returns { ok, errors, clean }. */
export function validateSetPatch(patch = {}){
  const errors = [];
  const clean = {};
  if('weightKg' in patch){
    const raw = String(patch.weightKg ?? '').trim();
    if(raw === '') clean.weightKg = '';
    else {
      const w = Number(raw.replace(',', '.'));
      if(!Number.isFinite(w) || w < 0 || w > MAX_LOAD_KG) errors.push(`Load must be 0–${MAX_LOAD_KG} kg.`);
      else clean.weightKg = Math.round(w * 100) / 100;
    }
  }
  if('reps' in patch){
    const raw = String(patch.reps ?? '').trim();
    const r = Number(raw);
    if(raw === '') clean.reps = '';
    else if(!Number.isInteger(r) || r < 0 || r > MAX_REPS) errors.push(`Reps must be a whole number 0–${MAX_REPS}.`);
    else clean.reps = r;
  }
  if('rpe' in patch){
    const raw = String(patch.rpe ?? '').trim();
    if(raw === '') clean.rpe = '';
    else {
      const v = Number(raw);
      if(!Number.isFinite(v) || v < 1 || v > 10) errors.push('RPE must be 1–10.');
      else clean.rpe = v;
    }
  }
  return { ok: errors.length === 0, errors, clean };
}

function findSession(store, id){
  return (store?.history || []).find((s) => s?.id === id) || null;
}

/** Edit one set. Returns { store, session } or { error }. */
export function editSet(store, { sessionId, blockIndex, setIndex, patch, now = new Date().toISOString() }){
  const session = findSession(store, sessionId);
  if(!session) return { error: 'Session not found.' };
  const block = session.blocks?.[blockIndex];
  const set = block?.sets?.[setIndex];
  if(!set) return { error: 'Set not found.' };
  const v = validateSetPatch(patch);
  if(!v.ok) return { error: v.errors[0] };
  const next = {
    ...session,
    editedAt: now,
    savedAt: now,
    blocks: session.blocks.map((b, bi) => bi !== blockIndex ? b : {
      ...b,
      sets: b.sets.map((s, si) => si !== setIndex ? s : { ...s, ...v.clean, edited: true }),
    }),
  };
  return { store: { ...store, history: upsertHistory(store.history, next) }, session: next };
}

/** Remove one set (and the block when it was the last). */
export function deleteSet(store, { sessionId, blockIndex, setIndex, now = new Date().toISOString() }){
  const session = findSession(store, sessionId);
  const block = session?.blocks?.[blockIndex];
  if(!block?.sets?.[setIndex]) return { error: 'Set not found.' };
  const blocks = session.blocks
    .map((b, bi) => bi !== blockIndex ? b : { ...b, sets: b.sets.filter((_, si) => si !== setIndex) })
    .filter((b) => b.sets.length > 0);
  if(!blocks.length) return deleteSession(store, { sessionId, now });
  const next = { ...session, blocks, editedAt: now, savedAt: now };
  return { store: { ...store, history: upsertHistory(store.history, next) }, session: next };
}

/** Delete a whole session: drop the row, tombstone it, reopen its schedule slot. */
export function deleteSession(store, { sessionId, now = new Date().toISOString() }){
  const session = findSession(store, sessionId);
  if(!session) return { error: 'Session not found.' };
  const tombstone = makeTombstone('sessions', sessionId, { at: now });
  const sched = store.activeSchedule;
  const activeSchedule = sched && Array.isArray(sched.sessions) ? {
    ...sched,
    sessions: sched.sessions.map((s) => s.id === sessionId && s.status === 'done' ? { ...s, status: 'planned' } : s),
    rev: (Number(sched.rev) >= 0 ? Number(sched.rev) : 0) + 1,
    updatedAt: now,
  } : sched;
  return {
    store: {
      ...store,
      history: (store.history || []).filter((s) => s?.id !== sessionId),
      activeSchedule,
      tombstones: [...(store.tombstones || []).filter((t) => !(t.entity === 'sessions' && t.refId === sessionId)), tombstone],
    },
    tombstone,
  };
}

/** One-line summary of a set for confirmation text. */
export function describeSet(set){
  const w = set?.weightKg === '' || set?.weightKg == null ? 'bodyweight' : `${set.weightKg} kg`;
  return `${w} × ${set?.reps === '' ? '–' : set?.reps}`;
}

/** Did an edit change training evidence (load, reps or RPE)? */
export function changedEvidence(before, after){
  const key = (s) => [s?.weightKg, s?.reps, s?.rpe].join('|');
  const a = (before?.blocks || []).flatMap((b) => b.sets || []).map(key).join(';');
  const b = (after?.blocks || []).flatMap((x) => x.sets || []).map(key).join(';');
  return a !== b;
}
