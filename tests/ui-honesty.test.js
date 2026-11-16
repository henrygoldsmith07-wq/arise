// Two copy paths that used to promise data the app did not have: an empty
// exercise-history sheet claimed "last 5 sessions", and a programme with no
// first-week exercises rendered four empty preview week cards. The unit suite
// has no DOM, so pin the rendered strings as source contracts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (name) => readFileSync(join(process.cwd(), 'src', 'components', name), 'utf8');

describe('UI honesty — counts and empty states', () => {
  it('the exercise-history heading states the real session count', () => {
    const source = read('ExerciseHistorySheet.jsx');
    assert.match(source, /sessions\.length === 0 \? `\$\{name\}: no sessions yet`/);
    assert.match(source, /sessions\.length === 1 \? `\$\{name\}: last session`/);
    assert.doesNotMatch(source, /last \$\{sessions\.length \|\| 5\} sessions/);
  });

  it('the progression preview shows an empty state instead of empty week cards', () => {
    const source = read('ProgressionPreview.jsx');
    assert.match(source, /preview\.exerciseCount === 0 && \(/);
    assert.match(source, /preview\.exerciseCount > 0 && \(/);
    assert.match(source, /no exercises to preview yet/);
  });
});
