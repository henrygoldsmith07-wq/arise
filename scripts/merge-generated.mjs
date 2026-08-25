// scripts/merge-generated-exercises.mjs
// Merges generated-exercises.txt into data.js, applies reciprocal back-links,
// dedupes, and validates. Run after generate-all-exercises.mjs.

import fs from 'node:fs';

const f='src/lib/data.js';
let s=fs.readFileSync(f,'utf8');

// 1) Read generated entries
const gen=fs.readFileSync('scripts/generated-exercises.txt','utf8');
if(!gen.trim()){ console.log('No generated exercises to merge.'); process.exit(0); }

// 2) Insert before the closing ]; of EXERCISES (last occurrence before EXERCISE_BY_ID)
const anchor='\nexport const EXERCISE_BY_ID';
const insert='\n'+gen+'\n';
s=s.replace(anchor, insert+anchor);

// 3) Apply reciprocal back-links to existing exercises
const bl=JSON.parse(fs.readFileSync('scripts/generated-backlinks.json','utf8'));
for(const {partner,newId} of bl){
  const re=new RegExp("(id: '"+partner+"',[^\\n]*substitution: \\[[^\\]]*)\\]");
  if(re.test(s)){
    s=s.replace(re, (m)=> m.slice(0,-1)+",'"+newId+"']");
  }
}

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
console.log('Merged. Running lint...');

// 5) Validate via child process
const { execSync } = await import('node:child_process');
try{
  execSync('node scripts/lint-content.mjs', { stdio:'pipe' });
  console.log('Lint OK ✓');
}catch(e){
  const output=e.stderr?.toString() || e.stdout?.toString() || '';
  const errors=output.split('\n').filter(l=>l.startsWith(' -')).slice(0,20);
  console.log(`Lint FAILED with ${errors.length} errors:`);
  errors.forEach(e=>console.log(e));
}
