// Accessibility-layer unit tests: the live-announcer scheduler (dedupe,
// throttling, voice-takeover marking) and the pure Tab-wrap decision.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAnnouncerState,
  planAnnouncement,
  focusTrapDecision,
  isKeyboardActivation,
  scrollIntoViewWithReducedMotion,
} from '../src/lib/a11y.js';

describe('a11y — live announcer scheduling', () => {
  it('suppresses an immediate identical repeat, but re-announces later', () => {
    const state = createAnnouncerState();
    let t = 1000;
    const now = ()=> t;
    assert.equal(planAnnouncement(state, 'Rest complete', {}, now), 'Rest complete');
    t += 500;
    assert.equal(planAnnouncement(state, 'Rest complete', {}, now), '');
    // Rest rounds repeat the same text minutes apart — that IS worth saying.
    t += 10_000;
    assert.equal(planAnnouncement(state, 'Rest complete', {}, now), 'Rest complete');
  });

  it('lets a different message through immediately after the global gap', () => {
    const state = createAnnouncerState();
    let t = 1000;
    const now = ()=> t;
    assert.equal(planAnnouncement(state, 'Rest complete', {}, now), 'Rest complete');
    t += 900; // past MIN_GLOBAL_MS (800), different text
    assert.equal(planAnnouncement(state, 'Next: Bench Press.', {}, now), 'Next: Bench Press.');
  });

  it('collapses a rapid burst of different messages into one', () => {
    const state = createAnnouncerState();
    let t = 1000;
    const now = ()=> t;
    assert.equal(planAnnouncement(state, '2 minutes remaining', { key: 'rest-timer' }, now), '2 minutes remaining');
    t += 300; // inside the global burst window — rapid churn stays quiet
    assert.equal(planAnnouncement(state, '1 minute remaining', { key: 'rest-timer' }, now), '');
    t += 600; // past the burst window: the newest state gets through
    assert.equal(planAnnouncement(state, '1 minute remaining', { key: 'rest-timer' }, now), '1 minute remaining');
  });

  it('different keys do not wait on each other beyond the global gap', () => {
    const state = createAnnouncerState();
    let t = 1000;
    const now = ()=> t;
    assert.equal(planAnnouncement(state, 'Step 3 of 8: Bench Press.', { key: 'guided-step' }, now), 'Step 3 of 8: Bench Press.');
    t += 850;
    assert.equal(planAnnouncement(state, '2 minutes remaining', { key: 'rest-timer' }, now), '2 minutes remaining');
  });

  it('ignores empty messages', () => {
    const state = createAnnouncerState();
    assert.equal(planAnnouncement(state, '', {}, Date.now), '');
  });
});

describe('a11y — focus trap wrap decision', () => {
  const focusables = ['a', 'b', 'c'];

  it('wraps forward from the last element to the first', () => {
    assert.equal(focusTrapDecision(focusables, 'c', false), 'first');
  });

  it('wraps backward from the first element to the last', () => {
    assert.equal(focusTrapDecision(focusables, 'a', true), 'last');
  });

  it('leaves normal navigation alone', () => {
    assert.equal(focusTrapDecision(focusables, 'a', false), null);
    assert.equal(focusTrapDecision(focusables, 'b', true), null);
  });

  it('does nothing with no focusable elements', () => {
    assert.equal(focusTrapDecision([], 'a', false), null);
    assert.equal(focusTrapDecision(null, 'a', false), null);
  });
});

describe('a11y — keyboard activation detection', () => {
  it('treats Enter/Space and assistive-technology clicks as keyboard activation', () => {
    // Keyboard activation dispatches a click with detail 0. Programmatic
    // element.click() and some AT-synthesised clicks carry no count at all.
    assert.equal(isKeyboardActivation({ detail: 0 }), true);
    assert.equal(isKeyboardActivation({}), true);
    assert.equal(isKeyboardActivation(undefined), true);
    assert.equal(isKeyboardActivation({ detail: '0' }), true);
  });

  it('rejects real pointer clicks so a pointerdown-stepped control does not double-step', () => {
    assert.equal(isKeyboardActivation({ detail: 1 }), false);
    assert.equal(isKeyboardActivation({ detail: 2 }), false);
    assert.equal(isKeyboardActivation({ detail: NaN }), true);
  });
});

describe('a11y — reduced-motion-aware scrolling', () => {
  const hadMm = Object.prototype.hasOwnProperty.call(globalThis, 'matchMedia');
  const hadDoc = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const realMm = globalThis.matchMedia;
  const realDoc = globalThis.document;

  // Install a fake browser environment for one assertion, then restore it.
  const withEnv = ({ matchMedia, doc }, fn)=> {
    if(matchMedia === undefined) delete globalThis.matchMedia;
    else globalThis.matchMedia = matchMedia;
    if(doc === undefined) delete globalThis.document;
    else globalThis.document = doc;
    try{ fn(); } finally {
      if(hadMm) globalThis.matchMedia = realMm; else delete globalThis.matchMedia;
      if(hadDoc) globalThis.document = realDoc; else delete globalThis.document;
    }
  };
  const fakeEl = ()=> {
    const calls = [];
    return { calls, scrollIntoView: (opts)=> calls.push(opts) };
  };
  const classListWith = (present)=> ({ classList: { contains: (c)=> present && c === 'reduce-motion' } });

  it('keeps the requested smooth behaviour when no preference is set', () => {
    withEnv({ matchMedia: ()=> ({ matches: false }), doc: { documentElement: classListWith(false) } }, ()=> {
      const el = fakeEl();
      scrollIntoViewWithReducedMotion(el, { behavior: 'smooth', block: 'start' });
      assert.deepEqual(el.calls, [{ behavior: 'smooth', block: 'start' }]);
    });
  });

  it('substitutes behavior auto when the OS reduced-motion preference is set', () => {
    withEnv({ matchMedia: (q)=> ({ matches: q === '(prefers-reduced-motion: reduce)' }), doc: undefined }, ()=> {
      const el = fakeEl();
      scrollIntoViewWithReducedMotion(el, { behavior: 'smooth', block: 'nearest' });
      assert.deepEqual(el.calls, [{ behavior: 'auto', block: 'nearest' }]);
    });
  });

  it('substitutes behavior auto when the app reduce-motion class is present', () => {
    withEnv({ matchMedia: undefined, doc: { documentElement: classListWith(true) } }, ()=> {
      const el = fakeEl();
      scrollIntoViewWithReducedMotion(el, { behavior: 'smooth' });
      assert.deepEqual(el.calls, [{ behavior: 'auto' }]);
    });
  });

  it('keeps the class fallback when matchMedia is missing or throws', () => {
    withEnv({ matchMedia: ()=> { throw new Error('no matchMedia'); }, doc: { documentElement: classListWith(true) } }, ()=> {
      const el = fakeEl();
      scrollIntoViewWithReducedMotion(el, { behavior: 'smooth' });
      assert.deepEqual(el.calls, [{ behavior: 'auto' }]);
    });
    withEnv({ matchMedia: undefined, doc: undefined }, ()=> {
      const el = fakeEl();
      scrollIntoViewWithReducedMotion(el, { behavior: 'smooth' });
      assert.deepEqual(el.calls, [{ behavior: 'smooth' }]);
    });
  });

  it('is a safe no-op when the element is missing or has no scrollIntoView', () => {
    withEnv({ matchMedia: undefined, doc: undefined }, ()=> {
      scrollIntoViewWithReducedMotion(null, { behavior: 'smooth' });
      scrollIntoViewWithReducedMotion({}, { behavior: 'smooth' });
    });
  });
});
