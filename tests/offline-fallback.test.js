import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const offlinePath = path.join(root, 'public', 'offline.html');

test('generated offline fallback keeps dark mode readable and keyboard focus visible', () => {
  execFileSync(process.execPath, [path.join(root, 'scripts', 'gen-offline.cjs')], { cwd: root });
  const html = fs.readFileSync(offlinePath, 'utf8');

  assert.match(html, /prefers-color-scheme:\s*dark/);
  assert.match(html, /\.card\s*\{\s*background:\s*#1c1c20\s*!important;/);
  assert.match(html, /button:focus-visible\s*\{/);
  assert.match(html, /<button type="button"/);
});
