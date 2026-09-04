#!/usr/bin/env node
// benchmark/determinism.js — seeded deterministic benchmark runs.
//
// Every benchmark must be reproducible: twice in a row on the same machine
// (this check), and across commits (the JSON artifact + comparator). Any drift
// means an engine or fixture change moved measured behaviour — exactly the
// moment to re-baseline consciously, with the reason recorded.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const fixturePath = process.argv[2] || path.join(here, 'fixtures', 'synthetic-history.json');
const hash = crypto.createHash('sha256').update(fs.readFileSync(fixturePath)).digest('hex').slice(0, 16);

function runBacktest(tag){
  const out = execFileSync(process.execPath, [path.join(here, 'backtest.js'), fixturePath], { encoding: 'utf8', cwd: root });
  return { tag, out };
}

const a = runBacktest('a');
const b = runBacktest('b');
const deterministic = a.out === b.out;
console.log(`  fixture sha256[:16]: ${hash}`);
console.log(`  deterministic: ${deterministic ? 'yes' : 'NO — two identical runs produced different output'}`);
if(!deterministic){
  console.log('--- run A ---'); console.log(a.out);
  console.log('--- run B ---'); console.log(b.out);
  process.exit(1);
}
// Echo the metrics for the artifact collector.
process.stdout.write(a.out);
