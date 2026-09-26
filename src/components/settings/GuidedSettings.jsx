import ToggleRow from './ToggleRow.jsx';
import { voiceSupported } from '../../lib/voiceCoach.js';
import { patchPreferences } from '../../services/settingsService.js';

const VOICE_RATE_OPTIONS = [
  { rate:0.85, label:'Slow' },
  { rate:1, label:'Normal' },
  { rate:1.2, label:'Fast' },
];

export default function GuidedSettings({ store, setStore }){
  const prefs = store.preferences || {};
  const setPreference = patch=> setStore(patchPreferences(store, patch));
  return (
    <section id="sec-guided" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold">Guided mode</h3>
      <p className="text-xs text-ink3">Applies to guided sessions — one set at a time, with timers. Changes take effect immediately, including mid-workout.</p>
      <ToggleRow label="Sound cues" hint="Short tones when rest starts, a 3-2-1 tick, and a completion chime. A mute button also lives on the rest timer itself."
        checked={prefs.soundCues !== false} onChange={value=> setPreference({ soundCues:value })} />
      <ToggleRow label="Voice coach" hint="Speaks the exercise name, set number and rep target as each new step starts. Uses your device's built-in speech — nothing is sent anywhere."
        checked={prefs.voiceCoach === true} onChange={value=> setPreference({ voiceCoach:value })} />
      <ToggleRow label="Maximum effort warnings" hint="Notes when a prescribed target sits close to failure (from your last logged RPE) and reminds you to set safeties and watch bar speed."
        checked={prefs.maxEffortWarnings === true} onChange={value=> setPreference({ maxEffortWarnings:value })} />
      <div className={`rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2 ${prefs.voiceCoach === true ? '' : 'opacity-60'}`}>
        <p className="text-xs font-bold">Speech rate</p>
        <div className="flex gap-1.5" role="group" aria-label="Voice coach speech rate">
          {VOICE_RATE_OPTIONS.map(option=> {
            const active = (Number(prefs.voiceRate) || 1) === option.rate;
            return <button key={option.label} onClick={()=> setPreference({ voiceRate:option.rate })} aria-pressed={active}
              className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>{option.label}</button>;
          })}
        </div>
        <p className="text-[11px] text-ink3">{voiceSupported() ? 'Applies to the voice coach only — sound cues keep their own rhythm.' : 'Speech is not supported in this browser — the voice coach toggle stays off.'}</p>
      </div>
    </section>
  );
}
