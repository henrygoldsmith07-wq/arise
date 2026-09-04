// Accessibility-layer unit tests: the live-announcer scheduler (dedupe,
// throttling, voice-takeover marking) and the pure Tab-wrap decision.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createAnnouncerState,
  planAnnouncement,
  focusTrapDecision,
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
