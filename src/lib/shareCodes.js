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

// Decode limits. A share code is pasted text from a message — never trusted.
// The trailing checksum is a plain djb2 checksum, NOT a MAC: anyone can
// recompute it, so every decoded field is validated and the template is
// rebuilt from an allow-list rather than copied through.
const MAX_CODE_LENGTH = 64 * 1024;
const MAX_DAYS = 14;
const MAX_BLOCKS_PER_DAY = 50;
const MAX_TEXT = 200;
const MAX_REPS_TEXT = 32;
const MAX_ID_TEXT = 128;

// `reps` is free-form editor text ("8–12", "AMRAP", "30–45s"), not a number;
// validate its type/length and reject control characters or HTML brackets.
function validReps(value){
  if(value == null || value === '') return true;
  if(typeof value === 'number') return Number.isFinite(value) && value >= 0 && value <= 1000;
  return typeof value === 'string' && value.length <= MAX_REPS_TEXT && !/[\x00-\x1f<>]/.test(value);
}

// sets/restSec/daysPerWeek are numeric. Unset (null/''/undefined) is allowed;
// otherwise coerce numeric strings, then require finite + sane bounds.
function validNumber(value, min, max, integer = false){
  if(value == null || value === '') return true;
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if(typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return false;
  return !integer || Number.isInteger(n);
}

function validText(value, max = MAX_TEXT){
  return typeof value === 'string' && value.length <= max && !/[\x00-\x1f<>]/.test(value);
}

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
    blocks: (w.blocks || []).map(b => ({ exerciseId: b.exerciseId, sets: b.sets, reps: b.reps, restSec: b.restSec, ...(b.supersetWith ? { supersetWith: b.supersetWith } : {}) })),
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
  if(text.length > MAX_CODE_LENGTH) throw new Error('That share code is too long.');
  const parts = text.slice(PREFIX.length).split('.');
  if(parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('The code is incomplete.');
  const [body, sum] = parts;
  if(checksum(body) !== sum) throw new Error('The code is damaged — check it was copied in full.');
  let payload;
  try { payload = JSON.parse(b64urlDecode(body)); } catch { throw new Error('The code is damaged — check it was copied in full.'); }

  // Shape + field validation. Nothing parsed below is copied through to the
  // returned template: every object is rebuilt from an explicit allow-list, so
  // hostile keys (__proto__/constructor/prototype), extra fields and whole
  // block objects can never ride along into store.customTemplates.
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('The code does not contain a usable program.');
  if(!validText(payload.name) || !payload.name) throw new Error('The code does not contain a usable program.');
  if(payload.tagline != null && !validText(payload.tagline)) throw new Error('The code does not contain a usable program.');
  if(payload.level != null && !validText(payload.level)) throw new Error('The code does not contain a usable program.');
  if(!Array.isArray(payload.days) || !payload.days.length || payload.days.length > MAX_DAYS) throw new Error('The code does not contain a usable program.');
  if(payload.daysPerWeek && !validNumber(payload.daysPerWeek, 1, MAX_DAYS, true)) throw new Error('The code contains an invalid training schedule.');

  const days = payload.days.map((day)=> {
    if(!day || typeof day !== 'object' || Array.isArray(day) || !Array.isArray(day.blocks) || !day.blocks.length || day.blocks.length > MAX_BLOCKS_PER_DAY){
      throw new Error('The code does not contain a usable program.');
    }
    if(day.title != null && !validText(day.title)) throw new Error('The code does not contain a usable program.');
    const blocks = day.blocks.map((b)=> {
      if(!b || typeof b !== 'object' || Array.isArray(b)) throw new Error('The code does not contain a usable program.');
      if(typeof b.exerciseId !== 'string' || !b.exerciseId || b.exerciseId.length > MAX_ID_TEXT) throw new Error('The code references an unknown exercise.');
      if(!validNumber(b.sets, 1, 50, true) || !validNumber(b.restSec, 0, 600) || !validReps(b.reps)) throw new Error('The code contains invalid set details.');
      if(b.supersetWith != null && (typeof b.supersetWith !== 'string' || b.supersetWith.length > MAX_ID_TEXT)) throw new Error('The code contains invalid set details.');
      const clean = { exerciseId: b.exerciseId };
      if(b.sets != null && b.sets !== '') clean.sets = b.sets;
      if(b.reps != null && b.reps !== '') clean.reps = b.reps;
      if(b.restSec != null && b.restSec !== '') clean.restSec = b.restSec;
      if(b.supersetWith) clean.supersetWith = b.supersetWith;
      return clean;
    });
    return { title: day.title || '', blocks };
  });

  const id = `shared-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const daysPerWeek = payload.daysPerWeek || days.length;
  return {
    id, isCustom: true, version: 1, createdAtISO: new Date().toISOString(),
    name: payload.name, description: payload.tagline || 'Shared program.',
    level: payload.level || 'Beginner', goal: 'general',
    daysPerWeek,
    program: {
      id, name: payload.name, tagline: payload.tagline || 'Shared program.',
      level: payload.level || 'Beginner', daysPerWeek,
      mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' },
      version: 1, equipment: [],
      weeks: [{ week: 1, workouts: days.map((d, i) => ({ day: i + 1, title: d.title || `Day ${i + 1}`, blocks: d.blocks })) }],
    },
  };
}

/** Round-trip helper for tests. */
export function shareCodeRoundTrips(template){
  try { return decodeShareCode(encodeShareCode(template)).name === (template.program?.name || template.name); }
  catch { return false; }
}
