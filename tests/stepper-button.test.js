// stepper-button.test.js — keyboard parity for the ± steppers.
//
// StepperButton is hold-to-repeat over POINTER events only: onPointerDown
// started the ramp and there was no onClick at all, so pressing the focused
// button with Enter or Space (how a native <button> activates) did nothing.
// A keyboard user could tab to "Decrease reps set 2" but could never step
// it — WCAG 2.1.1 (Keyboard). The fix wires Enter/Space to one step and
// marks the activation handled so a browser-synthesized click cannot step
// a second time.
//
// Source-contract test (the repo's node:test suite has no DOM renderer; same
// pattern as rest-dock.test.js reading RestDock).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p)=> join(process.cwd(), ...p);
const src = readFileSync(root('src', 'components', 'StepperButton.jsx'), 'utf8');
// Comments document intent, not behaviour — strip them before asserting.
const code = src.replace(/\/\/[^\n]*/g, '');

describe('StepperButton: keyboard parity', ()=>{
  it('activates from the keyboard (Enter/Space), not pointer events alone', ()=>{
    assert.match(code, /onClick=\{handleActivation\}/,
      'a click handler must exist — Enter/Space on a native button fires click');
    assert.match(code, /onKeyDown=/, 'keydown is wired');
    assert.match(code, /e\.key === 'Enter' \|\| e\.key === ' '/,
      'Enter and Space both activate');
    // The keyboard path goes through the same start() as a pointer press.
    const keyBranch = code.match(/onKeyDown=\{\(e\)=>\s*\{([\s\S]*?)\}\}/);
    assert.ok(keyBranch, 'the keydown handler keeps its own block');
    assert.match(keyBranch[1], /start\(\)/, 'keydown steps through start()');
  });

  it('a keyboard press steps exactly once — synthesized clicks are swallowed', ()=>{
    // The held-guard consumed by handleActivation: after a keyboard
    // activation the flag is set, so any click synthesized from the keyup
    // is treated as follow-through and does not step again.
    const activation = code.match(/const handleActivation = useCallback\(\(\)=>\s*\{([\s\S]*?)\}, \[start\]\)/);
    assert.ok(activation, 'click activation is a named handler with the held guard');
    assert.match(activation[1], /if\(heldRef\.current\)\{ heldRef\.current = false; return; \}/,
      'a marked (hold-end or key-synthesized) click never steps again');
    const keyBranch = code.match(/onKeyDown=\{\(e\)=>\s*\{([\s\S]*?)\}\}/);
    assert.match(keyBranch[1], /heldRef\.current = true/, 'keydown marks itself handled');
  });

  it('key autorepeat does not accelerate the stepper', ()=>{
    const keyBranch = code.match(/onKeyDown=\{\(e\)=>\s*\{([\s\S]*?)\}\}/);
    assert.match(keyBranch[1], /if\(e\.repeat\) return;/,
      'held Enter must not machine-gun steps — hold-to-repeat is pointer-only');
  });

  it('hold-to-repeat stays the pointer contract (no behavioural drift)', ()=>{
    // One pointerdown press still steps immediately and starts the ramp.
    assert.match(code, /onPointerDown=\{\(e\)=>\s*\{\s*e\.preventDefault\(\); heldRef\.current = true; start\(\); \s*\}\}/,
      'pointerdown starts the same press/ramp contract as before');
    assert.match(code, /onPointerUp=\{\(\)=> stop\(\)\}/, 'pointerup still stops the ramp');
  });

  it('stops an active hold when the control becomes disabled', ()=>{
    const disabledCleanup = code.match(/useEffect\(\(\)=>\s*\{([\s\S]*?)\}, \[disabled, stop\]\)/);
    assert.ok(disabledCleanup, 'disabled transitions have a cleanup effect');
    assert.match(disabledCleanup[1], /if\(disabled\) stop\(\);/,
      'disabling the control clears pending repeat timers');
  });
});
