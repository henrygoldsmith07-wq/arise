#!/usr/bin/env node
// scripts/bundle-diff.cjs — bundle size diff reporting for CI.
//
// The budget gate (bundle-budget.cjs) is a hard ceiling; this report is the
// *conversation*: what each chunk weighed before and after this PR, so the
// reviewer sees "MoreView +2.1 kB (lazy)" instead of discovering it in
// production. Emits Markdown to stdout; `--check <kb>` exits 1 when total
// gzip growth exceeds the allowance (default 10 kB) — an advisory gate any
// maintainer can consciously override in review.
//
// Usage (CI):
//   node scripts/bundle-diff.cjs build-dist-of-base   # write baseline first
//   node scripts/bundle-diff.cjs --base <dir> --check 10
const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');

function collectDist(dir){
  // Real gzip sizes per chunk: name -> {raw, gzip}
  const out = new Map();
  if(!fs.existsSync(dir)) return out;
  for(const f of fs.readdirSync(dir)){
    if(!f.endsWith('.js')) continue;
    const full = path.join(dir, f);
    const raw = fs.statSync(full).size;
    // zlib's gzip with default level 6 approximates what the wire carries.
    const zlib = require('node:zlib');
    const gzip = zlib.gzipSync(fs.readFileSync(full)).length;
    out.set(f, { raw, gzip });
  }
  return out;
}

function shortName(f){
  // index-HASH.js → index; keeps the table readable across content hashes.
  return f.replace(/-[A-Za-z0-9_-]{8}\.js$/, '');
}

function buildDir(target){
  const dir = path.resolve('node_modules/.bundle-diff', target);
  fs.mkdirSync(dir, { recursive: true });
  const dist = path.resolve('dist/assets');
  if(!fs.existsSync(dist)) throw new Error(`dist not found — run "npm run build" first`);
  fs.rmSync(path.join(dir, 'assets'), { recursive: true, force: true });
  fs.cpSync(dist, path.join(dir, 'assets'), { recursive: true });
  return path.join(dir, 'assets');
}

function main(){
  const args = process.argv.slice(2);
  const baseFlag = args.indexOf('--base');
  const checkFlag = args.indexOf('--check');
  const checkKb = checkFlag !== -1 ? Number(args[checkFlag + 1] || 10) : null;

  if(args.includes('write-base')){
    // Snapshot the CURRENT dist as the baseline (used when bootstrapping or
    // after a conscious re-baseline).
    const dir = buildDir('base');
    console.error(`baseline written: ${dir}`);
    return;
  }

  let baseDir = null;
  if(baseFlag !== -1){
    baseDir = path.resolve(args[baseFlag + 1]);
  } else {
    // Default: diff against origin/main by building it in a temp worktree.
    const worktree = path.resolve('node_modules/.bundle-diff/main-wt');
    try{
      execSync(`git fetch origin main --quiet`, { stdio: 'ignore' });
      try{ execSync(`git worktree remove --force "${worktree}"`, { stdio: 'ignore' }); }catch{}
      execSync(`git worktree add "${worktree}" origin/main`, { stdio: 'ignore' });
      execSync(`npm ci --silent`, { cwd: worktree, stdio: 'ignore' });
      execSync(`npm run build`, { cwd: worktree, stdio: 'ignore' });
      baseDir = path.join(worktree, 'dist', 'assets');
      if(!fs.existsSync(baseDir)) throw new Error('baseline build produced no dist');
    }catch(err){
      console.error(`bundle-diff: baseline build failed (${err.message.split('\n')[0]}) — reporting current sizes only`);
      try{ execSync(`git worktree remove --force "${worktree}"`, { stdio: 'ignore' }); }catch{}
    }
  }

  const current = collectDist(path.resolve('dist/assets'));
  const base = baseDir ? collectDist(baseDir) : new Map();

  const names = [...new Set([...current.keys(), ...base.keys()].map(shortName))].sort();
  const byShort = (m) => {
    const acc = new Map();
    for(const [f, s] of m){
      const k = shortName(f);
      const prev = acc.get(k) || { raw: 0, gzip: 0 };
      acc.set(k, { raw: prev.raw + s.raw, gzip: prev.gzip + s.gzip });
    }
    return acc;
  };
  const A = byShort(base), B = byShort(current);

  const rows = [];
  let totalDelta = 0;
  for(const n of names){
    const a = A.get(n)?.gzip ?? 0;
    const b = B.get(n)?.gzip ?? 0;
    const d = b - a;
    totalDelta += d;
    rows.push({ n, a, b, d });
  }
  rows.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  const kb = (v) => `${(v / 1024).toFixed(1)} kB`;
  const arrow = (d) => d > 0 ? `🔴 +${kb(d)}` : d < 0 ? `🟢 ${kb(d)}` : '—';
  console.log('### Bundle size diff (gzip)\n');
  console.log('| Chunk | base | this PR | Δ |');
  console.log('|---|---|---|---|');
  for(const r of rows.slice(0, 15)) console.log(`| ${r.n} | ${r.a ? kb(r.a) : '—'} | ${kb(r.b)} | ${arrow(r.d)} |`);
  if(rows.length > 15) console.log(`| … ${rows.length - 15} more | | | |`);
  console.log(`| **Total** | | | **${arrow(totalDelta)}** |`);

  if(checkKb != null){
    if(totalDelta > checkKb * 1024){
      console.error(`bundle-diff: total gzip grew ${kb(totalDelta)} (> ${checkKb} kB allowance). Either slim it or raise the allowance consciously in review.`);
      process.exit(1);
    }
    console.log(`\nWithin the ${checkKb} kB advisory allowance.`);
  }
}

main();
