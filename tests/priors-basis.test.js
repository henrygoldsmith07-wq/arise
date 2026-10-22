// priors-basis.test.js — item 5 acceptance: every numeric constant block in
// DEFAULT_ARISE_PRIORS carries a `basis` note naming its source and
// uncertainty. A new constant block without one fails this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ARISE_PRIORS } from '../src/lib/priors.js';

const NUMERIC_LIKE = (v)=> typeof v === 'number' || (typeof v === 'string' && /\d/.test(v));

// A "constant block" is a config object: a plain object whose own values are
// mostly scalars/arrays (not nested config objects). Leaf data (strategy
// entries like { repRange, incPct, prefer }, weight maps, band tables) inherit
// their parent block's basis note instead of needing their own.
function isConfigBlock(obj){
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const entries = Object.entries(obj).filter(([k])=> k !== 'basis' && k !== 'version');
  if(!entries.length) return false;
  const childObjects = entries.filter(([, v])=> v && typeof v === 'object' && !Array.isArray(v));
  // A config block holds mostly scalars; leaf-data nodes hold mostly objects
  // or are flat value maps (all scalars, no basis-worthy decision of their own
  // beyond the parent's). Require at least one scalar AND at least one child
  // object — i.e. a real section with subsections — or the top-level sections.
  const scalars = entries.filter(([, v])=> NUMERIC_LIKE(v) || typeof v === 'boolean' || typeof v === 'string');
  return scalars.length > 0 && childObjects.length > 0;
}

function constantBlocks(obj, path = []){
  const out = [];
  if(!obj || typeof obj !== 'object' || Array.isArray(obj)) return out;
  if(path.length && isConfigBlock(obj)) out.push({ path: path.join('.'), node: obj });
  for(const [k, v] of Object.entries(obj)){
    if(v && typeof v === 'object' && !Array.isArray(v)) out.push(...constantBlocks(v, [...path, k]));
  }
  return out;
}

// Top-level sections always need a basis note.
const TOP_LEVEL = ['progression', 'sessionQuality', 'recovery', 'readinessClassifier', 'programming', 'experiments', 'workoutQuality', 'longitudinal', 'calibration', 'progressionModel', 'backtest'];

test('every constant block in DEFAULT_ARISE_PRIORS carries a basis note', ()=>{
  const blocks = constantBlocks(DEFAULT_ARISE_PRIORS);
  assert.ok(blocks.length > 5, `expected several constant blocks, found ${blocks.length}`);
  const missing = blocks.filter(({ node })=> typeof node.basis !== 'string' || node.basis.trim().length < 20);
  const missingTop = TOP_LEVEL.filter((k)=>{
    const node = DEFAULT_ARISE_PRIORS[k];
    return !node || typeof node.basis !== 'string' || node.basis.trim().length < 20;
  });
  assert.deepEqual([...missing.map(m=> m.path), ...missingTop.map(t=> `${t} (top-level)`)], [], `constant blocks without a basis note`);
});

test('strategy basis names ACSM March 2026 adherence finding', ()=>{
  const basis = DEFAULT_ARISE_PRIORS.progression.strategies.basis || '';
  assert.match(basis, /ACSM/i, 'strategies basis should cite the ACSM position stand');
  assert.match(basis, /adherence/i, 'strategies basis should note that adherence dominates');
});
