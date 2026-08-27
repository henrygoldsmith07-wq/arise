import { useMemo } from 'react';
import { buildResponseFingerprint } from '../lib/responseFingerprint.js';

const CUE_META = {
  push: {
    label: 'Push the next step',
    detail: 'Your recent response supports taking the next measured increment.',
    classes: 'border-success/40 bg-successsoft text-success',
    icon: '↗',
  },
  hold: {
    label: 'Hold and repeat',
    detail: 'Repeat the last target and let consistency do the work.',
    classes: 'border-review/30 bg-reviewsoft text-review',
    icon: '→',
  },
  collecting: {
    label: 'Fingerprint collecting',
    detail: 'Keep logging the context around each exposure before changing the plan.',
    classes: 'border-line bg-surface2 text-ink2',
    icon: '…',
  },
};

const GROUP_LABELS = {
  ready: 'Ready days',
  'under-recovered': 'Under-recovered',
  unknown: 'No readiness logged',
  'low reps': 'Low reps',
  'mid reps': 'Mid reps',
  'high reps': 'High reps',
  'felt strong': 'Felt strong',
  'felt taxed': 'Felt taxed',
  'no signal': 'No note signal',
};

function signedPercent(value){
  if(value == null) return '—';
  const pct = Number(value) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(Math.abs(pct) >= 10 ? 0 : 1)}%`;
}

function percent(value){
  return value == null ? '—' : `${Math.round(Number(value) * 100)}%`;
}

function groupRows(groups){
  return groups.filter(group => group.n > 0).sort((a, b) => {
    const aChange = a.meanChangePct == null ? -Infinity : a.meanChangePct;
    const bChange = b.meanChangePct == null ? -Infinity : b.meanChangePct;
    return b.n - a.n || bChange - aChange;
  });
}

function GroupList({ title, groups }){
  const rows = groupRows(groups);
  if(!rows.length) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface2 p-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-ink3">{title}</p>
      <div className="mt-3 space-y-2.5">
        {rows.map(group => {
          const width = group.progressionRate == null ? 0 : Math.max(4, Math.min(100, Math.round(group.progressionRate * 100)));
          return (
            <div key={group.key}>
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold">{GROUP_LABELS[group.key] || group.key}</span>
                <span className="font-black tabular-nums">{signedPercent(group.meanChangePct)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 rounded-full bg-surface overflow-hidden" aria-hidden="true"><div className="h-full rounded-full bg-ink" style={{ width: `${width}%` }} /></div>
                <span className="w-14 text-right text-[10px] text-ink3 tabular-nums">{percent(group.progressionRate)} · n={group.n}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ResponseFingerprintCard({ history = [], exerciseId = '', readinessLog = [] }){
  const fingerprint = useMemo(() => {
    if(!exerciseId) return null;
    try{ return buildResponseFingerprint(history, exerciseId, readinessLog); }catch{ return null; }
  }, [history, exerciseId, readinessLog]);

  if(!fingerprint) return null;
  const cue = CUE_META[fingerprint.cue] || CUE_META.collecting;
  const missing = Math.max(0, fingerprint.minimumTransitions - fingerprint.transitions);
  const bestParts = [fingerprint.bestReadiness, fingerprint.bestRepRange, fingerprint.bestContext].filter(Boolean);
  const best = bestParts[0];

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-ink text-bg text-lg" aria-hidden="true">⌁</div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-ink3">Personal response fingerprint</p>
          <h3 className="mt-1 text-base font-black">The conditions behind your next good session</h3>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wide ${cue.classes}`}>{fingerprint.status === 'ready' ? 'live' : 'collecting'}</span>
      </div>

      <div className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 ${cue.classes}`}>
        <span className="text-base font-black leading-none" aria-hidden="true">{cue.icon}</span>
        <div><p className="text-sm font-black">{cue.label}</p><p className="mt-0.5 text-[11px] leading-relaxed opacity-80">{fingerprint.latest?.readinessBand === 'under-recovered' ? 'Readiness is low today, so the cue is deliberately conservative.' : cue.detail}</p></div>
      </div>

      {fingerprint.status === 'collecting' ? (
        <div className="rounded-xl border border-dashed border-line p-3">
          <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold">{fingerprint.transitions} of {fingerprint.minimumTransitions} transitions observed</span><span className="text-ink3 tabular-nums">{missing} to unlock</span></div>
          <div className="mt-2 h-1.5 rounded-full bg-surface2 overflow-hidden"><div className="h-full rounded-full bg-ink" style={{ width: `${Math.min(100, Math.round(fingerprint.transitions / fingerprint.minimumTransitions * 100))}%` }} /></div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink3">Arise needs a few before/after observations before it names your sweet spot. The cue above stays intentionally modest.</p>
        </div>
      ) : (
        <>
          {best && <div className="rounded-xl border border-success/30 bg-successsoft px-3 py-2.5"><p className="text-[11px] font-bold uppercase tracking-wide text-success">Your strongest observed window</p><p className="mt-1 text-sm font-black">{GROUP_LABELS[best.key] || best.key} <span className="font-normal text-ink2">· {signedPercent(best.meanChangePct)} average next-exposure change</span></p><p className="mt-1 text-[11px] text-ink3">Based on {best.n} matched transitions.</p></div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <GroupList title="Readiness" groups={fingerprint.readiness} />
            <GroupList title="Rep range" groups={fingerprint.repRange} />
          </div>
          {!!groupRows(fingerprint.context).length && <GroupList title="Session feel" groups={fingerprint.context} />}
        </>
      )}

      <p className="text-[11px] leading-relaxed text-ink3">{fingerprint.note}</p>
    </section>
  );
}

