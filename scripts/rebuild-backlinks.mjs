// scripts/rebuild-backlinks.mjs
// Regenerates scripts/generated-backlinks.json with every edge needed to make
// substitutions reciprocal after the merge:
//   - normal edges: generated entry E lists S  ->  S must list E
//   - redirect edges: E listed dropped-id D, redirected to curated T
//     ->  T must list E (otherwise T↔E becomes one-way)
// merge-generated.mjs applies these after insertion.

import fs from 'node:fs';

const gen = fs.readFileSync('scripts/generated-exercises.txt', 'utf8');
let redirects = [];
try{ redirects = JSON.parse(fs.readFileSync('scripts/generated-name-redirects.json', 'utf8')); }catch{}
const fromMap = new Map(redirects.map(r => [r.from, r.to]));

const edges = [];
const seen = new Set();
const push = (partner, newId)=>{
  if(partner === newId) return;
  const key = partner + '|' + newId;
  if(seen.has(key)) return;
  seen.add(key);
  edges.push({ partner, newId });
};

for(const m of gen.matchAll(/id:\s*'([^']+)'[\s\S]*?substitution:\s*\[([^\]]*)\]/g)){
  const newId = m[1];
  for(const t of m[2].matchAll(/'([^']+)'/g)){
    const target = t[1];
    if(target === newId) continue;
    push(target, newId);                                    // S must list E
    if(fromMap.has(target)) push(fromMap.get(target), newId); // redirected target must list E too
  }
}

fs.writeFileSync('scripts/generated-backlinks.json', JSON.stringify(edges, null, 2));
console.log(`Backlinks rebuilt: ${edges.length}`);
