// printReport.js — a printable progress report.
//
// "PDF export" without a dependency: build a self-contained document from the
// same pure insight functions the Progress view uses (product.js, analytics.js,
// attributes.js) and print it through a hidden iframe — every OS print dialog
// offers "Save as PDF". The document is aggregate by default: weekly volume,
// PRs, adherence, milestones — the summary a coach or the user themselves can
// read in one page. No per-set dump unless explicitly requested.
//
// Print CSS inlines at the top so the file works standalone if someone saves
// the iframe's HTML instead of printing it.

import { totalVolumeKg, streakDays } from './store.js';
import { deriveAttributes, levelFromAttributes } from './attributes.js';
import { milestoneState, trainingAgeDisplay, consistencyInsights, healthyStreak, monthlyDigest } from './product.js';
import { EXERCISE_BY_ID } from './data.js';
import { fmtWeight } from './units.ts';

/** Best e1RM per exercise (technique-flagged notes excluded), Progress-view parity. */
function computePRs(history){
  const best = new Map();
  for(const h of history) for(const b of h.blocks || []) for(const s of b.sets || []){
    const w = Number(s.weightKg), r = Number(String(s.reps).match(/\d+/)?.[0] || s.reps);
    if(!(w > 0 && r > 0)) continue;
    const e1rm = w * (1 + r / 30);
    const prev = best.get(b.exerciseId);
    if(!prev || e1rm > prev.e1rm) best.set(b.exerciseId, { exerciseId: b.exerciseId, e1rm, dateISO: h.dateISO, note: h.note || '' });
  }
  return [...best.values()]
    .filter(v => !/rom|depth|technique|assisted|partial/.test((v.note || '').toLowerCase()))
    .sort((a, b) => b.e1rm - a.e1rm);
}

export function buildProgressReport(store, { today = null, units = 'kg', includeSets = false } = {}){
  const history = Array.isArray(store?.history) ? store.history : [];
  const now = today || new Date().toISOString().slice(0, 10);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  const attrs = deriveAttributes(history);
  const prs = computePRs(history).slice(0, 8);
  const milestones = milestoneState(history);
  const age = trainingAgeDisplay(history, { today: now });
  const consistency = consistencyInsights(history, { today: now });
  const streak = healthyStreak(history, { today: now });
  const digest = monthlyDigest(history, { today: now });

  const prRows = prs.map(p =>
    `<tr><td>${esc(EXERCISE_BY_ID[p.exerciseId]?.name || p.exerciseId)}</td><td class="num">${esc(fmtWeight(p.e1rm, units))}</td><td>${esc(p.dateISO || '')}</td></tr>`
  ).join('');

  const setRows = includeSets ? `
    <h2>Set detail</h2>
    <table>${history.slice(-40).flatMap(h => (h.blocks || []).map(b => (b.sets || [])
      .filter(s => !s.skipped)
      .map(s => `<tr><td>${esc(h.dateISO)}</td><td>${esc(b.exerciseId)}</td><td class="num">${esc(s.reps || '')}</td><td class="num">${esc(fmtWeight(s.weightKg || 0, units))}</td></tr>`))).flat().join('')}</table>` : '';

  const section = (title, items) => items.length ? `<h2>${esc(title)}</h2><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : '';
  const milestoneItems = Array.isArray(milestones?.achieved) ? milestones.achieved.map(m => m.label || m.title || m.id) : [];
  const digestLines = digest ? Object.entries(digest).filter(([, v]) => v != null && v !== '').slice(0, 6).map(([k, v]) => `${k}: ${v}`) : [];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Arise progress report</title>
<style>
  body { font-family: Inter, system-ui, sans-serif; color: #17171a; margin: 2rem; max-width: 46rem; }
  h1 { font-size: 1.4rem; margin: 0; }
  h2 { font-size: .95rem; margin: 1.4rem 0 .4rem; border-bottom: 1px solid #ddd; padding-bottom: .2rem; }
  table { width: 100%; border-collapse: collapse; font-size: .8rem; }
  td { padding: .25rem .4rem; border-bottom: 1px solid #eee; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  ul { font-size: .85rem; }
  .meta { color: #666; font-size: .78rem; }
  @media print { body { margin: 1rem; } }
</style></head><body>
<h1>Training progress report</h1>
<p class="meta">Generated ${esc(now)} · ${history.length} sessions · ${esc(fmtWeight(totalVolumeKg(history), units))} lifetime volume</p>
${section('Overview', [
  `Training age: ${esc(age?.label || age?.text || `${age ?? ''}`)}`,
  `Current streak: ${esc(streak?.currentWeeks ?? streak?.weeks ?? streakDays(history))} weeks`,
  `Level: ${esc(levelFromAttributes(attrs))} (attributes ${attrs.map(a => `${a.label} ${a.value}`).join(', ')})`,
])}
${section('Consistency', consistency?.lines || (consistency?.summary ? [consistency.summary] : []))}
${digestLines.length ? section('This month', digestLines) : ''}
${milestoneItems.length ? section('Milestones achieved', milestoneItems) : ''}
${prRows ? `<h2>Personal records (estimated 1RM)</h2><table><tr><th>Exercise</th><th class="num">Best</th><th>Date</th></tr>${prRows}</table>` : ''}
${setRows}
<p class="meta">Generated by Arise — aggregate statistics over self-logged training data. Not medical advice.</p>
</body></html>`;
}

/** Open the OS print dialog with the report (user can save as PDF). */
export function printProgressReport(store, opts){
  const html = buildProgressReport(store, opts);
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  frame.onload = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 60_000); // keep it for slow dialogs
    }
  };
}
