// scripts/dedupe-generated-names.mjs
// Drops generated entries whose display NAME duplicates an existing curated
// exercise (curated wins — it carries history semantics) and records a
// REDIRECT (droppedId -> keptId) so merge-generated.mjs can rewrite every
// substitution reference to the dropped id. Run BEFORE rebuild-backlinks and
// merge-generated.mjs. Idempotent against pristine data.js.

import fs from 'node:fs';

const src = fs.readFileSync('src/lib/data.js', 'utf8');
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// Existing curated entries: capture id AND name per line.
const existingById = new Map(), nameToId = new Map();
for(const line of src.split('\n')){
  const idM = line.match(/id:\s*'([^']+)'/);
  const nameM = line.match(/name:\s*'([^']+)'/);
  if(idM && nameM && !existingById.has(idM[1])){
    existingById.set(idM[1], norm(nameM[1]));
    if(!nameToId.has(norm(nameM[1]))) nameToId.set(norm(nameM[1]), idM[1]);
  }
}
const existingNames = new Set(nameToId.keys());

const path = 'scripts/generated-exercises.txt';
const lines = fs.readFileSync(path, 'utf8').split('\n');
const kept = [], redirects = [], droppedList = [], seenInGen = new Set();
let keptCount = 0;

for(const line of lines){
  const idM = line.match(/id:\s*'([^']+)'/);
  const nameM = line.match(/name:\s*'([^']+)'/);
  if(!idM || !nameM){ kept.push(line); continue; }
  const n = norm(nameM[1]);
  if(existingNames.has(n)){
    // Duplicate of a curated lift — drop the generated copy, redirect to it.
    redirects.push({ from: idM[1], to: nameToId.get(n) });
    droppedList.push(`${nameM[1]} (${idM[1]})`);
    continue;
  }
  if(seenInGen.has(n)){ droppedList.push(`${nameM[1]} (${idM[1]})`); continue; }
  seenInGen.add(n);
  keptCount++;
  kept.push(line);
}

fs.writeFileSync(path, kept.join('\n'));
fs.writeFileSync('scripts/generated-name-redirects.json', JSON.stringify(redirects, null, 2));
console.log(`Kept ${keptCount} generated entries · dropped ${redirects.length} curated-name duplicates`);
for(const d of droppedList) console.log(`  - ${d}`);
