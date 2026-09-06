// shareCodes.js — portable, copyable program/template sharing.
//
// A custom template becomes a compact URI-safe code the user can paste into a
// message, and the recipient installs it with one tap — no file, no server,
// no account. Format: "ARISE1." + base64url(JSON) with a trailing checksum so
// truncated or mistyped codes fail loudly instead of installing garbage.
//
// Scope guard: the payload is ONLY the template definition (name, description,
// level, goal, days, blocks) — never history, settings, or identifiers. IDs are
// regenerated on install so two people importing the same code never collide.

const PREFIX = 'ARISE1.';

/** URI-safe base64 (no padding, +/ → -_) of a UTF-8 string. */
function b64urlEncode(str){
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for(const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(text){
  const pad = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(pad + '='.repeat((4 - pad.length % 4) % 4));
  const bytes = new Uint8Array(bin.length);
  for(let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function checksum(text){
  let h = 5381;
  for(let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** Strip a template down to its shareable definition. */
export function templateToSharePayload(template){
  const t = template?.program ? template.program : template;
  if(!t) throw new Error('Nothing to share');
  const days = (t.weeks?.[0]?.workouts || []).map(w => ({
    title: w.title,
    blocks: (w.blocks || []).map(b => ({ exerciseId: b.exerciseId, sets: b.sets, reps: b.reps, restSec: b.restSec })),
  }));
  return {
    name: t.name, tagline: t.tagline || t.description || '', level: t.level,
    daysPerWeek: t.daysPerWeek || days.length, days,
  };
}

/** Encode a template to its share code. Throws when nothing shareable remains. */
export function encodeShareCode(template){
  const payload = templateToSharePayload(template);
  const json = JSON.stringify(payload);
  const body = b64urlEncode(json);
  return PREFIX + body + '.' + checksum(body);
}

/**
 * Decode and validate a share code. Returns the template definition with a
 * fresh id, or throws with a human-readable reason.
 */
export function decodeShareCode(code){
  const text = String(code || '').trim();
  if(!text.startsWith(PREFIX)) throw new Error('That does not look like an Arise share code.');
  const parts = text.slice(PREFIX.length).split('.');
  if(parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('The code is incomplete.');
  const [body, sum] = parts;
  if(checksum(body) !== sum) throw new Error('The code is damaged — check it was copied in full.');
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { throw new Error('The code is damaged — check it was copied in full.'); }
  if(!payload || typeof payload.name !== 'string' || !Array.isArray(payload.days) || !payload.days.length){
    throw new Error('The code does not contain a usable program.');
  }
  for(const day of payload.days){
    if(!Array.isArray(day.blocks)) throw new Error('The code does not contain a usable program.');
    for(const b of day.blocks){
      if(typeof b.exerciseId !== 'string' || !b.exerciseId) throw new Error('The code references an unknown exercise.');
    }
  }
  const id = `shared-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  return {
    id, isCustom: true, version: 1, createdAtISO: new Date().toISOString(),
    name: payload.name, description: payload.tagline || 'Shared program.',
    level: payload.level || 'Beginner', goal: 'general',
    daysPerWeek: payload.daysPerWeek || payload.days.length,
    program: {
      id, name: payload.name, tagline: payload.tagline || 'Shared program.',
      level: payload.level || 'Beginner', daysPerWeek: payload.daysPerWeek || payload.days.length,
      mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' },
      version: 1, equipment: [],
      weeks: [{ week: 1, workouts: payload.days.map((d, i) => ({ day: i + 1, title: d.title || `Day ${i + 1}`, blocks: d.blocks })) }],
    },
  };
}

/** Round-trip helper for tests. */
export function shareCodeRoundTrips(template){
  try { return decodeShareCode(encodeShareCode(template)).name === (template.program?.name || template.name); }
  catch { return false; }
}
