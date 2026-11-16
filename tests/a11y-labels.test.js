// Lighthouse/axe found two buttons whose visible text was absent from their
// accessible name (label-content-name-mismatch). Screen-reader users heard a
// different label from the one sighted users saw. Pin the rendered strings as
// source contracts — the unit suite has no DOM.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const src = (file) => readFileSync(join(process.cwd(), 'src', 'components', file), 'utf8');

describe('a11y — accessible names include visible text', () => {
  it('the Today level card is named by its own visible text', () => {
    const source = src('TodayView.jsx');
    const button = source.slice(source.indexOf('<button onClick={onOpenProgress}'), source.indexOf('</button>', source.indexOf('<button onClick={onOpenProgress}')));
    assert.doesNotMatch(button, /aria-label=/);
    assert.match(button, /Level & strength trends/);
  });

  it('the TeachingPanel trigger includes its visible How-to text in the label', () => {
    const source = src('TeachingPanel.jsx');
    assert.match(source, /aria-label=\{`\$\{open \? 'How-to ✓' : 'How-to'\} — \$\{open \? 'Hide how to do it' : 'Show how to do it'\} for \$\{t\.name\}`\}/);
  });
});
