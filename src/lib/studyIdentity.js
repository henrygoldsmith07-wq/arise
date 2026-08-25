// studyIdentity.js — pseudonymous study-participant identity.
//
// The field protocol collects REPEATED weekly exports from the same person.
// Counting arrivals instead of people lets one lifter × 10 weekly backups
// satisfy a "10 participants" gate, so every installation carries a random,
// content-free identifier that travels inside every export:
//   - generated once per installation; never derived from name, email,
//     filename order, or device fingerprint
//   - preserved through the import allowlist like any other store key
//   - used by the field aggregator to fold repeated exports into ONE person

const ID_PATTERN = /^[0-9a-f]{16}$/;

export function isValidStudyParticipantId(value){
  return typeof value === 'string' && ID_PATTERN.test(value);
}

export function generateStudyParticipantId(){
  const bytes = new Uint8Array(8);
  const cryptoObj = globalThis.crypto;
  if(cryptoObj && typeof cryptoObj.getRandomValues === 'function'){
    cryptoObj.getRandomValues(bytes);
  }else{
    for(let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Guarantee the store carries a usable study id. Mutates and returns the store
// so callers that persist it afterwards (App saves, export payloads) lock the
// identity in. The module-level fallback is reused within a session so a store
// that is exported twice before ever being re-saved still describes itself
// with the SAME id both times.
let sessionFallbackId = null;
export function ensureStudyParticipantId(store){
  const target = store && typeof store === 'object' ? store : {};
  if(isValidStudyParticipantId(target.studyParticipantId)) return target;
  if(!sessionFallbackId) sessionFallbackId = generateStudyParticipantId();
  target.studyParticipantId = sessionFallbackId;
  return target;
}
