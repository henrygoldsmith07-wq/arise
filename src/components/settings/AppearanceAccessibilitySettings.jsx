import { EXPERIENCE_LEVELS, EXPERIENCE_INFO, experiencePatch, resolveExperience } from '../../lib/experienceMode.js';
import { patchAccessibility, patchPreferences } from '../../services/settingsService.js';
import ToggleRow from './ToggleRow.jsx';

const THEME_OPTIONS = [
  { id:null, label:'System' },
  { id:'light', label:'Light' },
  { id:'dark', label:'Dark' },
];

export default function AppearanceAccessibilitySettings({ store, setStore }){
  const prefs = store.preferences || {};
  const a11y = prefs.accessibility || {};
  const setPreference = patch=> setStore(patchPreferences(store, patch));
  const setAccessibility = patch=> setStore(patchAccessibility(store, patch));

  return (
    <section id="sec-appearance" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold">Appearance & accessibility</h3>
      <p className="text-xs text-ink3">Applies to every screen on this device, including the session runner. Stored with your other preferences and included in a backup.</p>

      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <p className="text-xs font-bold">Experience level</p>
        <p className="text-[11px] text-ink3">Controls how much detail the app shows — never what it computes or stores. Everything stays in your export either way.</p>
        <div className="flex gap-1.5" role="group" aria-label="Experience level">
          {EXPERIENCE_LEVELS.map(level=> {
            const active = resolveExperience(prefs) === level;
            return (
              <button key={level} onClick={()=> setPreference(experiencePatch(level))} aria-pressed={active}
                className={`flex-1 min-h-10 rounded-xl border px-2 py-1.5 text-xs ${active ? 'bg-ink text-bg border-ink font-bold' : 'bg-surface border-line text-ink3'}`}>
                <span className="block font-bold">{EXPERIENCE_INFO[level].label}</span>
                <span className={`block text-[10px] leading-snug ${active ? 'text-bg/80' : 'text-ink3'}`}>{EXPERIENCE_INFO[level].hint}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <p className="text-xs font-bold">Theme</p>
        <div className="flex gap-1.5" role="group" aria-label="Theme">
          {THEME_OPTIONS.map(option=> {
            const active = (prefs.theme ?? null) === option.id;
            return (
              <button key={option.label} onClick={()=> setPreference({ theme:option.id })} aria-pressed={active}
                className={`flex-1 min-h-10 rounded-xl border text-xs font-bold ${active ? 'bg-ink text-bg border-ink' : 'bg-surface border-line text-ink2 hover:border-ink3'}`}>
                {option.label}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-ink3">System follows your device setting and keeps following it while the app is open.</p>
      </div>

      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2.5">
        <p className="text-xs font-bold">Accessibility</p>
        <ToggleRow bare label="Larger text" hint="Scales the whole interface up by roughly 12%." checked={a11y.largeText === true} onChange={value=> setAccessibility({ largeText:value })} />
        <ToggleRow bare label="High contrast" hint="Pushes text and borders to maximum contrast against the background." checked={a11y.highContrast === true} onChange={value=> setAccessibility({ highContrast:value })} />
        <ToggleRow bare label="Reduce motion" hint="Removes transitions and animations, regardless of your OS setting." checked={a11y.reduceMotion === true} onChange={value=> setAccessibility({ reduceMotion:value })} />
      </div>
    </section>
  );
}
