#!/usr/bin/env node
// scripts/vercel-ignore.mjs — Vercel build-skip gate for the arise monorepo.
//
// Vercel invokes this via the `ignoreCommand` in vercel.json. When it exits
// with code 0, Vercel skips the build (treating the commit as unchanged for
// this project). When it exits non-zero, Vercel proceeds with the build.
//
// This is intentionally dependency-free (no `execa`, no `simple-git`) so it
// works in any Node environment Vercel provides. It inspects the raw `git`
// output only.
//
// Usage: node scripts/vercel-ignore.mjs --project arise
//        node scripts/vercel-ignore.mjs --project arise-site

import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
const project = projectIdx >= 0 ? args[projectIdx + 1] : '';

if(!project){
  console.error('vercel-ignore: --project is required (e.g. --project arise)');
  process.exit(1);
}

// Vercel provides the before/after commit. Without both there is nothing to
// diff, so we cannot prove this project is unchanged — build.
const before = process.env.VERCEL_GIT_PREV_COMMIT_SHA || '';
const after = process.env.VERCEL_GIT_COMMIT_SHA || '';
const commitRange = before && after ? `${before}..${after}` : '';

try{
  const paths = execSync(`git diff --name-only ${commitRange} 2>/dev/null`, { encoding:'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);

  if(paths.length === 0){
    // No changed paths — skip (nothing to do)
    console.log(`vercel-ignore[${project}]: no changed paths, skipping build`);
    process.exit(0);
  }

  // Determine which sub-project this Vercel deployment targets.
  // The arise app lives in src/, arise-site/ lives in arise-site/.
  const prefixes = {
    arise: ['src/', 'scripts/', 'index.html', 'public/', 'tests/', 'e2e/', 'docs/', 'package.json', 'vite.config.ts', 'vercel.json'],
    'arise-site': ['arise-site/', 'scripts/vercel-ignore.mjs'],
  };

  const relevant = prefixes[project] || [];
  const touched = paths.filter(p => relevant.some(prefix => p.startsWith(prefix)));

  if(touched.length === 0){
    console.log(`vercel-ignore[${project}]: no files in ${project} scope changed (${paths.length} file(s) total), skipping build`);
    console.log(`  changed: ${paths.slice(0, 10).join(', ')}${paths.length > 10 ? ' …' : ''}`);
    process.exit(0);
  }

  console.log(`vercel-ignore[${project}]: ${touched.length} file(s) in scope changed, building`);
  console.log(`  relevant: ${touched.slice(0, 10).join(', ')}${touched.length > 10 ? ' …' : ''}`);
  process.exit(1);
}catch(err){
  // If git diff fails (e.g. first deploy, no prior commit), build by default.
  console.error(`vercel-ignore[${project}]: git diff failed (${err.message}), building by default`);
  process.exit(1);
}
