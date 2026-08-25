// scripts/merge-generated-exercises.mjs
// Merges generated-exercises.txt into data.js, applies reciprocal back-links,
// dedupes, and validates. Run after generate-all-exercises.mjs.

import fs from 'node:fs';

const f='src/lib/data.js';
let s=fs.readFileSync(f,'utf8');

// 1) Read generated entries
let gen=fs.readFileSync('scripts/generated-exercises.txt','utf8');
if(!gen.trim()){ console.log('No generated exercises to merge.'); process.exit(0); }

// 2) Insert INSIDE the EXERCISES array, before its closing "];".
// (The previous anchor — "export const EXERCISE_BY_ID" — sat OUTSIDE the
// array, producing bare object literals at module level: SyntaxError.)
const startMarker = 'export const EXERCISES = [';
const startIdx = s.indexOf(startMarker);
if(startIdx === -1){ console.error('EXERCISES array not found in data.js'); process.exit(1); }
const closeIdx = s.indexOf('\n];', startIdx);
if(closeIdx === -1){ console.error('EXERCISES closing bracket not found'); process.exit(1); }
const insert='\n'+gen.trimEnd()+'\n';
s=s.slice(0, closeIdx)+insert+s.slice(closeIdx);

// 2b) Redirect substitution references to entries dropped as name-duplicates.
// imageSlug fields keep the original package slug (illustrations stay valid);
// only substitution arrays are rewritten, in BOTH the generated text and —
// after insertion — curated data.js lines that pointed at a dropped id.
let redirects = [];
try{ redirects = JSON.parse(fs.readFileSync('scripts/generated-name-redirects.json', 'utf8')); }catch{}
const redirectSubs = text => {
  let out = text;
  for(const { from, to } of redirects){
    out = out.replace(/substitution:\s*\[([^\]]*)\]/g, (full, items)=>
      'substitution: [' + items.split(',').map(x => x.trim() === `'${from}'` ? `'${to}'` : x.trim()).filter(Boolean).join(', ') + ']');
  }
  return out;
};
gen = redirectSubs(gen);
s = redirectSubs(s);

// 3) Apply reciprocal back-links to existing exercises.
// Tolerant to both authoring styles in data.js ("id: 'x'," and "id:'x',").
const bl=JSON.parse(fs.readFileSync('scripts/generated-backlinks.json','utf8'));
let applied=0;
for(const {partner,newId} of bl){
  const re=new RegExp("(id:\\s*'"+partner+"',[^\\n]*substitution:\\s*\\[[^\\]]*)\\]");
  if(re.test(s)){
    s=s.replace(re, (m)=> m.slice(0,-1)+",'"+newId+"']");
    applied++;
  }
}
console.log(`Backlinks applied: ${applied}/${bl.length}`);

// 4) Deduplicate any substitution arrays that got double-pushed
// (simple pass: for each line with substitution:, dedupe quoted items)
const lines=s.split('\n');
for(let i=0;i<lines.length;i++){
  const m=lines[i].match(/substitution: \[([^\]]+)\]/);
  if(!m) continue;
  const items=m[1].split(',').map(x=>x.trim());
  const seen=new Set(); const deduped=[];
  for(const item of items){
    if(!seen.has(item)){ seen.add(item); deduped.push(item); }
  }
  if(deduped.length!==items.length){
    lines[i]=lines[i].replace(m[1], deduped.join(', '));
  }
}
s=lines.join('\n');

fs.writeFileSync(f,s);
console.log('Merged. Repairing generated apostrophes...');

// 4b) Generated names can contain raw apostrophes (e.g. "Captain's Chair")
// inside single-quoted strings. fix-apostrophes escapes them in place.
const { execSync: exec1 } = await import('node:child_process');
try{
  exec1('node scripts/fix-apostrophes.mjs', { stdio:'pipe' });
}catch(e){
  console.error('fix-apostrophes failed:', e.stderr?.toString() || e.message);
  process.exit(1);
}

console.log('Running lint...');

// 5) Validate via child process — lint MUST pass or the merge is rejected.
const { execSync } = await import('node:child_process');
try{
  execSync('node scripts/lint-content.mjs', { stdio:'pipe' });
  console.log('Lint OK ✓');
}catch(e){
  const output=e.stderr?.toString() || e.stdout?.toString() || '';
  console.error('Lint FAILED after merge:');
  console.error(output.split('\n').slice(0, 25).join('\n'));
  process.exit(1);
}
