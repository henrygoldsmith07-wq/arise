#!/usr/bin/env node
// scripts/changelog.cjs — release notes from conventional commits.
//
// Derives the changelog section for a tag from the commit log since the
// previous tag. No tool dependency, no config file: the repo already writes
// conventional subjects (feat:/fix:/test:/chore:), so the history IS the
// changelog — this just renders it.
//
//   node scripts/changelog.cjs --tag v0.2.0          # section for that tag
//   node scripts/changelog.cjs --init                # bootstrap CHANGELOG.md
const { execSync } = require('node:child_process');

function sh(cmd){ return execSync(cmd, { encoding: 'utf8' }).trim(); }

function tags(){
  try{ return sh('git tag --sort=-creatordate').split('\n').filter(Boolean); }
  catch{ return []; }
}

function commitsBetween(from, to = 'HEAD'){
  const range = from ? `${from}..${to}` : to;
  try{
    return sh(`git log ${range} --pretty=format:%s§§%h`).split('\n').filter(Boolean)
      .map((line) => { const [subject, hash] = line.split('§§'); return { subject: subject.trim(), hash }; });
  }catch{ return []; }
}

function categorise(subject){
  const s = subject.toLowerCase();
  if(s.startsWith('feat')) return 'Features';
  if(s.startsWith('fix')) return 'Fixes';
  if(s.startsWith('perf')) return 'Performance';
  if(s.startsWith('test')) return 'Tests';
  if(s.startsWith('docs')) return 'Docs';
  if(s.startsWith('refactor') || s.startsWith('arch')) return 'Internal';
  return 'Other';
}

function render(tag){
  const all = tags();
  const prev = all[all.indexOf(tag) + 1] || null; // tag right before this one
  const date = sh('git log -1 --format=%as ' + tag);
  const commits = commitsBetween(prev, tag);
  const sections = new Map();
  for(const { subject, hash } of commits){
    if(/^merge|bump version|^release/i.test(subject)) continue;
    const cat = categorise(subject);
    if(!sections.has(cat)) sections.set(cat, []);
    // Strip the conventional prefix for humans; keep the hash for traceability.
    const text = subject.replace(/^[a-zA-Z]+(\([^)]*\))?!?:\s*/, '');
    sections.get(cat).push(`- ${text} (${hash})`);
  }
  const lines = [`## ${tag} — ${date}`, ''];
  if(prev) lines.push(`_Full diff: ${prev}…${tag}_`, '');
  if(!sections.size) lines.push('_No user-facing changes recorded._');
  for(const [cat, items] of sections){
    lines.push(`### ${cat}`, ...items, '');
  }
  return lines.join('\n');
}

function main(){
  const args = process.argv.slice(2);
  if(args.includes('--init')){
    const all = tags().reverse(); // oldest first
    const body = all.length ? all.map(render).join('\n\n') : '## 0.1.0\n\n_Initial release._\n';
    require('node:fs').writeFileSync('CHANGELOG.md', `# Changelog\n\n${body}\n`);
    console.error('CHANGELOG.md written');
    return;
  }
  const tagFlag = args.indexOf('--tag');
  const tag = tagFlag !== -1 ? args[tagFlag + 1] : sh('git describe --tags --abbrev=0');
  console.log(render(tag));
}

main();
