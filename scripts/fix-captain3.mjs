import fs from 'node:fs';
const f='src/lib/data.js';
let raw=fs.readFileSync(f,'utf8');
const lines=raw.split('\n');
const i=280;
if(!lines[i] || !lines[i].includes('captains-chair-knee-raise')){
  console.log('Line 281 does not contain captains-chair-knee-raise, actual:', lines[i]?.slice(0,60));
  process.exit(1);
}
const start = lines[i].indexOf('name:');
const end = lines[i].indexOf(', muscle:', start);
if(start < 0 || end < 0){ console.log('Could not find boundaries'); process.exit(1); }
const BS = String.fromCharCode(92);
const SQ = String.fromCharCode(39);
const cleanName = `name: 'Captain${BS}${SQ}s Chair Knee Raise'`;
lines[i] = lines[i].substring(0, start) + cleanName + lines[i].substring(end);
fs.writeFileSync(f, lines.join('\n'));
console.log('FIXED line', i+1);
