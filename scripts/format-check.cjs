#!/usr/bin/env node
// scripts/format-check.cjs — zero-config formatting gate.
//
// The repo has no prettier dependency and deliberately no formatter churn;
// what it does have is a house style that reviewers keep re-flagging when it
// slips. This gate enforces the objective subset — the things a grep can see
// and a human shouldn't have to:
//
//   - LF line endings only (CRLF is invisible on Windows and breaks greps)
//   - no tabs for indentation (2-space house style)
//   - no trailing whitespace
//   - exactly one trailing newline (clean diffs, POSIX tools happy)
//
// Scope: the source tree and CI config — not generated output, lockfiles,
// snapshots or binary assets. Fix is mechanical: `node scripts/format-check.cjs --fix`.

const fs = require('node:fs');
const path = require('node:path');

const ROOTS = ['src', 'tests', 'scripts', 'e2e', 'benchmark', '.github/workflows'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.bundle-diff', 'playwright-report', 'test-results', 'coverage', '__snapshots__']);
const SKIP_FILES = new Set(['package-lock.json']);
const ALLOW_BINARY = /\.(png|jpg|jpeg|gif|webp|ico|woff2?|zip|pdf)$/i;
const ALLOW_SNAPSHOT = /(__snapshots__|\.snap\b|expected-)/i;

function listFiles(dir, acc = []){
  for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
    if(entry.isDirectory()){
      if(!SKIP_DIRS.has(entry.name)) listFiles(path.join(dir, entry.name), acc);
    } else if(!SKIP_FILES.has(entry.name)){
      acc.push(path.join(dir, entry.name));
    }
  }
  return acc;
}

function main(){
  const fix = process.argv.includes('--fix');
  const offenders = [];

  for(const root of ROOTS){
    if(!fs.existsSync(root)) continue;
    for(const file of listFiles(root)){
      if(ALLOW_BINARY.test(file) || ALLOW_SNAPSHOT.test(file)) continue;
      const rel = path.relative('.', file).replace(/\\/g, '/');
      let text;
      try{ text = fs.readFileSync(file, 'utf8'); }
      catch{ continue; } // unreadable (permissions) — not a formatting issue

      const problems = [];
      if(text.includes('\r')) problems.push('CRLF line endings');
      if(/^[ \t]*\t/m.test(text)) problems.push('tab indentation');
      if(/[ \t]+$/m.test(text)) problems.push('trailing whitespace');
      if(text.length && !text.endsWith('\n')) problems.push('missing final newline');
      if(text.endsWith('\n\n')) problems.push('multiple final newlines');

      if(problems.length){
        if(fix){
          let out = text.replace(/\r\n?/g, '\n').replace(/[ \t]+$/gm, '');
          if(out.length && !out.endsWith('\n')) out += '\n';
          while(out.endsWith('\n\n')) out = out.slice(0, -1);
          fs.writeFileSync(file, out);
        } else {
          offenders.push({ rel, problems });
        }
      }
    }
  }

  if(offenders.length){
    console.error(`format-check: ${offenders.length} file(s) with formatting issues:\n`);
    for(const { rel, problems } of offenders) console.error(`  ${rel} — ${problems.join(', ')}`);
    console.error('\nRun `node scripts/format-check.cjs --fix` to fix mechanically.');
    process.exit(1);
  }
  console.log('format-check: clean');
}

main();
