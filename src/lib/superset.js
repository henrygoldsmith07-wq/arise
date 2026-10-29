// superset.js — the superset (paired-exercise) model, shared by the
// programme editor, the session runner / Gym Mode and the duration estimate.
//
// A pair is positional: block i carries `supersetWith: <exerciseId of block
// i+1>`. Pairs only (no tri-sets): the second half of a pair cannot pair
// again. Any pairing that no longer points at its immediate neighbour (after
// a move, remove or swap) is dropped, so a stale pair never reaches the
// runner. Gym Mode alternates A1 → B1 → rest → A2 → B2 → rest, with ONE rest
// after each round: the longer of the two exercises' rests.

export function normalisePairs(blocks){
  const out = (blocks || []).map(b=> ({ ...b }));
  for(let i = 0; i < out.length; i++){
    const want = out[i].supersetWith;
    if(want === undefined) continue;
    const ok = typeof want === 'string' && out[i + 1]?.exerciseId === want && !(i > 0 && out[i - 1].supersetWith === out[i].exerciseId);
    if(!ok) delete out[i].supersetWith;
  }
  return out;
}

export function supersetPartner(blocks, index){
  const b = blocks?.[index];
  if(!b) return null;
  if(b.supersetWith && blocks[index + 1]?.exerciseId === b.supersetWith) return index + 1;
  const prev = blocks[index - 1];
  if(prev?.supersetWith && prev.supersetWith === b.exerciseId && !(index > 1 && blocks[index - 2]?.supersetWith === prev.exerciseId)) return index - 1;
  return null;
}

// What happens after a set in block `index` is completed (`blocks` already
// reflects that completion):
//   { focus: partnerIndex, rest: 'none' }  first half of a round → go to B, no rest
//   { focus: partnerIndex, rest: 'pair' }  round finished → one pair rest, back to A
//   { focus: null, rest: 'own' }           straight set, or the partner is done
export function supersetStep(blocks, index){
  const partner = supersetPartner(blocks, index);
  const open = (b)=> (b?.sets || []).some(s=> !s.completed && !s.failed);
  if(partner == null || !open(blocks[partner])) return { focus: null, rest: 'own' };
  return { focus: partner, rest: partner > index ? 'none' : 'pair' };
}

// One rest after a pair: the longer of the two prescribed rests.
export function pairRestSec(a, b){
  return Math.max(Number(a) || 0, Number(b) || 0);
}
