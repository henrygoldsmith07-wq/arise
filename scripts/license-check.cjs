#!/usr/bin/env node
// scripts/license-check.cjs — production license allowlist.
//
// The bundle ships to end users, so every production dependency's license
// must be on the allowlist below. Dev-only tooling never reaches users and
// is out of scope (npm audit handles its supply-chain risk).
//
// Adding a dependency with a license not on the list? Consciously extend the
// allowlist in review — never by deleting this check.
const { execSync } = require('node:child_process');
const fs = require('node:fs');

const ALLOW = new Set([
  'MIT', 'MIT*', 'MIT OR Apache-2.0', 'MIT License',
  'ISC', 'ISC License',
  'Apache-2.0', 'Apache 2.0', 'Apache License, Version 2.0',
  'BSD-2-Clause', 'BSD-3-Clause', 'BSD',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'WTFPL', // only acceptable because nothing user-visible depends on it; flag in review if it grows
  '(MIT OR Apache-2.0)', '(MIT OR CC0-1.0)', '(WTFPL OR MIT)',
  'BlueOak-1.0.0', // npm's own bundled license for some tooling
]);

function main(){
  let raw;
  try{
    raw = execSync('npm ls --omit=dev --all --json --long', { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  }catch(err){
    // npm ls exits non-zero on extraneous/invalid trees; the JSON still prints.
    raw = err.stdout || '';
    if(!raw){ console.error('license-check: could not read dependency tree'); process.exit(1); }
  }
  const tree = JSON.parse(raw);
  const bad = new Map();
  const seen = new Set();
  function walk(node, pathSoFar){
    for(const [name, info] of Object.entries(node.dependencies || {})){
      const id = `${name}@${info.version}`;
      if(seen.has(id)) continue;
      seen.add(id);
      const license = info.license || 'UNKNOWN';
      const ok = Array.isArray(license)
        ? license.some((l) => ALLOW.has(String(l).trim()))
        : String(license).split(/\s+OR\s+|\/|\(/).some((part) => ALLOW.has(part.trim().replace(/\)/g, ''))) || ALLOW.has(String(license).trim());
      if(!ok && !bad.has(id)) bad.set(id, { license: Array.isArray(license) ? license.join(' OR ') : license, requiredBy: pathSoFar });
      if(info.dependencies) walk(info, pathSoFar ? `${pathSoFar}>${name}` : name);
    }
  }
  walk(tree, '');

  // Override file for reviewed exceptions (name@version → reason).
  const overridePath = 'scripts/license-allowlist.json';
  if(fs.existsSync(overridePath)){
    for(const [id, reason] of Object.entries(JSON.parse(fs.readFileSync(overridePath, 'utf8')))){
      bad.delete(id);
      if(reason) console.error(`  allowance: ${id} — ${reason}`);
    }
  }

  if(bad.size){
    console.error(`\nlicense-check: ${bad.size} production package(s) outside the allowlist:\n`);
    for(const [id, { license, requiredBy }] of bad) console.error(`  ${id}  [${license}]  via ${requiredBy || 'direct'}`);
    console.error('\nExtend scripts/license-allowlist.json only with a reviewed reason.');
    process.exit(1);
  }
  console.log(`license-check: ${seen.size} production packages, all licenses allowlisted`);
}

main();
