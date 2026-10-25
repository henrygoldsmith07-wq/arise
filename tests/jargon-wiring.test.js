import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = f => readFileSync(new URL(`../src/components/${f}`, import.meta.url), 'utf8');
describe('jargon help is wired where the jargon appears', () => {
  for (const [file, term] of [['SessionRunner.jsx','RIR'],['ProgressView.jsx','RPE'],['ProgressView.jsx','RIR'],['ExerciseHistorySheet.jsx','RIR'],['session/SetRow.jsx','RIR']]) {
    it(`${file} offers ${term} help`, () => {
      const src = read(file);
      assert.match(src, /import JargonHelp from/);
      assert.ok(src.includes(`<JargonHelp term="${term}" />`));
    });
  }
  it('mobile set list explains RIR since its header omits the column', () => {
    assert.match(read('SessionRunner.jsx'), /sm:hidden[^"]*"[^>]*>RIR = reps left in the tank/);
  });
});
