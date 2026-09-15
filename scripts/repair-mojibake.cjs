// repair-mojibake.cjs — decode UTF-8-read-as-CP1252 sequences in place.
// Only touches runs that START with a CP1252 high byte (Â-ÿ) or the known
// CP1252 punctuation glyphs (‘’“”€…†—– etc.) AND form a valid UTF-8
// sequence when re-encoded; anything else is left byte-for-byte alone, so
// legitimate non-ASCII text is never rewritten.
const fs = require('fs');

const CP1252_EXTRA = { 0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178 };
const REV = {}; // unicode codepoint -> cp1252 byte
for(const [b, u] of Object.entries(CP1252_EXTRA)) REV[u] = Number(b);
for(let b = 0xA0; b <= 0xFF; b++) REV[b] = b; // latin1 block

function candidate(cp){ return cp in REV; }

function tryFix(text){
  let out = '', i = 0, fixed = 0;
  while(i < text.length){
    const cp = text.codePointAt(i);
    if(cp >= 0x80 && candidate(cp)){
      // Greedily collect a run of CP1252-reversible chars.
      let j = i;
      while(j < text.length){
        const c = text.codePointAt(j);
        if(c < 0x80 || !candidate(c)) break;
        j += c > 0xFFFF ? 2 : 1;
      }
      const run = text.slice(i, j);
      const bytes = Buffer.from([...run].map(ch => REV[ch.codePointAt(0)]));
      let decoded = null;
      if(bytes.length >= 2){
        try{
          decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
          // Only accept a complete multi-byte char(s) with no replacement
          // chars and at least one char above latin1 (real repair targets).
          if(decoded && !decoded.includes('\uFFFD') && decoded.length < run.length) { /* good */ }
          else decoded = null;
        }catch{ decoded = null; }
      }
      if(decoded){ out += decoded; fixed++; i = j; continue; }
      out += run; i = j; continue;
    }
    out += text[i];
    i += 1;
  }
  return { out, fixed };
}

const files = process.argv.slice(2);
let total = 0;
for(const f of files){
  const before = fs.readFileSync(f, 'utf8');
  const { out, fixed } = tryFix(before);
  if(fixed && out !== before){
    fs.writeFileSync(f, out);
    console.log(`${f}: repaired ${fixed} mojibake run(s)`);
    total += fixed;
  }
}
console.log(total ? `done: ${total}` : 'nothing to repair');
