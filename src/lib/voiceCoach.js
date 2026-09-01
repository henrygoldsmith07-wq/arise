// voiceCoach.js — spoken step announcements for the guided runner (Web Speech
// API, opt-in). Mirrors audioCues.js conventions: lazy capability checks and
// fully guarded calls so unsupported speech can never break a workout.

export function voiceSupported(){
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

// Speech reads typographic dashes poorly ("8–12" → "8 dash 12"); normalise
// ranges to the word "to" so rep targets sound natural.
function speechFriendly(text){
  return String(text).replace(/(\d)\s*[–—-]\s*(\d)/g, '$1 to $2');
}

export function speak(text, rate = 1){
  if(!voiceSupported() || !text) return;
  try{
    const synth = window.speechSynthesis;
    synth.cancel(); // one announcement at a time — never queue stale steps
    const utterance = new SpeechSynthesisUtterance(speechFriendly(text));
    // Rate comes from the More-view preference; clamp to a sane range so a
    // corrupt stored value can't produce chipmunk or sludge speech.
    const r = Number(rate);
    utterance.rate = Number.isFinite(r) && r >= 0.5 && r <= 2 ? r : 1;
    utterance.pitch = 1;
    synth.speak(utterance);
  }catch{}
}

export function cancelSpeech(){
  if(!voiceSupported()) return;
  try{ window.speechSynthesis.cancel(); }catch{}
}
