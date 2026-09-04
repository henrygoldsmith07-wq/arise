// EvidenceDashboard.jsx — recommendation-outcome agreement for the user's own
// decisions, gated by sample size and visualising uncertainty (Wilson 95% CI).
//
// Scope honesty: this is observational, on-device analysis. Every block carries
// the not-causal disclaimer; synthetic benchmarks never appear here (they live
// in benchmark/, excluded from the ledger by construction).
import { useMemo, useState } from 'react';
import { evidenceDashboard, renderEvidenceReportMarkdown, downloadEvidenceReport } from '../lib/evidenceMetrics.js';

// Wilson CI rendered as a thin bar: the estimate is a dot, the interval the
// whisker. Small n ⇒ wide whisker — uncertainty is the message, not a flaw.
function CiBar({ metric }){
  if(metric?.rate == null || !metric.ci) return <span className="text-ink3">—</span>;
  const pct = v=> `${Math.round(v * 100)}%`;
  const left = Math.round(metric.ci.low * 100);
  const width = Math.max(1, Math.round((metric.ci.high - metric.ci.low) * 100));
  return (
    <span className="inline-flex items-center gap-2 min-w-0" title={`95% CI ${pct(metric.ci.low)}–${pct(metric.ci.high)}%`}>
      <span className="relative inline-block h-1.5 w-24 rounded-full bg-surface2 border border-line align-middle" aria-hidden>
        <span className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-ink3/50" style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%` }} />
        <span className="absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-ink" style={{ left: `${Math.round(metric.rate * 100)}%` }} />
      </span>
      <span className="tabular-nums font-bold">{pct(metric.rate)}</span>
      <span className="text-ink3 tabular-nums">n={metric.n}</span>
    </span>
  );
}

const BAND_STYLE = {
  insufficient: 'border-line text-ink3',
  emerging: 'border-review/40 text-review bg-reviewsoft',
  consistent: 'border-accent/40 text-accent bg-accentsubtle',
  high: 'border-success/40 text-success bg-successsoft',
};

function Row({ label, metric, children }){
  return (
    <div role="row" className="flex items-center gap-2 text-[11px] min-w-0">
      <span className="w-40 shrink-0 text-ink2" role="cell">{label}</span>
      <span role="cell" className="min-w-0 flex-1">{children ?? <CiBar metric={metric} />}</span>
    </div>
  );
}

export default function EvidenceDashboard({ records = [], archivedCount = null }){
  const [showRaw, setShowRaw] = useState(false);
  const [msg, setMsg] = useState(null);
  const dash = useMemo(()=> {
    try{ return evidenceDashboard(records, { archivedCount }); }catch{ return null; }
  }, [records, archivedCount]);

  if(!dash) return null;
  const band = dash.sampleGate;
  const gated = band.band === 'insufficient';

  const flash = (text)=> { setMsg(text); setTimeout(()=> setMsg(null), 2500); };

  return (
    <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-bold">Your decision record</p>
        <span className={`ml-auto px-2 py-0.5 rounded-full border text-[10px] font-bold ${BAND_STYLE[band.band]}`}>{band.label}</span>
      </div>
      <p className="text-[11px] text-ink3">{band.hint} {dash.totalRecords} decisions recorded ({dash.acceptance.openDecisions} awaiting their workout){dash.archivedCount != null && dash.archivedCount > 0 ? ` · ${dash.archivedCount} older archived` : ''}.</p>
      {dash.mixedPolicyWarning && (
        <p className="text-[11px] text-review bg-reviewsoft border border-review/30 rounded-lg px-2 py-1.5">⚠ {dash.mixedPolicyWarning}</p>
      )}

      {gated ? (
        <p className="text-[11px] text-ink3">Metrics unlock at 3 resolved decisions — every proportion here also shows its 95% confidence interval, so small samples read honestly (wide whisker = don't trust it yet).</p>
      ) : (
        <div className="space-y-2" role="table" aria-label="Recommendation outcome metrics">
          <Row label="Followed prescription" metric={dash.adherence.followed} />
          <Row label="Target met when followed" metric={dash.agreement.targetMetWhenFollowed} />
          <Row label="Load within 2 kg" metric={dash.adherence.deviationWithin2Kg} />
          <Row label="Overshoot (failed after progress)" metric={dash.overshoot.overshootRate} />
          <Row label="Deloads recovered" metric={dash.deloadUsefulness.assessed > 0 ? dash.deloadUsefulness.recovered : null}>
            {dash.deloadUsefulness.assessed > 0
              ? <CiBar metric={dash.deloadUsefulness.recovered} />
              : <span className="text-ink3">no deload decisions yet</span>}
          </Row>
          <Row label="Plateau holds later progressed" metric={dash.plateauResolution.plateauHolds > 0 ? dash.plateauResolution.resolvedUpward : null}>
            {dash.plateauResolution.plateauHolds > 0
              ? <CiBar metric={dash.plateauResolution.resolvedUpward} />
              : <span className="text-ink3">no plateau holds yet</span>}
          </Row>
          {dash.calibration.assessed && (
            <Row label="High-confidence calls met" metric={dash.calibration.high?.n ? dash.calibration.high : null}>
              {dash.calibration.high?.n
                ? <CiBar metric={dash.calibration.high} />
                : <span className="text-ink3">no high-confidence resolved calls yet</span>}
            </Row>
          )}
          {!!dash.overshoot.guardInterventions.total && (
            <p className="text-[11px] text-ink3">Guardrails intervened {dash.overshoot.guardInterventions.total}× ({Object.entries(dash.overshoot.guardInterventions.byGuard).map(([k,v])=> `${k} ${v}×`).join(', ')}).</p>
          )}
        </div>
      )}

      <p className="text-[10px] text-ink3 border-t border-line pt-1.5">{dash.disclaimer}</p>

      <div className="flex flex-wrap gap-2">
        <button onClick={()=> { downloadEvidenceReport(dash); flash('Report downloaded.'); }}
          className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Export report (.md)</button>
        <button onClick={()=> { const w = window.open('', '_blank', 'width=800,height=1000'); if(!w){ flash('Allow pop-ups to print.'); return; } w.document.title = 'Arise evidence report'; const pre = w.document.createElement('pre'); pre.style.cssText = "font: 12px/1.5 ui-monospace,monospace; white-space: pre-wrap; margin: 24px"; pre.textContent = renderEvidenceReportMarkdown(dash); w.document.body.appendChild(pre); w.print(); }}
          className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Print / save as PDF</button>
        <button onClick={()=> setShowRaw(v=> !v)} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">{showRaw ? 'Hide' : 'Show'} raw records</button>
      </div>
      {msg && <p className="text-[11px] text-success font-bold" role="status">{msg}</p>}
      {showRaw && (
        <pre className="text-[10px] leading-snug bg-surface border border-line rounded-lg p-2 overflow-x-auto max-h-64 overflow-y-auto" aria-label="Raw ledger records">{JSON.stringify(records, null, 1)}</pre>
      )}
    </div>
  );
}
