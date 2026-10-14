// coach-panel.test.js — the main-loop coach surface's structural contracts.
//
// The on-device coach used to exist only behind More → Settings → "AI coach
// (optional)". When it was moved into Today and Progress as CoachPanel, these
// source contracts pin what the engine contract cannot express itself:
//
//   1. The panel answers ONLY through localCoachAnswer — no fetch, no cloud
//      lane, no settings mutation. It is a display of engine findings, not a
//      networked assistant.
//   2. Conversation memory is component state only — nothing persists.
//   3. The views reach the panel lazily, so neither route chunk nor boot pays
//      for the coaching-state graph.
//   4. The soundness engineering honesty carries: labelled regions, live
//      announcements for async answers, a no-finding state that reads as one.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p)=> join(process.cwd(), ...p);
const panel = readFileSync(root('src', 'components', 'CoachPanel.jsx'), 'utf8');
const today = readFileSync(root('src', 'components', 'TodayView.jsx'), 'utf8');
const progress = readFileSync(root('src', 'components', 'ProgressView.jsx'), 'utf8');

describe('CoachPanel: on-device-only answering contract', ()=>{
  it('answers only through localCoachAnswer and its own suggestion helper', ()=>{
    assert.match(panel, /import \{ localCoachAnswer, suggestedCoachQuestions \} from '\.\.\/lib\/coach\/localCoach\.js';/);
    assert.match(panel, /localCoachAnswer\(text, \{ store/);
  });

  it('never touches the network, the AI settings or the classifier', ()=>{
    for(const forbidden of ['fetch', 'runCoachRequest', 'saveAiSettings', 'getAiSettings', 'requestCoachInsight', 'aiCoachRoute', 'routeCoachRequest', 'localStorage', 'sessionStorage', 'indexedDB']){
      assert.ok(!panel.includes(forbidden), `CoachPanel must not reference ${forbidden}`);
    }
  });

  it('keeps the conversation memory component-scoped and follow-up-aware', ()=>{
    assert.match(panel, /lastRef/i);
    assert.match(panel, /answer\.remember/);
    assert.match(panel, /followUp/);
  });

  it('renders the memory as a labelled "continuing from" line, never silently', ()=>{
    assert.match(panel, /Continuing from/);
  });
});

describe('CoachPanel: accessibility and honest-state contracts', ()=>{
  it('labels the section and live-announces answers', ()=>{
    assert.match(panel, /aria-label="Ask the coach"/);
    assert.match(panel, /aria-live="polite"/);
  });

  it('labels the input and disables the ask button while busy or empty', ()=>{
    assert.match(panel, /aria-label="Ask the coach a question"/);
    assert.match(panel, /disabled=\{busy \|\| !question\.trim\(\)\}/);
    assert.match(panel, /maxLength=\{500\}/);
  });

  it('declares the no-finding state instead of leaving silence', ()=>{
    assert.match(panel, /Honest no-finding answer/);
  });

  it('states the privacy line in the surface itself', ()=>{
    assert.match(panel, /nothing leaves this device/);
  });
});

describe('CoachPanel: lazy entry points keep the route chunks lean', ()=>{
  it('Today and Progress lazy-load the panel; neither imports it statically', ()=>{
    for(const [name, src] of [['TodayView', today], ['ProgressView', progress]]){
      assert.ok(src.includes("import('./CoachPanel.jsx')"), `${name} must lazy-import CoachPanel`);
      assert.ok(!/from '\.\/CoachPanel\.jsx'/.test(src), `${name} must not statically import CoachPanel`);
    }
  });
  it('passes the suggestions provenance (programmeWhy) from both views', ()=>{
    assert.match(today, /programmeWhy=\{coach\.programmeWhy\}/);
    assert.match(progress, /programmeWhy=/);
  });
});

// The trust badge: the moment onboarding completes — before any real data
// exists to protect — Today states the local-first contract in one line. It
// must be honest (no "nothing ever leaves" absolutism), scoped to the
// first-run/evaluator state, and silent in demo (which has no user data).
describe('CoachPanel surface: the first-run data-posture badge', ()=>{
  it('renders one badge on Today, keyed to the coach gate and honest copy', ()=>{
    assert.match(today, /data-testid="today-trust-badge"/, 'the badge renders on Today');
    assert.match(today, /Your data stays on this device/, 'the badge says what it keeps');
    assert.match(today, /Exporting or setting up sync is always your choice/, 'the badge stays honest about the user-owned exports/sync');
  });

  it('is gated to the first-run state and never fires on demo data', ()=>{
    const gate = today.match(/const showTrustBadge = ([^;]+);/);
    assert.ok(gate, 'the badge is computed through one named gate');
    assert.match(gate[1], /coach\.programmeWhy/, 'gate keys to the first-plan being active');
    assert.match(gate[1], /store\.history/, 'gate closes once real sessions exist');
    assert.match(gate[1], /!store\.demo/, 'demo data never earns the trust badge');
  });
});
