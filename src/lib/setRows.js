// setRows.js — canonical flattened-set projection shared by persistence and
// archive restore. Keep this dependency tiny: archive tooling must not pull
// the full storage/hydration module into its lazy chunk just to rebuild rows.

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
