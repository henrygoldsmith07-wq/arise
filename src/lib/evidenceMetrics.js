// evidenceMetrics.js — recommendation-outcome agreement metrics, adherence,
// acceptance/rejection, deviation, overshoot, deload usefulness, plateau
// resolution and calibration, computed PURELY from evaluation-ledger records.
//
// Ground rules (mirror longitudinal.js):
//   - every proportion is Wilson-intervalled (uncertainty visualization for free)
//   - missing audit fields (legacy rows) are "unknown", never zero
//   - records with no outcome are excluded from outcome metrics
//   - synthetic/replayed data never masquerades as real evidence (caller labels)

import { wilsonInterval, round } from './longitudinalCore.js';

const DAY = 86400000;

function proportion(successes, n){
  if(!n) return { rate: null, n: 0, ci: null };
  const ci = wilsonInterval(successes, n);
  return { rate: round(successes / n, 4), n, ci: { low: ci.low, high: ci.high } };
}

function countBy(rows, pick){
  const out = { yes: 0, no: 0, unknown: 0 };
  for(const row of rows){
    const v = pick(row);
    if(v === true) out.yes++;
    else if(v === false) out.no++;
    else out.unknown++;
  }
  return out;
}

// ── Acceptance / rejection / adherence ───────────────────────────────────────

export function acceptanceMetrics(records = []){
  const resolved = records.filter(r=> r.outcome);
  const followed = countBy(resolved, r=> r.outcome.followed);
  const overrides = records.filter(r=> r.userOverride === true).length;
  const open = records.filter(r=> !r.outcome).length;
  return {
    accepted: proportion(followed.yes, resolved.length),
    rejected: proportion(followed.no, resolved.length),
    followedUnknown: followed.unknown,
    userOverrides: { count: overrides, rate: proportion(overrides, records.length) },
    openDecisions: open,
  };
}

export function adherenceMetrics(records = []){
  const resolved = records.filter(r=> r.outcome);
  const rows = resolved.map(r=> ({ followed: r.outcome.followed, deviationKg: r.outcome.deviationKg }));
  const followed = countBy(rows, r=> r.followed);
  const deviations = rows.map(r=> r.deviationKg).filter(v=> v != null);
  const meanDeviationKg = deviations.length
    ? round(deviations.reduce((a,b)=>a+b,0)/deviations.length, 2)
    : null;
  const within2Kg = deviations.filter(v=> v <= 2).length;
  return {
    followed: proportion(followed.yes, resolved.length),
    followedUnknown: followed.unknown,
    meanDeviationKg,
    deviationWithin2Kg: proportion(within2Kg, deviations.length),
    n: resolved.length,
  };
}

// ── Agreement & calibration ──────────────────────────────────────────────────

// Recommendation-outcome agreement: of prescriptions the user FOLLOWED, how
// often was the target met? Followed-and-missed is the engine's fault;
// rejected-and-missed says nothing about the prescription.
export function agreementMetrics(records = []){
  const resolved = records.filter(r=> r.outcome);
  const followedRows = resolved.filter(r=> r.outcome.followed === true);
  const met = followedRows.filter(r=> r.outcome.metTarget === true).length;
  const classifications = {};
  for(const row of resolved){
    const c = row.outcome.classification || 'unknown';
    classifications[c] = (classifications[c] || 0) + 1;
  }
  return {
    targetMetWhenFollowed: proportion(met, followedRows.length),
    classifications,
    n: resolved.length,
  };
}

// Calibration: does "confidence high" actually mean "target met more often"?
// Buckets resolved followed-records by audit confidence band and compares met
// rates. A calibrated engine shows monotonically rising met-rates.
export function calibrationMetrics(records = []){
  const resolved = records.filter(r=> r.outcome && r.outcome.followed === true);
  const bands = { high: [], medium: [], low: [], 'low-thin': [] };
  for(const row of resolved){
    const band = row.audit?.confidence?.band;
    if(band && bands[band]) bands[band].push(row);
  }
  const out = {};
  for(const [band, rows] of Object.entries(bands)){
    const met = rows.filter(r=> r.outcome.metTarget === true).length;
    out[band] = { ...proportion(met, rows.length), band };
  }
  out.assessed = Object.values(bands).some(b=> b.n > 0);
  return out;
}

// Aggressive overshoot: prescriptions that progressed the load AND were
// followed AND ended in failure/regression. The metric the aggressive policy
// must answer for.
export function overshootMetrics(records = []){
  const resolved = records.filter(r=> r.outcome);
  const progressed = resolved.filter(r=> r.recommendedAction === 'progress');
  const overshoot = progressed.filter(r=>
    r.outcome.followed === true &&
    (r.outcome.failedSets > 0 || r.outcome.classification === 'regression'));
  const guarded = resolved.filter(r=> (r.audit?.guard ?? null) != null);
  const byGuard = {};
  for(const row of guarded){
    const g = row.audit.guard;
    byGuard[g] = (byGuard[g] || 0) + 1;
  }
  return {
    progressedDecisions: progressed.length,
    overshootRate: proportion(overshoot.length, progressed.length),
    guardInterventions: { byGuard, total: guarded.length },
  };
}

// ── Deload usefulness ────────────────────────────────────────────────────────
// Deload decisions come through as records with recommendedAction 'deload'
// (or hold-type cuts). Usefulness = performance recovered to pre-deload best
// within the return window. Ledger rows carry basis.previousBest (pre) and the
// outcome (post): compare like deloadEffectiveness does, per record.

export function deloadUsefulnessMetrics(records = [], { returnWindowDays = 21 } = {}){
  const deloads = records.filter(r=>
    r.outcome &&
    (r.recommendedAction === 'deload' || r.audit?.guard === 'deload' ||
     (r.recommendation?.reason || '').toLowerCase().includes('deload')));
  const rows = [];
  for(const row of deloads){
    const pre = row.basis?.previousBest?.e1rm ?? null;
    const post = row.outcome.e1rm ?? null;
    const outDate = Date.parse(row.outcome.dateISO || '');
    const dueDate = Date.parse(row.dueDateISO || '');
    const inWindow = Number.isFinite(outDate) && Number.isFinite(dueDate)
      ? (outDate - dueDate) <= returnWindowDays * DAY
      : true; // unknown timing: give the decision the benefit of the doubt
    if(pre == null || post == null || !inWindow) continue;
    rows.push({
      recovered: post >= pre * 0.99,
      deltaPct: round((post - pre) / pre, 4),
    });
  }
  const recovered = rows.filter(r=> r.recovered).length;
  return {
    deloadDecisions: deloads.length,
    assessed: rows.length,
    recovered: proportion(recovered, rows.length),
    meanDeltaPct: rows.length ? round(rows.reduce((a,r)=> a + r.deltaPct, 0)/rows.length, 4) : null,
  };
}

// ── Plateau resolution ───────────────────────────────────────────────────────
// Of hold decisions justified by a plateau, how many later progressed? A hold
// that is still held forever was a false plateau (or a real wall — the delta
// tells which).

export function plateauResolutionMetrics(records = []){
  const plateauHolds = records.filter(r=>
    r.outcome &&
    r.recommendedAction === 'hold' &&
    /plateau/i.test(r.recommendation?.reason || ''));
  const laterProgressed = plateauHolds.filter(r=>
    r.outcome.classification === 'progression-success' ||
    (r.outcome.changePct != null && r.outcome.changePct > 0.02));
  const stillFlat = plateauHolds.filter(r=>
    r.outcome.classification === 'stagnation');
  return {
    plateauHolds: plateauHolds.length,
    resolvedUpward: proportion(laterProgressed.length, plateauHolds.length),
    stillStagnant: proportion(stillFlat.length, plateauHolds.length),
    regressedAfterHold: proportion(plateauHolds.filter(r=> r.outcome.classification === 'regression').length, plateauHolds.length),
  };
}

// ── The whole dashboard, one call ────────────────────────────────────────────
// sampleGate follows the UI evidence bands: none < 3 < 8 < 20 resolved records.

export function evidenceBand(resolvedCount){
  if(resolvedCount < 3) return { band: 'insufficient', label: 'Insufficient evidence', hint: 'Keep logging — decisions get graded once a few sessions resolve.' };
  if(resolvedCount < 8) return { band: 'emerging', label: 'Emerging pattern', hint: 'A shape is appearing, but single sessions still move it.' };
  if(resolvedCount < 20) return { band: 'consistent', label: 'Consistent trend', hint: 'Stable across enough sessions to trust the direction.' };
  return { band: 'high', label: 'High confidence', hint: 'Strong evidence base — the clearest this device can produce.' };
}

export function evidenceDashboard(records = [], options = {}){
  const list = Array.isArray(records) ? records : [];
  const resolvedCount = list.filter(r=> r.outcome).length;
  const policyMix = {};
  for(const row of list){
    const p = row.audit?.policy || 'unknown';
    policyMix[p] = (policyMix[p] || 0) + 1;
  }
  const policies = Object.keys(policyMix);
  return {
    generatedAtISO: new Date().toISOString(),
    totalRecords: list.length,
    resolvedCount,
    sampleGate: evidenceBand(resolvedCount),
    policyMix,
    mixedPolicyWarning: policies.length > 1
      ? `Records span ${policies.length} policies (${policies.join(', ')}) — compare within a policy, not across.`
      : null,
    acceptance: acceptanceMetrics(list),
    adherence: adherenceMetrics(list),
    agreement: agreementMetrics(list),
    calibration: calibrationMetrics(list),
    overshoot: overshootMetrics(list),
    deloadUsefulness: deloadUsefulnessMetrics(list, options),
    plateauResolution: plateauResolutionMetrics(list),
    archivedCount: options.archivedCount ?? null,
    // Scope disclaimer: observational, on-device, synthetic data excluded by
    // the caller. Never causal language anywhere downstream of this module.
    disclaimer: 'On-device observational analysis of your own logged sessions. Correlation, not causation — no control group, no external validity.',
  };
}

// ── Exportable Markdown report ───────────────────────────────────────────────
// The PDF path is the browser print dialog over a print-styled document; this
// produces the identical content as a .md file.

export function downloadEvidenceReport(dash){
  try{
    const blob = new Blob([renderEvidenceReportMarkdown(dash)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `arise-evidence-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(()=> URL.revokeObjectURL(url), 1000);
    return true;
  }catch{ return false; }
}

export function renderEvidenceReportMarkdown(dash){
  const p = (metric)=> metric?.rate == null ? '—' : `${Math.round(metric.rate * 100)}% (n=${metric.n}${metric.ci ? `, 95% CI ${Math.round(metric.ci.low*100)}–${Math.round(metric.ci.high*100)}%` : ''})`;
  const lines = [];
  lines.push('# Arise evidence report');
  lines.push('');
  lines.push(`_Generated ${new Date(dash.generatedAtISO).toISOString().slice(0, 16).replace('T', ' ')} UTC · ${dash.disclaimer}_`);
  lines.push('');
  lines.push(`**Sample:** ${dash.resolvedCount} resolved decisions of ${dash.totalRecords} recorded${dash.archivedCount != null ? ` (+${dash.archivedCount} archived)` : ''}.`);
  lines.push('');
  lines.push(`**Evidence band:** ${dash.sampleGate.label} — ${dash.sampleGate.hint}`);
  if(dash.mixedPolicyWarning) lines.push('');
  lines.push(`**Policy mix:** ${Object.entries(dash.policyMix).map(([k,v])=> `${k} ×${v}`).join(', ') || '—'}`);
  if(dash.mixedPolicyWarning){ lines.push(''); lines.push(`> ⚠ ${dash.mixedPolicyWarning}`); }
  lines.push('');
  lines.push('## Adherence');
  lines.push(`- Followed the prescription: ${p(dash.adherence.followed)}`);
  lines.push(`- Mean load deviation when it differed: ${dash.adherence.meanDeviationKg == null ? '—' : `${dash.adherence.meanDeviationKg} kg`}`);
  lines.push(`- Within 2 kg: ${p(dash.adherence.deviationWithin2Kg)}`);
  lines.push(`- Explicit user overrides: ${dash.acceptance.userOverrides.count}`);
  lines.push('');
  lines.push('## Recommendation–outcome agreement');
  lines.push(`- Target met when followed: ${p(dash.agreement.targetMetWhenFollowed)}`);
  const cls = Object.entries(dash.agreement.classifications).map(([k,v])=> `${k} ×${v}`).join(', ');
  lines.push(`- Outcome classifications: ${cls || '—'}`);
  lines.push('');
  lines.push('## Calibration');
  if(dash.calibration.assessed){
    for(const band of ['high','medium','low','low-thin']){
      const b = dash.calibration[band];
      if(b?.n) lines.push(`- ${band} confidence → target met ${p(b)}`);
    }
  } else {
    lines.push('- Not yet assessable — confidence bands need resolved, followed decisions.');
  }
  lines.push('');
  lines.push('## Overshoot');
  lines.push(`- Progressed decisions: ${dash.overshoot.progressedDecisions}`);
  lines.push(`- Overshoot (followed + failed/regressed): ${p(dash.overshoot.overshootRate)}`);
  const guards = Object.entries(dash.overshoot.guardInterventions.byGuard || {}).map(([k,v])=> `${k} ×${v}`).join(', ');
  lines.push(`- Guardrail interventions: ${guards || 'none'}`);
  lines.push('');
  lines.push('## Deloads');
  lines.push(`- Deload decisions: ${dash.deloadUsefulness.deloadDecisions} (assessed: ${dash.deloadUsefulness.assessed})`);
  lines.push(`- Recovered to pre-deload best within window: ${p(dash.deloadUsefulness.recovered)}`);
  lines.push('');
  lines.push('## Plateaus');
  lines.push(`- Plateau holds: ${dash.plateauResolution.plateauHolds}`);
  lines.push(`- Later progressed: ${p(dash.plateauResolution.resolvedUpward)}`);
  lines.push(`- Still stagnant: ${p(dash.plateauResolution.stillStagnant)}`);
  lines.push('');
  lines.push('---');
  lines.push('_Synthetic benchmarks and replay corpora are excluded from this report by construction; every figure derives from on-device decision records._');
  return lines.join('\n');
}
