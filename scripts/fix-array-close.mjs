import fs from 'node:fs';
const f='src/lib/data.js';
let s=fs.readFileSync(f,'utf8');
const lines=s.split('\n');

// Find the premature ]; that closes EXERCISES too early (right before first generated entry)
// and the real end of generated entries, then move ];

// Find line 155 (0-indexed 154): "];" right before generated block starts
let earlyClose = -1;
for(let i=0;i<lines.length;i++){
  if(lines[i].trim()==='];' && lines[i+1]?.trim()==='' && lines[i+2]?.trim().startsWith('{ id:')){
    earlyClose = i; break;
  }
}
if(earlyClose === -1){
  // try without blank line
  for(let i=0;i<lines.length;i++){
    if(lines[i].trim()==='];' && lines[i+1]?.trim().startsWith('{ id:') && lines[i-1]?.includes('barbell-side-bend')){
      earlyClose = i; break;
    }
  }
}

if(earlyClose >= 0){
  console.log(`Found premature ]; at line ${earlyClose+1}, removing it`);
  lines.splice(earlyClose, 1);
}else{
  console.log('No premature ]; found — looking for it differently...');
}

// Now find where generated entries end: look for export const EXERCISE_BY_ID
let exByIdLine = -1;
for(let i=0;i<lines.length;i++){
  if(lines[i].includes('export const EXERCISE_BY_ID')){ exByIdLine = i; break; }
}
if(exByIdLine > 0){
  // Insert ]; before the blank line preceding export
  let insertAt = exByIdLine;
  while(insertAt > 0 && lines[insertAt-1].trim()==='') insertAt--;
  lines.splice(insertAt, 0, '];');
  console.log(`Inserted ]; at line ${insertAt+1} (before export const EXERCISE_BY_ID)`);
}

s = lines.join('\n');
fs.writeFileSync(f, s);
console.log('Fixed. Running lint...');

try{
  require('node:child_process').execSync('node scripts/lint-content.mjs', {stdio:'pipe'});
  console.log('Lint OK ✓');
}catch(e){
  const out=(e.stderr||e.stdout||'').toString();
  const errs=out.split('\n').filter(l=>l.trim().startsWith('-')).slice(0,15);
  console.log(`Lint FAILED:`);
  errs.forEach(e=>console.log(e));
}
