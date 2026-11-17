// Demo data must never reach a real WebDAV remote or Pulse. The pure gating
// decisions are unit-tested directly; the React wiring is pinned as a source
// contract (the unit suite has no DOM harness), following stepper-keyboard.test.js.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canAutoSync, autoSyncAfterSave } from '../src/lib/autoSync.js';
import { integrationsAllowed } from '../src/services/workoutService.js';

const readSrc = (...parts) => readFileSync(join(process.cwd(), ...parts), 'utf8');
const autoSyncSrc = readSrc('src', 'lib', 'autoSync.js');
const workoutSrc = readSrc('src', 'services', 'workoutService.js');
const moreViewSrc = readSrc('src', 'components', 'MoreView.jsx');

describe('demo isolation — pure gating decisions', () => {
  it('both predicates allow real stores and reject only explicit demo stores', () => {
    assert.equal(canAutoSync(undefined), true);
    assert.equal(canAutoSync({}), true);
    assert.equal(canAutoSync({ demo: false }), true);
    assert.equal(canAutoSync({ demo: true }), false);
    assert.equal(integrationsAllowed(undefined), true);
    assert.equal(integrationsAllowed({}), true);
    assert.equal(integrationsAllowed({ demo: false }), true);
    assert.equal(integrationsAllowed({ demo: true }), false);
  });

  it('autoSyncAfterSave persists nothing for a demo store even when fully configured', async () => {
    let persisted = false;
    const store = {
      demo: true,
      preferences: {
        syncEnabled: true,
        sync: { url: 'https://dav.example/arise/', username: 'u', password: 'p' },
      },
    };
    await autoSyncAfterSave({ store, setStore: () => { persisted = true; } });
    assert.equal(persisted, false, 'a demo save must not write back a synced store');
  });
});

describe('demo isolation — source contracts (no DOM harness)', () => {
  it('autoSyncAfterSave checks the demo predicate before reading sync preferences', () => {
    assert.match(autoSyncSrc, /export function canAutoSync\(store\)\{\s*return store\?\.demo !== true;\s*\}/);
    const body = autoSyncSrc.slice(autoSyncSrc.indexOf('export async function autoSyncAfterSave'));
    assert.match(body, /if\(!canAutoSync\(store\)\) return;/);
    assert.ok(body.indexOf('if(!canAutoSync(store)) return;') < body.indexOf('const prefs'));
  });

  it('workoutService gates both the sync import and the Pulse branch on the demo predicate', () => {
    assert.match(workoutSrc, /export function integrationsAllowed\(store\)\{\s*return store\?\.demo !== true;\s*\}/);
    assert.match(workoutSrc, /if\(integrationsAllowed\(store\)\)\{\s*void import\('\.\.\/lib\/autoSync\.js'\)/);
    assert.match(workoutSrc, /if\(integrationsAllowed\(store\) && integrationEnabledByBuild\(\) && store\?\.preferences\?\.pulseEnabled && adapter\)/);
  });

  it('MoreView hides the SyncPanel in demo mode', () => {
    const gate = moreViewSrc.slice(
      moreViewSrc.indexOf('store.demo === true ? ('),
      moreViewSrc.indexOf('<SyncPanel'),
    );
    assert.match(gate, /Sync is disabled in demo mode/);
    assert.match(gate, /\) : \(/, 'the demo note must be the "if" branch and SyncPanel the "else"');
  });

  it('MoreView disables every export button in demo mode', () => {
    for(const handler of ['exportNow', 'exportEncrypted', 'exportCsv', 'exportCoach', 'shareCoach', 'exportEvents', 'exportSupportBundle', 'exportSalvage']){
      const re = new RegExp(`<button onClick=\\{${handler}\\}([^>]*)>`, 'g');
      const matches = [...moreViewSrc.matchAll(re)];
      assert.ok(matches.length > 0, `expected a button wired to ${handler}`);
      for(const m of matches) assert.match(m[1], /disabled=\{store\.demo === true\}/, `${handler} button must be disabled in demo mode`);
    }
    for(const kind of ['history', 'settings', 'events']){
      assert.match(moreViewSrc, new RegExp(`<button onClick=\\{\\(\\)=> exportPartial\\('${kind}'\\)\\} disabled=\\{store\\.demo === true\\}`));
    }
    assert.match(moreViewSrc, /onClick=\{\(\)=> \{ if\(store\.demo === true\) return; import\('\.\.\/lib\/printReport\.js'\)/);
  });

  it('MoreView guards the export handlers themselves in demo mode', () => {
    assert.match(moreViewSrc, /const demoGuard = \(\)=> \{/);
    for(const fn of ['exportNow', 'exportEncrypted', 'exportCsv', 'exportEvents', 'exportPartial', 'shareCoach', 'exportCoach', 'exportSupportBundle', 'exportSalvage']){
      const start = moreViewSrc.indexOf(`const ${fn} = `);
      assert.notEqual(start, -1, `expected handler ${fn}`);
      assert.match(moreViewSrc.slice(start, start + 200), /if\(!demoGuard\(\)\) return;/);
    }
  });

  it('MoreView renders an honest consent-review sentence when no review date exists', () => {
    assert.match(moreViewSrc, /: "You haven't reviewed these choices yet\."/);
    assert.doesNotMatch(moreViewSrc, /You last reviewed these choices \{Math\.round/);
  });
});
