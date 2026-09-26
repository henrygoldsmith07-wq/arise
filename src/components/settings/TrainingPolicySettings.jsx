import { POLICY_ORDER, PROGRESSION_POLICIES } from '../../lib/progressionPolicies.js';
import { patchPreferences } from '../../services/settingsService.js';

const EXPLANATION_OPTIONS = [
  ['simple','Simple','One line — what to do.'],
  ['standard','Standard','The reason behind the prescription.'],
  ['advanced','Advanced','Policy, confidence, uncertainty and trend windows.'],
];

export default function TrainingPolicySettings({ store, setStore }){
  const prefs = store.preferences || {};
  const setPreference = patch=> setStore(patchPreferences(store, patch));
  return (
    <section id="sec-policy" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold">Training policy</h3>
      <p className="text-xs text-ink3">Shapes how the engine reacts to your logged sessions — the standard policy is the engine as designed. Applies from the next session.</p>
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <p className="text-xs font-bold">Progression policy</p>
        <div className="flex gap-1.5" role="group" aria-label="Progression policy">
          {POLICY_ORDER.map(id=> {
            const meta = PROGRESSION_POLICIES[id];
            const active = (prefs.progressionPolicy || 'standard') === id;
            return <button key={id} onClick={()=> setPreference({ progressionPolicy:id })} aria-pressed={active} title={meta.description}
              className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>{meta.label}</button>;
          })}
        </div>
        <p className="text-[11px] text-ink3">{PROGRESSION_POLICIES[prefs.progressionPolicy || 'standard']?.description}</p>
      </div>
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <p className="text-xs font-bold">Explanation detail</p>
        <div className="flex gap-1.5" role="group" aria-label="Explanation detail level">
          {EXPLANATION_OPTIONS.map(([id,label,hint])=> {
            const active = (prefs.explanationMode || 'standard') === id;
            return <button key={id} onClick={()=> setPreference({ explanationMode:id })} aria-pressed={active} title={hint}
              className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>{label}</button>;
          })}
        </div>
        <p className="text-[11px] text-ink3">Controls how much detail recommendations show in Train.</p>
      </div>
    </section>
  );
}
