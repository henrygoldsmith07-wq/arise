// rest-dock.test.js — the rest dock's adjustment contract.
//
// The dock's ± buttons only make sense on a RUNNING countdown: they move the
// existing `endsAt`. The old implementation anchored to `Date.now()` whenever
// `endsAt` was null, so tapping −15s or −60s on a dock whose rest had already
// expired (or that was never started) produced `max(now+5s, now−15s)` — a
// surprise NEW 5-second rest. The floor exists to keep an active countdown
// from being shortened into the past, not to conjure one out of nothing.
//
// These are source-contract tests (the repo's node:test suite has no DOM
// renderer); they read the component the same way coach-panel.test.js reads
// CoachPanel, so a regression fails loudly without React.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p)=> join(process.cwd(), ...p);
const dock = readFileSync(root('src', 'components', 'session', 'RestDock.jsx'), 'utf8');

describe('RestDock: adjust acts on a running timer only', ()=>{
  it('refuses to start a phantom rest when no countdown is active', ()=>{
    // The guard must precede any onChange call in the adjust handler.
    const adjust = dock.match(/const adjust = \(delta\)=>\s*\{([\s\S]*?)\n  \};/);
    assert.ok(adjust, 'adjust keeps its own guarded block');
    assert.match(adjust[1], /if\(!endsAt\) return;/, 'no endsAt → no adjustment at all');
    assert.ok(
      adjust[1].indexOf('if(!endsAt) return;') < adjust[1].indexOf('onChange'),
      'the guard fires before onChange can be called',
    );
  });

  it('extends and shortens the existing end time, never re-anchoring to now', ()=>{
    assert.match(dock, /onChange\(Math\.max\(Date\.now\(\) \+ 5000, endsAt \+ delta \* 1000\)\)/,
      'the delta applies to endsAt itself, keeping a 5s floor only for a live timer');
    // Strip comments before scanning for the old fallback expression.
    const code = dock.replace(/\/\/[^\n]*/g, '');
    assert.ok(!/\(endsAt \|\| Date\.now\(\)\)/.test(code),
      'the null-fallback that invented phantom rests is gone');
  });

  it('keeps preset taps and skip as explicit timer starts/stops', ()=>{
    // Presets deliberately START a countdown and Skip deliberately clears it;
    // only the ± adjusters must be inert without a timer.
    assert.match(dock, /onChange\(Date\.now\(\) \+ sec \* 1000\)/);
    assert.match(dock, /onChange\(null\)/);
  });
});
