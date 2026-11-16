// The reps stepper stepped only on pointerdown, so pressing the focused button
// with Enter/Space (or activating it with assistive technology) did nothing.
// The unit suite has no DOM, so pin the component's keyboard wiring as a source
// contract here; the activation decision itself is unit-tested in a11y.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'components', 'StepperButton.jsx'), 'utf8');
const handler = source.slice(source.indexOf('const stepFromKeyboard'), source.indexOf('const start'));

describe('StepperButton — keyboard and assistive-technology activation', () => {
  it('mirrors pointer stepping onto click, gated by the keyboard-activation check', () => {
    assert.match(source, /import \{ isKeyboardActivation \} from '\.\.\/lib\/a11y\.js';/);
    assert.match(source, /onClick=\{stepFromKeyboard\}/);
    assert.match(handler, /isKeyboardActivation\(e\)/);
  });

  it('steps exactly once per keyboard activation — never arms hold-to-repeat', () => {
    // start() arms the hold timer and only a pointerup clears it; keyboard
    // users never send one, so the click path must call onStep directly.
    assert.match(handler, /onStep\(\)/);
    assert.doesNotMatch(handler, /start\(\)/);
  });
});
