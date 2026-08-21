// plates.js — deterministic loadability helpers for barbell, dumbbell and machine work.
// Plate denominations are treated as available pairs. The calculator never
// invents a load: it returns the nearest achievable total and the per-side
// stack (barbell) or single increment (dumbbell/machine) used to get there.

export const DEFAULT_PLATE_DENOMINATIONS_KG = [1.25, 2.5, 5, 10, 15, 20, 25];
export const DEFAULT_DUMBBELL_WEIGHTS_KG = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22.5, 25, 27.5, 30];
export const DEFAULT_MACHINE_INCREMENT_KG = 2.5;

const SCALE = 100;

function units(value){
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * SCALE) : 0;
}

function normaliseConfig(config = {}){
  const input = config || {};
  const barWeightKg = Math.max(0, Number(input.barWeightKg ?? 20) || 0);
  const source = Array.isArray(input.platesKg) ? input.platesKg : DEFAULT_PLATE_DENOMINATIONS_KG;
  const platesKg = [...new Set(source.map(value=> Number(typeof value === 'object' ? value.kg : value))
    .filter(value=> Number.isFinite(value) && value > 0)
    .map(value=> Math.round(value * SCALE) / SCALE))].sort((a, b)=> a - b);
  const dumbbellSource = Array.isArray(input.dumbbellsKg) ? input.dumbbellsKg : (Array.isArray(input.dumbbellWeightsKg) ? input.dumbbellWeightsKg : DEFAULT_DUMBBELL_WEIGHTS_KG);
  const dumbbellsKg = [...new Set(dumbbellSource.map(value=> Number(value))
    .filter(value=> Number.isFinite(value) && value > 0)
    .map(value=> Math.round(value * SCALE) / SCALE))].sort((a, b)=> a - b);
  const machineIncrementKg = Number.isFinite(Number(input.machineIncrementKg)) ? Math.round(Number(input.machineIncrementKg) * SCALE) / SCALE : DEFAULT_MACHINE_INCREMENT_KG;
  const machineMinKg = Number.isFinite(Number(input.machineMinKg)) ? Number(input.machineMinKg) : 5;
  const machineMaxKg = Number.isFinite(Number(input.machineMaxKg)) ? Number(input.machineMaxKg) : 120;
  return { barWeightKg, platesKg, dumbbellsKg, machineIncrementKg, machineMinKg, machineMaxKg };
}

function betterStack(candidate, current){
  if(!current) return candidate;
  if(candidate.length !== current.length) return candidate.length < current.length ? candidate : current;
  // Stable tie-break: use the heavier plates first so the display is easy to
  // scan and the result does not depend on input ordering.
  const a = candidate.slice().sort((x, y)=> y - x);
  const b = current.slice().sort((x, y)=> y - x);
  for(let i = 0; i < a.length; i++) if(a[i] !== b[i]) return a[i] > b[i] ? candidate : current;
  return current;
}

function buildStacks(plateUnits, maxUnits){
  const best = Array(maxUnits + 1).fill(null);
  best[0] = [];
  for(let total = 1; total <= maxUnits; total++){
    for(const plate of plateUnits){
      if(total < plate || !best[total - plate]) continue;
      const candidate = [...best[total - plate], plate / SCALE];
      best[total] = betterStack(candidate, best[total]);
    }
  }
  return best;
}

export function nearestLoadToPlates(targetKg, config = {}){
  const target = Number(targetKg);
  if(!Number.isFinite(target) || target < 0) return null;
  const { barWeightKg, platesKg } = normaliseConfig(config);
  const targetPerSideKg = Math.max(0, (target - barWeightKg) / 2);
  const targetPerSideUnits = Math.round(targetPerSideKg * SCALE);
  const plateUnits = platesKg.map(units).filter(Boolean);
  const largest = Math.max(0, ...plateUnits);
  // One extra largest plate beyond the target is enough to resolve the
  // nearest overshoot while keeping the dynamic programme bounded.
  const maxUnits = Math.max(targetPerSideUnits, largest) + largest;
  const stacks = buildStacks(plateUnits, maxUnits);

  let bestUnits = 0;
  let bestError = Math.abs(targetPerSideUnits);
  for(let total = 1; total <= maxUnits; total++){
    const stack = stacks[total];
    if(!stack) continue;
    const error = Math.abs(total - targetPerSideUnits);
    if(error < bestError || (error === bestError && total < bestUnits)){
      bestUnits = total;
      bestError = error;
    }
  }
  const bestStack = bestUnits ? stacks[bestUnits] || [] : [];
  const loadKg = Math.round((barWeightKg + (bestUnits / SCALE) * 2) * SCALE) / SCALE;
  const deltaKg = Math.round((loadKg - target) * SCALE) / SCALE;
  return {
    targetKg: Math.round(target * SCALE) / SCALE,
    loadKg,
    deltaKg,
    exact: deltaKg === 0,
    direction: deltaKg === 0 ? 'exact' : deltaKg > 0 ? 'over' : 'under',
    barWeightKg,
    platesPerSide: bestStack.slice().sort((a, b)=> b - a),
    platesKg,
  };
}

export function nearestDumbbellLoad(targetKg, config = {}){
  const target = Number(targetKg);
  if(!Number.isFinite(target) || target < 0) return null;
  const { dumbbellsKg } = normaliseConfig(config);
  if(!dumbbellsKg.length) return null;
  let best = dumbbellsKg[0];
  let bestError = Math.abs(best - target);
  for(const weight of dumbbellsKg){
    const error = Math.abs(weight - target);
    if(error < bestError || (error === bestError && weight < best)){
      best = weight;
      bestError = error;
    }
  }
  const deltaKg = Math.round((best - target) * SCALE) / SCALE;
  return {
    targetKg: Math.round(target * SCALE) / SCALE,
    loadKg: best,
    deltaKg,
    exact: deltaKg === 0,
    direction: deltaKg === 0 ? 'exact' : deltaKg > 0 ? 'over' : 'under',
    dumbbellsKg,
  };
}

export function nearestMachineLoad(targetKg, config = {}){
  const target = Number(targetKg);
  if(!Number.isFinite(target) || target < 0) return null;
  const { machineIncrementKg, machineMinKg, machineMaxKg } = normaliseConfig(config);
  const step = Math.max(0.5, machineIncrementKg);
  const clamped = Math.max(machineMinKg, Math.min(machineMaxKg, target));
  const steps = Math.round((clamped - machineMinKg) / step);
  const loadKg = Math.round((machineMinKg + steps * step) * SCALE) / SCALE;
  const deltaKg = Math.round((loadKg - target) * SCALE) / SCALE;
  if(loadKg < machineMinKg || loadKg > machineMaxKg) return null;
  return {
    targetKg: Math.round(target * SCALE) / SCALE,
    loadKg,
    deltaKg,
    exact: deltaKg === 0,
    direction: deltaKg === 0 ? 'exact' : deltaKg > 0 ? 'over' : 'under',
    machineIncrementKg: step,
    machineMinKg,
    machineMaxKg,
  };
}

export function nearestAchievableLoad(targetKg, { equipment = 'barbell', config = {} } = {}){
  const equip = String(equipment || '').toLowerCase();
  if(equip.includes('dumbbell')) return nearestDumbbellLoad(targetKg, config);
  if(equip.includes('machine') || equip.includes('cable')) return nearestMachineLoad(targetKg, config);
  return nearestLoadToPlates(targetKg, config);
}

export function minimumAchievableJump(currentKg, { equipment = 'barbell', config = {} } = {}){
  const current = Number(currentKg) || 0;
  const equip = String(equipment || '').toLowerCase();
  const normalised = normaliseConfig(config);
  if(equip.includes('dumbbell')){
    const sorted = normalised.dumbbellsKg;
    if(!sorted.length) return null;
    const next = sorted.find(w=> w > current);
    if(next == null) return null;
    const prevIdx = sorted.findIndex(w=> w > current) - 1;
    const prev = prevIdx >= 0 ? sorted[prevIdx] : current;
    const jumps = sorted.slice(1).map((w,i)=> w - sorted[i]);
    const minJump = jumps.length ? Math.min(...jumps) : null;
    return { nextLoadKg: next, jumpKg: Math.round((next - Math.max(prev, current)) * SCALE) / SCALE, minimumJumpKg: minJump != null ? Math.round(minJump*SCALE)/SCALE : null };
  }
  if(equip.includes('machine') || equip.includes('cable')){
    const step = normalised.machineIncrementKg;
    return { nextLoadKg: Math.round((current + step)*SCALE)/SCALE, jumpKg: step, minimumJumpKg: step };
  }
  // barbell: smallest per-side plate determines total jump (×2)
  const smallestPlate = normalised.platesKg[0];
  if(!smallestPlate) return null;
  const jumpKg = Math.round(smallestPlate * 2 * SCALE)/SCALE;
  return { nextLoadKg: Math.round((current + jumpKg)*SCALE)/SCALE, jumpKg, minimumJumpKg: jumpKg };
}

export function isLoadAchievable(targetKg, equipment, config){
  const result = nearestAchievableLoad(targetKg, { equipment, config });
  return !!(result && result.exact);
}

export function formatPlateStack(stack = []){
  return stack.length ? stack.map(value=> `${value}kg`).join(' + ') : 'no plates';
}
