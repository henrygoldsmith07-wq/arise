import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('"Built for you" line states session length as a ceiling, not a promise', () => {
  const src = readFileSync(new URL('../src/components/TodayView.jsx', import.meta.url), 'utf8');
  assert.match(src, /up to \$\{ob\.availableMinutes\} min a session/);
  assert.doesNotMatch(src, /\$\{ob\.availableMinutes\}-minute sessions/);
});
