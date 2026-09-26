// Small storage-shape helpers shared by persistence and archive maintenance.
// Kept separate from storage.js so feature/maintenance chunks can reuse the
// canonical row shape without pulling in the whole persistence runtime.

export function splitSets(history){
  const out = [];
  for(const h of history || []){
    for(const [bi, b] of (h.blocks || []).entries()){
      for(const [si, s] of (b.sets || []).entries()){
        out.push({
          id: `${h.id}:${bi}:${si}`,
          sessionId: h.id,
          dateISO: h.dateISO,
          exerciseId: b.exerciseId,
          blockIndex: bi,
          setIndex: si,
          reps: s.reps ?? '',
          weightKg: s.weightKg ?? '',
          rpe: s.rpe ?? '',
        });
      }
    }
  }
  return out;
}
