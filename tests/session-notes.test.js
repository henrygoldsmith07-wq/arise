import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_TEMPLATES, appendNoteTemplate } from '../src/lib/sessionNotes.js';

describe('session note templates', () => {
  it('exposes unique ids and non-empty starter text', () => {
    assert.equal(new Set(NOTE_TEMPLATES.map((item) => item.id)).size, NOTE_TEMPLATES.length);
    assert.ok(NOTE_TEMPLATES.every((item) => item.label && item.text));
  });

  it('starts an empty note with the selected template', () => {
    assert.equal(appendNoteTemplate('', 'next-time'), 'Next time: ');
  });

  it('appends another template on a new line without deleting existing notes', () => {
    assert.equal(
      appendNoteTemplate('Bench felt stable.  ', 'technique'),
      'Bench felt stable.\nTechnique: ',
    );
  });

  it('leaves notes unchanged for an unknown template id', () => {
    assert.equal(appendNoteTemplate('Keep this', 'missing'), 'Keep this');
  });
});
