// exerciseHistory.js — per-lift history for the Gym Mode history sheet.
// Pure: takes the saved sessions array, returns the last N exposures of one
// exercise (newest first) plus a tiny sparkline of best e1RM per exposure.
import { parseReps, e1rm } from './trainingMath.js';

export function exerciseSessionHistory(history, exerciseId, limit = 5){
  const out = [];
  const list = Array.isArray(history) ? history : [];
  for(let i = list.length - 1; i >= 0 && out.length < limit; i--){
    const sess = list[i];
    const block = (sess?.blocks || []).find(b => b?.exerciseId === exerciseId);
    const sets = (block?.sets || []).filter(s => s && String(s.reps ?? '').trim() !== '');
    if(!sets.length) continue;
    let best = 0;
    const rows = sets.map(s => {
      const w = Number(s.weightKg) || 0, r = parseReps(s.reps);
      const est = w > 0 && r > 0 ? Math.round(e1rm(w, r)) : 0;
      if(est > best) best = est;
      return { weightKg: w > 0 ? w : null, reps: String(s.reps), rir: s.rir == null || s.rir === '' ? null : Number(s.rir), e1rm: est || null };
    });
    out.push({ dateISO: sess.dateISO, title: sess.title || '', sets: rows, bestE1rm: best || null });
  }
  return out;
}

// Points for an SVG polyline, oldest → newest, in a width×height box.
// Needs ≥2 exposures with an e1RM; flat series sit mid-height.
export function sparklinePoints(sessions, width = 120, height = 32, pad = 3){
  const vals = [...sessions].reverse().map(s => s.bestE1rm).filter(v => v > 0);
  if(vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min;
  return vals.map((v, i) => {
    const x = pad + (i * (width - 2 * pad)) / (vals.length - 1);
    const y = span === 0 ? height / 2 : height - pad - ((v - min) / span) * (height - 2 * pad);
    return `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`;
  }).join(' ');
}
