// scripts/build-with-integrations.mjs — build Arise WITH the optional
// integrations compiled in.
//
// The default `npm run build` (and therefore every hosted deploy) leaves
// VITE_ARISE_INTEGRATIONS unset, which compiles the NVIDIA coach,
// classifier.dev and Pulse paths out and strips their origins from the CSP.
//
// This wrapper exists so the integrations can still be built, reviewed and
// tested without a new dependency: it sets the env var for the child process
// in a way that works on Windows, macOS and Linux alike.
import { spawn } from 'node:child_process';

const child = spawn(
  process.execPath,
  ['scripts/gen-offline.cjs', 'scripts/gen-csp.cjs'],
  {
    stdio: 'inherit',
    env: { ...process.env, VITE_ARISE_INTEGRATIONS: 'on' },
  }
);

const onCode = (code)=> spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_ARISE_INTEGRATIONS: 'on' },
}).on('close', (viteCode)=> process.exit(viteCode ?? 1));

child.on('close', (code)=>{ if(code === 0) onCode(); else process.exit(code ?? 1); });