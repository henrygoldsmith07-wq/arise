import fs from 'node:fs';
const f='src/lib/data.js';
const NL='\n';
let s=fs.readFileSync(f,'utf8');
const lines=s.split(NL);
let fixed=0;
for(let i=0;i<lines.length;i++){
  if(!lines[i].includes('imageSlug:')) continue;
  // Find name field boundaries
  const start=lines[i].indexOf("name: '");
  if(start<0) continue;
  const valStart=start+7; // after "name: '"
  // Walk forward to find the closing quote — it's followed by ", muscle:" or similar
  let valEnd=-1;
  for(let j=valStart;j<lines[i].length;j++){
    if(lines[i][j]==="'" && (lines[i].substring(j+1,j+9)===", muscle" || lines[i].substring(j+1,j+8)===", tags")){
      valEnd=j; break;
    }
    // Skip escaped quotes
    if(lines[i][j]==='\\') { j++; continue; }
  }
  if(valEnd<0) continue;
  // Extract the raw value and escape unescaped apostrophes
  let val=lines[i].substring(valStart,valEnd);
  let fixedVal='';
  for(let j=0;j<val.length;j++){
    if(val[j]==="'" && (j===0 || val[j-1]!=='\\')){
      fixedVal+="\\'";
      fixed++;
    } else {
      fixedVal+=val[j];
    }
  }
  if(fixedVal!==val){
    lines[i]=lines[i].substring(0,valStart)+fixedVal+lines[i].substring(valEnd);
  }
}
s=lines.join(NL);
fs.writeFileSync(f,s);
console.log(`Fixed ${fixed} apostrophes`);
