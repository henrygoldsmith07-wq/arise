// RestDock.jsx — the rest countdown with per-exercise presets, voice
// announcements, fine ± adjustments, and a mini mode (compact pill) so the
// session stays scrollable while the clock runs.
//
// Extracted from GymModePanel (its previous home) into its own module:
// the dock is shared by every presentation style, not a Gym-Mode-only piece.
// Presentation + callbacks only — the runners own the timer state.
import { useEffect, useRef, useState } from 'react';
import { REST_PRESET_CHOICES } from '../../lib/gymMode.js';
import { speak, voiceSupported } from '../../lib/voiceCoach.js';
import { fmtRest } from '../../lib/guidedMode.js';
import { announce } from '../../lib/a11y.js';

export function RestDock({ endsAt, clock, label, onChange, exerciseId, exerciseName = '', presetSeconds = null, gymPrefs = null, onSetRestPreset = null, voiceRate = 1 }){
  const [mini, setMini] = useState(false);
  const [voiceRest, setVoiceRest] = useState(false);
  const spokenMinuteRef = useRef(null);

  const left = endsAt ? Math.max(0, Math.ceil((endsAt - clock) / 1000)) : 0;
  const adjust = (delta)=> onChange(Math.max(Date.now() + 5000, (endsAt || Date.now()) + delta * 1000));

  const say = ()=>{
    if(!voiceSupported() || !left) return;
    const m = Math.floor(left / 60), r = left % 60;
    const phrase = m ? `${m} minute${m === 1 ? '' : 's'}${r ? ` ${r} seconds` : ''}` : `${r} seconds remaining`;
    speak(`${phrase}. ${label ? `Next: ${label}.` : ''}`, voiceRate);
  };

  // Minute markers: spoken once each when voice announcements are on, and
  // always mirrored to the app's polite live region when they are OFF —
  // screen-reader users get the same "2 minutes remaining…" cadence without
  // the countdown's per-second ticks (the announcer dedupes and throttles;
  // voice-on users skip the SR copy so the two channels never double-speak).
  useEffect(()=>{
    if(!endsAt){ spokenMinuteRef.current = null; return; }
    const mark = Math.ceil(left / 60);
    if(left > 0 && left % 60 === 0 && spokenMinuteRef.current !== mark){
      spokenMinuteRef.current = mark;
      const m = Math.floor(left / 60);
      const phrase = m === 1 ? '1 minute remaining' : `${m} minutes remaining`;
      if(voiceRest){
        say();
      } else {
        announce(`${phrase}. ${label ? `Next: ${label}.` : ''}`, { key: 'rest-timer' });
      }
    }
  }, [clock, endsAt, voiceRest, left]);

  if(mini){
    return (
      <button onClick={()=> setMini(false)} aria-label={`Rest timer mini: ${fmtRest(left)} remaining. Expand`}
        className="w-full max-w-3xl mx-auto rounded-full bg-ink text-bg px-4 py-2 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest opacity-70">Rest</span>
        <span className="text-lg font-black tabular-nums leading-none" aria-live="off">{fmtRest(left)}</span>
        <span className="text-[11px] truncate opacity-80">{label}</span>
        <span className="ml-auto text-[10px] font-bold opacity-70">expand ▲</span>
      </button>
    );
  }

  return (
    <div className="rounded-2xl bg-ink text-bg px-4 py-3 space-y-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest opacity-70 leading-none">Rest</p>
          <p className="text-xs font-bold truncate opacity-80">{label}</p>
        </div>
        <span className="ml-auto text-4xl font-black tabular-nums leading-none" aria-live="off">{fmtRest(left)}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {voiceSupported() && (
            <button onClick={say} aria-label="Speak remaining rest time" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-sm leading-none">🗣️</button>
          )}
          <button onClick={()=> setVoiceRest(v=> !v)} aria-pressed={voiceRest} aria-label={voiceRest ? 'Rest voice announcements on' : 'Rest voice announcements off'}
            title="Announce each minute aloud" className={`min-h-11 min-w-11 px-1.5 rounded-full text-sm leading-none ${voiceRest ? 'bg-bg text-ink' : 'bg-bg/15'}`}>🔁</button>
          <button onClick={()=> setMini(true)} aria-label="Shrink rest timer" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-sm leading-none">▼</button>
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={()=> adjust(-15)} aria-label="Rest 15 seconds less" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">−15s</button>
        <button onClick={()=> adjust(-60)} aria-label="Rest 1 minute less" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">−1m</button>
        <button onClick={()=> adjust(30)} aria-label="Rest 30 seconds more" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">+30s</button>
        <button onClick={()=> adjust(60)} aria-label="Rest 1 minute more" className="min-h-11 min-w-11 px-1.5 rounded-full bg-bg/15 text-xs font-bold tabular-nums">+1m</button>
        <button onClick={()=> onChange(null)} aria-label="Skip rest" className="min-h-11 px-3 rounded-full bg-bg text-ink text-xs font-bold">Skip</button>
        {REST_PRESET_CHOICES.map(sec=> (
          <button key={sec}
            onClick={()=>{
              onChange(Date.now() + sec * 1000);
              if(onSetRestPreset && exerciseId) onSetRestPreset(exerciseId, sec);
            }}
            aria-pressed={presetSeconds === sec}
            className={`min-h-11 min-w-11 px-2.5 rounded-full text-[11px] font-bold tabular-nums ${presetSeconds === sec ? 'bg-bg text-ink' : 'bg-bg/15'}`}>
            {sec < 60 ? `${sec}s` : `${sec / 60}m`}
          </button>
        ))}
      </div>
      {onSetRestPreset && exerciseId && (
        <p className="text-[10px] opacity-60">Tapping a preset also remembers it for this exercise ({exerciseName || exerciseId}).</p>
      )}
    </div>
  );
}

export default RestDock;
