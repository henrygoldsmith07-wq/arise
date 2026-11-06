// customExercises.js — lifts the user makes themselves (Hevy/Strong-style).
// Stored as gymPrefs.customExercises[id] = { name, muscle, equipment, updatedAt,
// deleted? } so persistence, backup and sync carry them like setup notes; the
// merge is per lift, newest edit wins, and a deletion is a tombstone so an
// older copy on another device cannot bring it back. Registered into the
// catalogue at runtime, every engine (progression, PRs, volume, exports)
// treats a custom lift like a built-in one.
import { EXERCISES, EXERCISE_BY_ID, EQUIPMENT, MUSCLES } from "./data.js";

const MAX = 200;
const LIFT_MUSCLES = MUSCLES.filter((m) => m !== "Cardio");
const EQUIPMENT_IDS = EQUIPMENT.map((e) => e.id);

const clean = (v) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 48);
const slug = (name) => clean(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lift";
const stamp = (e) => Date.parse(e?.updatedAt || "") || 0;

/** Clean a stored map (hydration / import / sync); drops malformed rows. */
export function sanitizeCustomExercises(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const id of Object.keys(raw).slice(0, MAX)) {
    const e = raw[id];
    if (!/^custom-[a-z0-9-]{1,48}$/.test(id) || !e || typeof e !== "object") continue;
    const name = clean(e.name);
    if (e.deleted) { out[id] = { ...(name ? { name } : {}), deleted: true, updatedAt: e.updatedAt || new Date(0).toISOString() }; continue; }
    if (!name) continue;
    out[id] = {
      name,
      muscle: LIFT_MUSCLES.includes(e.muscle) ? e.muscle : "Full body",
      equipment: EQUIPMENT_IDS.includes(e.equipment) ? e.equipment : "bodyweight",
      updatedAt: e.updatedAt || new Date(0).toISOString(),
    };
  }
  return out;
}

/** Live (non-deleted) custom lifts, A–Z. */
export function liveCustomExercises(gymPrefs) {
  return Object.entries(sanitizeCustomExercises(gymPrefs?.customExercises))
    .filter(([, e]) => !e.deleted)
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** gymPrefs patch adding a lift, or { error }. Names are unique, case-blind, against built-ins too. */
export function addCustomExercise(gymPrefs, { name, muscle, equipment }, nowISO = new Date().toISOString()) {
  const map = sanitizeCustomExercises(gymPrefs?.customExercises);
  const n = clean(name);
  if (n.length < 2) return { error: "Give it a name (2+ characters)." };
  const taken = (x) => x.toLowerCase() === n.toLowerCase();
  if (EXERCISES.some((e) => !e.custom && taken(e.name)) || Object.values(map).some((e) => !e.deleted && taken(e.name)))
    return { error: `“${n}” already exists — pick it from the list.` };
  if (Object.values(map).filter((e) => !e.deleted).length >= MAX) return { error: `At most ${MAX} custom exercises.` };
  let id = `custom-${slug(n)}`;
  for (let i = 2; map[id] && !map[id].deleted; i++) id = `custom-${slug(n)}-${i}`;
  const entry = sanitizeCustomExercises({ [id]: { name: n, muscle, equipment, updatedAt: nowISO } })[id];
  return { id, patch: { customExercises: { ...map, [id]: entry }, updatedAt: nowISO } };
}

/** gymPrefs patch removing a lift (tombstone). Logged history keeps its sets. */
export function removeCustomExercise(gymPrefs, id, nowISO = new Date().toISOString()) {
  const map = sanitizeCustomExercises(gymPrefs?.customExercises);
  return { customExercises: { ...map, [id]: { ...(map[id]?.name ? { name: map[id].name } : {}), deleted: true, updatedAt: nowISO } }, updatedAt: nowISO };
}

/** Deterministic per-lift merge: newer updatedAt wins; a tie prefers the tombstone. */
export function mergeCustomExercises(a, b) {
  const x = sanitizeCustomExercises(a), y = sanitizeCustomExercises(b), out = {};
  for (const id of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[id], q = y[id];
    out[id] = !p || !q ? p || q : stamp(p) !== stamp(q) ? (stamp(p) > stamp(q) ? p : q) : p.deleted ? p : q.deleted ? q : JSON.stringify(p) >= JSON.stringify(q) ? p : q;
  }
  return out;
}

/** Catalogue entry for a custom lift — the shape the engines expect. */
export function toCatalogue({ id, name, muscle, equipment }) {
  const bw = equipment === "bodyweight";
  return { id, name, muscle, equipment: [equipment], level: "Beginner", tags: ["custom"], cues: [], substitution: [], unilateral: false, supportsWeighted: bw, supportsAssisted: false, progression: bw ? "reps" : "load", rom: false, custom: true };
}

let registered = "";
/** Put the live custom lifts into EXERCISES / EXERCISE_BY_ID (idempotent). A
 *  deleted lift leaves the pickers but stays in EXERCISE_BY_ID by name, so the
 *  history logged with it still reads as that lift. */
export function registerCustomExercises(gymPrefs) {
  const map = sanitizeCustomExercises(gymPrefs?.customExercises);
  const key = JSON.stringify(map);
  if (key === registered) return;
  registered = key;
  for (let i = EXERCISES.length - 1; i >= 0; i--) if (EXERCISES[i].custom) EXERCISES.splice(i, 1);
  for (const [id, e] of Object.entries(map)) {
    if (!e.name) continue;
    const ex = toCatalogue({ id, muscle: "Full body", equipment: "bodyweight", ...e });
    EXERCISE_BY_ID[id] = ex;
    if (!e.deleted) EXERCISES.push(ex);
  }
}
