// exerciseTextLoader.js — browser-side loader for data/exercise-text.json.
// `?url` makes Vite emit the JSON as a hashed asset (not JS), which the
// service worker precaches with the rest of assets/. One fetch per session.
import { useEffect, useState } from 'react';
import textUrl from './data/exercise-text.json?url';
import { setExerciseText, exerciseTextLoaded } from './exerciseText.js';

let pending = null;

export function loadExerciseText(){
  if(exerciseTextLoaded()) return Promise.resolve(true);
  if(!pending){
    pending = fetch(textUrl)
      .then(r => (r.ok ? r.json() : null))
      .then(map => { if(map) setExerciseText(map); return exerciseTextLoaded(); })
      .catch(() => false)
      .finally(() => { if(!exerciseTextLoaded()) pending = null; });
  }
  return pending;
}

/** Re-renders once the long-form text is available; returns whether it is. */
export function useExerciseText(enabled = true){
  const [ready, setReady] = useState(exerciseTextLoaded());
  useEffect(() => {
    if(ready || !enabled) return undefined;
    let live = true;
    loadExerciseText().then(ok => { if(live && ok) setReady(true); });
    return () => { live = false; };
  }, [ready, enabled]);
  return ready;
}
