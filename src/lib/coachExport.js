// coachExport.js — a plain-language training summary a user can hand to a
// human coach (or paste into an email). Deliberately NOT the raw backup:
//   - optional fields only: the user picks which sections travel
//   - aggregate by default: per-exercise bests and weekly volume, never a
//     per-set dump, unless "detail" is explicitly included
//   - readable: Markdown text first, JSON attachment for a coach who wants
//     machine-readable numbers
//
// Consent notes (why not just export everything): a coach needs performance
// data, not identity or health context. Sections are opt-in per export, the
// file carries no device id and no study id, and a generated-on date is the
// only metadata.

function weekKey(dateISO){
  const d = new Date(`${String(dateISO).slice(0, 10)}T00:00:00Z`);
  if(Number.isNaN(d.getTime())) return null;
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/** Per-exercise performance summary over the selected window. Pure. */
export function exerciseSummaries(history, { sinceISO = null } = {}){
  const byExercise = new Map();
  for(const session of history || []){
    if(sinceISO && String(session.dateISO || '') < sinceISO) continue;
    for(const block of session.blocks || []){
      if(!block?.exerciseId) continue;
      const entry = byExercise.get(block.exerciseId) || { sessions: 0, topSetKg: 0, topReps: 0, volumeKg: 0, sets: 0 };
      entry.sessions += 1;
      for(const set of block.sets || []){
        const weight = Number(set?.weightKg ?? 0) || 0;
        const reps = Number(set?.reps ?? 0) || 0;
        if(weight > entry.topSetKg || (weight === entry.topSetKg && reps > entry.topReps)){
          entry.topSetKg = weight; entry.topReps = reps;
        }
        entry.volumeKg += weight * reps;
        entry.sets += 1;
      }
      byExercise.set(block.exerciseId, entry);
    }
  }
  return [...byExercise.entries()]
    .map(([exerciseId, s]) => ({ exerciseId, ...s, volumeKg: Math.round(s.volumeKg) }))
    .sort((a, b) => b.volumeKg - a.volumeKg);
}

/** Weekly training volume (and session count) buckets, oldest first. Pure. */
export function weeklyVolume(history, { weeks = 8 } = {}){
  const byWeek = new Map();
  for(const session of history || []){
    const key = weekKey(session.dateISO);
    if(!key) continue;
    const entry = byWeek.get(key) || { weekStart: key, sessions: 0, volumeKg: 0 };
    entry.sessions += 1;
    for(const block of session.blocks || []){
      for(const set of block.sets || []){
        entry.volumeKg += (Number(set?.weightKg ?? 0) || 0) * (Number(set?.reps ?? 0) || 0);
      }
    }
    byWeek.set(key, entry);
  }
  return [...byWeek.values()]
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart))
    .slice(-weeks)
    .map((w) => ({ ...w, volumeKg: Math.round(w.volumeKg) }));
}

/**
 * Build the coach export.
 * sections: { summary, performance, weekly, readiness, detail } — all optional,
 * `summary` defaults on. readiness values are coarse scores only (0–100), and
 * only when the user explicitly includes that section.
 */
export function buildCoachExport(store, { sections = {}, weeks = 8, sinceISO = null } = {}){
  const picked = { summary: true, ...sections };
  const history = store?.history || [];
  const first = history.length ? history[0].dateISO : null;
  const last = history.length ? history[history.length - 1].dateISO : null;
  const out = {
    app: 'arise',
    kind: 'coach-export',
    generatedAt: new Date().toISOString(),
    range: { from: sinceISO || first, to: last, sessions: history.length },
  };
  if(picked.summary){
    out.summary = {
      totalSessions: history.length,
      firstSession: first,
      lastSession: last,
    };
  }
  if(picked.performance) out.exercises = exerciseSummaries(history, { sinceISO });
  if(picked.weekly) out.weeklyVolume = weeklyVolume(history, { weeks });
  if(picked.readiness){
    out.readiness = (store?.readinessLog || [])
      .filter((r) => !sinceISO || String(r.dateISO || '') >= sinceISO)
      .map((r) => ({ dateISO: r.dateISO, score: r.score }))
      .filter((r) => Number.isFinite(Number(r.score)));
  }
  if(picked.detail){
    out.sessions = history
      .filter((s) => !sinceISO || String(s.dateISO || '') >= sinceISO)
      .map((s) => ({
        dateISO: s.dateISO,
        blocks: (s.blocks || []).map((b) => ({
          exerciseId: b.exerciseId,
          sets: (b.sets || []).map((set) => ({ reps: set.reps, weightKg: set.weightKg, rpe: set.rpe ?? null })),
        })),
      }));
  }
  return out;
}

const fmtKg = (n) => `${n} kg`;

/** Render the export as plain-text Markdown an email can carry as-is. */
export function renderCoachMarkdown(exportData){
  const lines = [];
  lines.push('# Training summary');
  lines.push('');
  lines.push(`Generated ${exportData.generatedAt.slice(0, 10)} · ${exportData.range.sessions} session(s)${exportData.range.from ? ` · ${exportData.range.from} → ${exportData.range.to || 'now'}` : ''}`);
  lines.push('');
  if(exportData.summary){
    lines.push('## Overview');
    lines.push(`- Sessions logged: ${exportData.summary.totalSessions}`);
    if(exportData.summary.firstSession) lines.push(`- Training log covers: ${exportData.summary.firstSession} to ${exportData.summary.lastSession}`);
    lines.push('');
  }
  if(exportData.weeklyVolume?.length){
    lines.push('## Weekly volume');
    for(const w of exportData.weeklyVolume) lines.push(`- Week of ${w.weekStart}: ${fmtKg(w.volumeKg)} across ${w.sessions} session(s)`);
    lines.push('');
  }
  if(exportData.exercises?.length){
    lines.push('## Exercises (by total volume)');
    for(const e of exportData.exercises.slice(0, 12)){
      lines.push(`- ${e.exerciseId}: best set ${fmtKg(e.topSetKg)} × ${e.topReps} · ${e.sets} set(s) over ${e.sessions} session(s) · volume ${fmtKg(e.volumeKg)}`);
    }
    lines.push('');
  }
  if(exportData.readiness?.length){
    lines.push('## Readiness (self-reported, 0–100)');
    const recent = exportData.readiness.slice(-10);
    for(const r of recent) lines.push(`- ${r.dateISO}: ${r.score}`);
    lines.push('');
  }
  if(exportData.sessions?.length){
    lines.push('## Session detail');
    for(const s of exportData.sessions){
      lines.push(`### ${s.dateISO}`);
      for(const b of s.blocks){
        const sets = b.sets.map((set) => `${set.reps}×${set.weightKg ?? 'BW'}${set.rpe != null ? ` @${set.rpe}` : ''}`).join(', ');
        lines.push(`- ${b.exerciseId}: ${sets}`);
      }
      lines.push('');
    }
  }
  lines.push('---');
  lines.push('Exported from Arise (local-first training log). This file contains only the sections the athlete chose to include.');
  return lines.join('\n');
}
