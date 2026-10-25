import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GLOSSARY, glossaryEntry } from '../src/lib/glossary.js';
describe('glossary', () => {
  it('finds terms case-insensitively', () => {
    assert.equal(glossaryEntry('rir').title, GLOSSARY.RIR.title);
    assert.equal(glossaryEntry('E1RM').title, GLOSSARY.e1RM.title);
  });
  it('returns null for unknown terms', () => assert.equal(glossaryEntry('nope'), null));
  it('every entry explains itself in plain words', () => {
    for(const e of Object.values(GLOSSARY)){ assert.ok(e.title && e.body.length > 30); }
  });
  it('no entry gives nutrition advice', () => {
    for(const e of Object.values(GLOSSARY)) assert.doesNotMatch(e.body, /calorie|protein|diet/i);
  });
});
