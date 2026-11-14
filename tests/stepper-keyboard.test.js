// stepper-keyboard.test.js — regression cover for the reps stepper's keyboard
// path. The control stepped only on pointerdown, so a keyboard or screen-reader
// activation (which dispatches a click, not a pointer event) was focusable but
// inert — WCAG 2.1.1. Component DOM behaviour is pinned here as a source
// contract because the unit suite has no DOM; the decision itself
// (isKeyboardActivation) is unit-tested in a11y.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(process.cwd(), 'src', 'components', 'StepperButton.jsx'), 'utf8');

describe('StepperButton — keyboard and assistive-technology activation', ()=> {
  it('mirrors pointer stepping onto click, gated by the keyboard-activation check', ()=> {
    assert.match(source, /import \{ isKeyboardActivation \} from '\.\.\/lib\/a11y\.js';/);
    assert.match(source, /onClick=\{stepFromKeyboard\}/);
  });

  it('steps exactly once per keyboard activation — never arms hold-to-repeat', ()=> {
    // start() arms the hold timer, and only a pointerup clears it; keyboard
    // users never send one, so the click path must call onStep directly.
    const clickHandler = source.slice(source.indexOf('const stepFromKeyboard'), source.indexOf('return ('));
    assert.match(clickHandler, /onStep\(\)/);
    assert.doesNotMatch(clickHandler, /start\(\)/);
  });
});
