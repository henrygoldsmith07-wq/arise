// voiceInput.js — dictation for set logging (hands-free mode).
//
// Uses the Web Speech API (same engine the voice coach speaks through, in
// reverse). One job: turn "twelve and a half for eight" into a structured
// { weightKg, reps } for the row the user already has selected. Numbers-only
// grammar by habit — the result handler accepts digits or number words and
// ignores everything else, so a cough or gym chatter cannot corrupt a set.
//
// Unsupported engines (Firefox, some iOS builds) report `supported: false`
// and the UI hides the control; the keypad remains the always-available path.

function numberWords(){
  return {
    one:1, won:1, two:2, to:2, too:2, three:3, four:4, for:4, five:5, six:6,
    seven:7, eight:8, ate:8, nine:9, ten:10, eleven:11, twelve:12, thirteen:13,
    fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18, nineteen:19,
    twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
    hundred:100, thousand:1000,
  };
}

/** Parse a spoken/typed phrase like "forty two point five for eight" into numbers. */
export function parseSetPhrase(text){
  const t = String(text || '').toLowerCase().replace(/,/g, '.').trim();
  if(!t) return null;
  const parts = t.split(/\s+(?:for|x|by|times|reps?)\s+/);
  let weight = null, reps = null;
  if(parts.length >= 2){
    weight = toNumber(parts[0].trim());
    reps = toNumber(parts[1].trim());
  } else {
    // Bare numbers: first is weight, second reps; a lone number (digits or
    // number words like "twelve") is reps.
    const nums = t.match(/\d+(\.\d+)?/g);
    if(nums && nums.length >= 2){ weight = Number(nums[0]); reps = Number(nums[1]); }
    else if(nums && nums.length === 1){ reps = Number(nums[0]); }
    else {
      const single = toNumber(t);
      if(single != null) reps = single;
    }
  }
  if(weight == null && reps == null) return null;
  const out = {};
  if(weight != null && weight > 0 && weight < 1000) out.weightKg = Math.round(weight * 10) / 10;
  if(reps != null && reps >= 0 && reps <= 100) out.reps = Math.round(reps);
  return Object.keys(out).length ? out : null;
}

const DECIMAL_WORDS = { five: 5, one: 1, two: 2, three: 3, four: 4, six: 6, seven: 7, eight: 8, nine: 9, zero: 0, nought: 0, oh: 0 };
const WORDS = numberWords();

/** Parse one number phrase: digits, number words, or words + "point x". */
function toNumber(phrase){
  if(!phrase) return null;
  let cleaned = phrase.trim();
  let frac = 0;
  const dm = cleaned.match(/\b(?:point|dot)\s*(five|one|two|three|four|six|seven|eight|nine|zero|nought|oh|\d)\b/);
  if(dm){
    const d = /^\d$/.test(dm[1]) ? Number(dm[1]) : DECIMAL_WORDS[dm[1]];
    if(d != null){
      frac = d / 10;
      cleaned = cleaned.replace(dm[0], ' ').trim();
    }
  }
  if(/^\d+(\.\d+)?$/.test(cleaned)) return Number(cleaned) + frac;
  let total = 0, current = 0, matched = false;
  for(const w of cleaned.split(/[\s-]+/)){
    if(w === '') continue;
    if(/^\d+$/.test(w)){ current += Number(w); matched = true; total = current; continue; }
    const n = WORDS[w];
    if(n == null) continue;
    matched = true;
    if(n >= 100) current = (current || 1) * n;
    else current += n;
    total = current;
  }
  return matched ? Math.round((total + frac) * 10) / 10 : null;
}

/** Feature detection + controller bound to one recognition session. */
export function createVoiceInput({ onResult, onEnd, onError } = {}){
  const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
  if(!SR) return { supported: false, start(){}, stop(){} };
  const rec = new SR();
  rec.lang = typeof navigator !== 'undefined' ? navigator.language || 'en-US' : 'en-US';
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  let active = false;
  rec.onresult = (e) => {
    const said = e.results?.[0]?.[0]?.transcript || '';
    const parsed = parseSetPhrase(said);
    try { onResult?.(parsed, said); } catch { /* consumer errors are theirs */ }
  };
  rec.onerror = (e) => { try { onError?.(e?.error || 'error'); } catch { /* ignore */ } };
  rec.onend = () => { active = false; try { onEnd?.(); } catch { /* ignore */ } };
  return {
    supported: true,
    start(){
      if(active) return;
      try { rec.start(); active = true; } catch { try { onError?.('start-failed'); } catch { /* ignore */ } }
    },
    stop(){ if(active){ try { rec.stop(); } catch { /* ignore */ } } },
  };
}
