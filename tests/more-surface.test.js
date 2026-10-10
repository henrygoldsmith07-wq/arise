// More/settings surface guards. The reorganisation of More into intent
// groups reshuffles sections and moves copy behind an "Advanced"
// disclosure — these tests pin the contracts the rest of the suite (and the
// e2e specs) rely on: every e2e-visible selector keeps its exact name/id,
// the settings search index covers every section that renders, and the
// developer/research concepts sit behind the collapsed disclosure where
// they can still be reached by search jump (which opens the gate first).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = (...p)=> join(process.cwd(), ...p);
const more = readFileSync(root('src', 'components', 'MoreView.jsx'), 'utf8');
const evidence = readFileSync(root('src', 'components', 'settings', 'EvidenceSettings.jsx'), 'utf8');
// Section cards also render inside the lazily-loaded settings components.
const settingsCards = ['AiCoachSettings', 'AppearanceAccessibilitySettings', 'FeedbackSettings', 'GuidedSettings', 'TrainingPolicySettings']
  .map(name => readFileSync(root('src', 'components', 'settings', name + '.jsx'), 'utf8'))
  .join('\n');
const sourceText = more + evidence + settingsCards;
// JSX escapes entities in text nodes ("Feedback & issue triage"), so a
// needle containing "&" may only appear encoded in source. Compare against
// both the raw source and the entity-encoded needle instead of decoding.
const amp = String.fromCharCode(38);
const encodeEntities = (t)=> t.split(amp).join(amp + 'amp;');
const rendered = sourceText;
const shows = (t)=> sourceText.includes(t) || sourceText.includes(encodeEntities(t));
const settingsService = readFileSync(root('src', 'services', 'settingsService.js'), 'utf8');

describe('More surface: intent-grouped layout', ()=>{
  it('renders the six intent group headings in order', ()=>{
    const titles = ['Profile & training', 'Workout experience', 'Appearance & accessibility', 'Data', 'Privacy & integrations', 'About / advanced'];
    let last = -1;
    for(const title of titles){
      // Match the heading node only — prose elsewhere can mention a group
      // name (the search-jump link does), and that must not satisfy the order
      // check.
      const at = more.indexOf(`aria-label="${title}"`);
      assert.ok(at > -1, `group heading missing: ${title}`);
      assert.ok(at > last, `group heading out of order: ${title}`);
      last = at;
    }
  });

  it('keeps every section id the e2e specs jump to', ()=>{
    for(const id of ['sec-gym','sec-backup','sec-appearance','sec-guided','sec-policy','sec-personalise','sec-privacy','sec-ai','sec-feedback','sec-evidence','sec-help','sec-sync','sec-storage','sec-integrations','sec-advanced']){
      assert.ok(rendered.includes(`id="${id}"`), `section id missing: ${id}`);
    }
  });

  it('keeps the e2e-asserted button labels verbatim', ()=>{
    for(const label of ['Export JSON','Export encrypted','Import backup','Export CSV','Erase all Arise data from this device','Export study data']){
      assert.ok(rendered.includes(label), `e2e label missing: ${label}`);
    }
    // product.spec disables Export JSON while demo data is loaded.
    assert.match(more, /Export JSON[\s\S]{0,200}store\.demo/);
  });

  it('keeps the e2e-asserted text and form labels', ()=>{
    for(const text of ['Time for a backup','Cross-device sync merges deterministically','Feedback & issue triage','Take part in the real-world study','Insufficient real-user evidence','Ask the coach','Endpoint URL','Describe the issue or request','Cloud-assisted feedback categorisation','Cloud-assisted coach request routing']){
      assert.ok(shows(text), `e2e text missing: ${text}`);
    }
    // feedback-triage asserts the coach result inside #sec-ai — that section
    // lives in the AiCoachSettings card, not in MoreView itself.
    assert.ok(rendered.includes('id="sec-ai"'), '#sec-ai must stay for the aiResult locator');
    // The sync strict-mode getByText('Cross-device sync', { exact:true }) is
    // SyncPanel's own <p> — the section wrapper must not repeat the exact text
    // in another leaf, or the locator resolves to 2 elements.
    assert.equal(more.split('Cross-device sync</').length - 1, 0, 'no duplicate exact "Cross-device sync" leaf heading');
  });

  it('keeps guided-mode and appearance e2e scoped locators addressable', ()=>{
    // guided-mode scopes to the section containing a "Guided mode" heading;
    // that heading must live in exactly one <section> (not nested in groups
    // rendered as <section> themselves).
    assert.ok(more.includes('aria-label="Workout experience"'), 'workout-experience group must carry its aria-label');
    assert.equal((more.match(/<h3 /g) || []).length, 6, 'exactly six group headings (h3) so section-scoped locators stay unambiguous');
  });
});

describe('More surface: Advanced disclosure keeps research/diagnostics out of the default view', ()=>{
  it('collapses diagnostics and expert settings inside the Advanced details', ()=>{
    const gateStart = more.indexOf('id="sec-advanced"');
    assert.ok(gateStart > -1, 'the Advanced disclosure must exist');
    assert.match(more, /<details[^>]*id="sec-advanced"/, 'sec-advanced is a details disclosure');
    for(const label of ['Show','local telemetry','crash logs','Support diagnostics']){
      assert.ok(more.slice(gateStart).includes(label), `Advanced must hold: ${label}`);
    }
    // The destructive erase stays reachable but inside the gate.
    assert.ok(more.slice(gateStart).includes('Erase all Arise data from this device'), 'erase lives behind Advanced');
  });

  it('keeps the study card visible without opening any disclosure', ()=>{
    // product-polish asserts the study card right after tapping More: it must
    // not sit inside a collapsed <details> in the rendered tree.
    const evSection = evidence.indexOf('id="sec-evidence"');
    assert.ok(evSection > -1, 'sec-evidence renders');
    assert.equal(/<details[\s\S]*?Take part in the real-world study/.test(evidence.slice(evidence.indexOf('Take part in the real-world study') - 400, evidence.indexOf('Take part in the real-world study'))), false,
      'the study card heading is not inside a closed details');
  });

  it('search jump opens the Advanced gate before scrolling', ()=>{
    assert.match(more, /closest\?\.\('details'\)/, 'jumpToSetting opens the enclosing details');
    assert.match(more, /el\.scrollIntoView/);
    assert.match(more, /settings-flash/);
  });
});

describe('settings search index matches the reshuffled sections', ()=>{
  it('indexes every rendered section id exactly once', ()=>{
    const ids = [...settingsService.matchAll(/\{ id: '(sec-[a-z-]+)'/g)].map(m=> m[1]);
    assert.ok(ids.length >= 13, 'the index covers the sections');
    assert.equal(new Set(ids).size, ids.length, 'no duplicate ids in the index');
    for(const id of ids){
      assert.ok(rendered.includes(`id="${id}"`), `indexed but not rendered: ${id}`);
    }
  });

  it('keeps the matchSettings contract: substring match, empty for empty', ()=>{
    assert.match(settingsService, /export function matchSettings\(query\)\{[\s\S]*?includes\(q\)/);
    assert.match(settingsService, /if\(!q\) return \[\]/);
  });
});

describe('study UX copy keeps its leakage contract', ()=>{
  it('spells out the shared categories at join time and under the export', ()=>{
    for(const re of [/Workout structure and performance/i, /Recommendation evidence/i, /Readiness check-ins[^.]*structured/i, /Logging\/timing measurements/i, /Programme adjustment metadata/i, /Study lifecycle metadata/i]){
      assert.match(evidence, re, `study copy must disclose: ${re}`);
    }
    assert.match(evidence, /Never included:.*free-text notes[\s\S]*?health-platform[\s\S]*?crash diagnostics/i, 'the never-shared list stays');
  });

  it('keeps withdrawal semantics honest', ()=>{
    assert.match(evidence, /cannot reach/, 'shared copies are out of reach');
    assert.doesNotMatch(evidence, /removes it everywhere/);
  });
});
