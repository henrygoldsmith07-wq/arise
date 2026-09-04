// gymMode.js — the pure logic behind Gym Mode.
//
// Gym Mode is the "one thumb, chalk on your fingers" layer over the session
// runners: big targets, quick load changes that respect the iron you actually
// have, and rest timers that manage themselves. This module holds the pure
// decisions so the components stay declarative and the behaviour is testable:
//
//   - quickJumps: the equipment-aware quick-add buttons for the load field
//     (barbells jump by plates, dumbbells by their real gaps, machines by
//     their pin increment — never an impossible number).
//   - restPresets: per-exercise rest countdowns, remembered and adjustable.
//   - skipTo: "where was chest press in this session?" for instant navigation.

import { nearestAchievableLoad, minimumAchievableJump, DEFAULT_PLATE_DENOMINATIONS_KG, DEFAULT_DUMBBELL_WEIGHTS_KG, DEFAULT_MACHINE_INCREMENT_KG } from './plates.js';

// The smallest real jump for a piece of equipment, derived from the plate /
// dumbbell / machine-pin configuration (falling back to the defaults). Every
// quick-add button is a multiple of this, so no button can propose a load the
// kit cannot produce.
export function equipmentIncrement({ equipment = 'barbell', config = null } = {}){
  const equip = String(equipment || '').toLowerCase();
  if(equip.includes('dumbbell')){
    const weights = (config?.dumbbellsKg?.length ? config.dumbbellsKg : DEFAULT_DUMBBELL_WEIGHTS_KG).slice().sort((a,b)=> a-b);
    const gaps = weights.slice(1).map((w,i)=> w - weights[i]);
    return gaps.length ? Math.min(...gaps) : 2.5;
  }
  if(equip.includes('machine') || equip.includes('cable')) return Number(config?.machineIncrementKg) || DEFAULT_MACHINE_INCREMENT_KG;
  const plates = (config?.platesKg?.length ? config.platesKg : DEFAULT_PLATE_DENOMINATIONS_KG).slice().sort((a,b)=> a-b);
  return plates.length ? plates[0] * 2 : 2.5; // per-side smallest plate → total jump
}

// Quick-add buttons for the load field: one and two increments up/down,
// labelled with the actual kilos. Equipment-aware by construction.
export function quickJumps({ equipment = [], supportsWeighted = true, config = null } = {}){
  if(!supportsWeighted) return [];
  const inc = equipmentIncrement({ equipment: equipment?.[0] || 'barbell', config });
  const fmt = (n)=> Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
  return [
    { id: 'down2', label: `−${fmt(inc * 2)}`, delta: -inc * 2 },
    { id: 'down', label: `−${fmt(inc)}`, delta: -inc },
    { id: 'up', label: `+${fmt(inc)}`, delta: inc },
    { id: 'up2', label: `+${fmt(inc * 2)}`, delta: inc * 2 },
  ];
}

// Apply a quick jump: move by the delta, then snap to the nearest load the
// equipment can actually produce. Falls back to the un-snapped value if the
// snap helpers have no answer (unknown kit).
export function applyQuickJump(currentKg, jump, { equipment = 'barbell', config = null } = {}){
  const current = Number(currentKg) || 0;
  const raw = Math.max(0, current + jump.delta);
  try{
    // nearestAchievableLoad returns a result object ({ loadKg, exact, … }),
    // not a number — read .loadKg, never Number(result).
    const snapped = nearestAchievableLoad(raw, { equipment, config: config || {} });
    const snappedKg = snapped ? Number(snapped.loadKg) : NaN;
    if(Number.isFinite(snappedKg) && snappedKg > 0) return String(Math.round(snappedKg * 100) / 100);
  }catch{}
  return String(Math.round(raw * 100) / 100);
}

// Next/previous achievable load relative to the current one — used by the
// load stepper around the numpad. The increment is only a starting point: the
// step lands on a load the configured kit can actually produce, stepping
// further when the first candidate is impossible. Going down never dips below
// the lightest producible load (you can't unload the bar), so at the floor the
// stepper holds still.
export function adjacentLoad(currentKg, direction, { equipment = 'barbell', config = null } = {}){
  const current = Number(currentKg) || 0;
  const inc = equipmentIncrement({ equipment, config }) || 2.5;
  const up = direction >= 0;
  if(current <= 0) return up ? String(inc) : '0';
  try{
    let raw = up ? current + inc : current - inc;
    for(let i = 0; i < 60; i++){
      if(raw <= 0){
        // Below everything the kit can produce: hold at the current load
        // (the empty bar is as light as a barbell gets).
        return String(Math.round(current * 100) / 100);
      }
      const snapped = nearestAchievableLoad(raw, { equipment, config: config || {} });
      const snappedKg = snapped ? Number(snapped.loadKg) : NaN;
      if(Number.isFinite(snappedKg) && snappedKg > 0 && (up ? snappedKg > current : snappedKg < current)){
        return String(Math.round(snappedKg * 100) / 100);
      }
      raw = up ? raw + inc : raw - inc;
    }
  }catch{}
  return String(Math.round((up ? current + inc : current) * 100) / 100);
}

// ── Rest presets ────────────────────────────────────────────────────────────
// Remembered per exercise (e.g. 90s after squats, 60s after curls) so each
// block's rest button starts the countdown the user actually wants, not the
// programme's guess.

export const REST_PRESET_CHOICES = [45, 60, 90, 120, 180, 240];

export function defaultRestPreset(restSec){
  const sec = Number(restSec) || 0;
  if(sec <= 0) return null;
  return REST_PRESET_CHOICES.reduce((best, choice)=> Math.abs(choice - sec) < Math.abs(best - sec) ? choice : best, REST_PRESET_CHOICES[0]);
}

export function restPresetFor(gymPrefs, exerciseId, fallbackSec){
  const stored = Number(gymPrefs?.restPresets?.[exerciseId]);
  if(Number.isFinite(stored) && stored > 0) return stored;
  return defaultRestPreset(fallbackSec);
}

export function setRestPreset(gymPrefs, exerciseId, seconds){
  const sec = Math.max(0, Math.round(Number(seconds) || 0));
  const next = { ...(gymPrefs?.restPresets || {}) };
  if(sec <= 0) delete next[exerciseId];
  else next[exerciseId] = sec;
  return next;
}

// ── Skip-to navigation ──────────────────────────────────────────────────────
// One tap to jump to the first unfinished set of a named exercise — for when
// you come back from a water refill and want straight back to the rack.

export function skipTo(blocks, query){
  const q = String(query || '').trim().toLowerCase();
  if(!q) return null;
  for(let bi = 0; bi < blocks.length; bi++){
    const block = blocks[bi];
    if(!block) continue;
    const nameHit = String(block.name || '').toLowerCase().includes(q);
    const idHit = String(block.exerciseId || '').toLowerCase().includes(q);
    if(!nameHit && !idHit) continue;
    const si = block.sets.findIndex(s=> !s.completed && !s.skipped);
    return { blockIndex: bi, setIndex: si === -1 ? Math.max(0, block.sets.length - 1) : si };
  }
  return null;
}

// ── Session quality ─────────────────────────────────────────────────────────
// A one-tap rating captured at save time. Values are stable ids, not text, so
// analytics can group them and history can render them without parsing.
export const SESSION_QUALITY_OPTIONS = [
  { id: 'great', label: 'Great', emoji: '🔥', weight: 3 },
  { id: 'good', label: 'Good', emoji: '👍', weight: 2 },
  { id: 'ok', label: 'OK', emoji: '👌', weight: 1 },
  { id: 'rough', label: 'Rough', emoji: '😵', weight: 0 },
];

export function sessionQualityLabel(id){
  return SESSION_QUALITY_OPTIONS.find(o=> o.id === id)?.label || null;
}
