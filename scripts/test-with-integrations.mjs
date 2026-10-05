// scripts/test-with-integrations.mjs — run the whole unit suite with the
// optional integrations compiled in.
//
// `npm test` runs with VITE_ARISE_INTEGRATIONS unset, which is the shipped
// default: the classifier and AI-coach suites then assert the fail-closed
// behaviour. This second pass re-runs everything with the flag on so the
// integration code itself is still exercised rather than merely preserved.
// Both configurations must be green; neither alone is sufficient.
import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const files = readdirSync(path.join(ROOT, 'tests'))
  .filter(name=> name.endsWith('.test.js'))
  .sort()
  .map(name=> `tests/${name}`);

const child = spawn(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  cwd: ROOT,
  env: { ...process.env, VITE_ARISE_INTEGRATIONS: 'on' },
});

child.on('close', (code)=> process.exit(code ?? 1));