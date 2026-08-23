import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { instantiateTemplate, recommendTemplate, listTemplates, templateVersionInfo } from '../src/lib/templates.js';
import { scheduleProgram } from '../src/lib/data.js';
import { mergeCustomTemplates } from '../src/lib/store.js';
import { parseImportFile, mergeStores, buildExportPayload } from '../src/lib/export.js';
import { mergeStoresWithConflicts } from '../src/lib/sync.js';

const CUSTOM = {
  id: 'custom-test1',
  isCustom: true,
  name: 'My Pull Focus',
  description: 'Extra pulling volume.',
  level: 'Beginner',
  goal: 'muscle',
  daysPerWeek: 2,
  version: 3,
  createdAtISO: '2026-08-01T00:00:00Z',
  updatedAtISO: '2026-08-02T00:00:00Z',
  program: {
    id: 'custom-test1',
    name: 'My Pull Focus',
    tagline: 'Extra pulling volume.',
    level: 'Beginner',
    daysPerWeek: 2,
    mesocycle: { weeks: 4, deloadWeek: null, progression: 'double-progression' },
    version: 3,
    equipment: ['dumbbells', 'bench', 'bodyweight'],
    weeks: [{
      week: 1,
      workouts: [
        { day: 1, title: 'Pull A', blocks: [
          { exerciseId: 'dumbbell-row', sets: 4, reps: '10', restSec: 90, loadHint: '' },
          { exerciseId: 'bench-press-barbell', sets: 3, reps: '8', restSec: 90, loadHint: '' }, // needs barbell → swap target
        ]},
        { day: 2, title: 'Pull B', blocks: [
          { exerciseId: 'band-curl', sets: 3, reps: '15', restSec: 45, loadHint: '' },
        ]},
      ],
    }],
  },
};

describe('custom templates — engine integration', ()=>{
  it('appear in listings alongside built-ins', ()=>{
    const all = listTemplates([CUSTOM]);
    assert.ok(all.some(t => t.id === 'tpl-starter' && !t.isCustom));
    const mine = all.find(t => t.id === CUSTOM.id);
    assert.ok(mine?.isCustom);
    assert.equal(mine.program.weeks, 1);
  });

  it('instantiate with an embedded programme produces dated sessions', ()=>{
    const result = instantiateTemplate({ templateId: CUSTOM.id, startDateISO: '2026-09-01', extraTemplates: [CUSTOM] });
    assert.equal(result.programId, CUSTOM.id);
    assert.equal(result.isCustom, true);
    assert.equal(result.templateVersion, 3);
    assert.ok(result.sessions.length >= 2);
    // Sessions carry week/day + honest ids namespaced by the template id.
    assert.ok(result.sessions.every(s => s.id.startsWith('custom-test1-')));
    assert.equal(result.sessions[0].dateISO, '2026-09-01');
  });

  it('swaps exercises the kit cannot support during instantiation', ()=>{
    const noBarbell = instantiateTemplate({ templateId: CUSTOM.id, startDateISO: '2026-09-01', availableEquipment: ['dumbbells', 'bench', 'bodyweight'], extraTemplates: [CUSTOM] });
    const swapped = noBarbell.sessions.flatMap(s => s.blocks).find(b => b.exerciseId === 'bench-press-barbell');
    assert.equal(swapped, undefined, 'barbell bench should have been swapped out');
    assert.ok(noBarbell.substitutions.some(s => s.from === 'bench-press-barbell'));
  });

  it('scheduleProgram honours an inline programme override', ()=>{
    const sched = scheduleProgram({ programId: 'anything', startDateISO: '2026-09-01', program: CUSTOM.program });
    assert.equal(sched.programVersion, 3);
    assert.ok(sched.sessions[0].blocks.every(b => b.version === 3));
  });

  it('recommendTemplate ranks customs with the same kit-honest scoring', ()=>{
    const { ranked } = recommendTemplate({
      goal: 'muscle', level: 'Beginner', daysPerWeek: 2,
      availableEquipment: ['dumbbells', 'bench', 'bodyweight'],
      extraTemplates: [CUSTOM],
    });
    const mine = ranked.find(t => t.id === CUSTOM.id);
    assert.ok(mine, 'custom template missing from ranking');
    // Perfect kit fit + exact days match should beat most built-ins.
    assert.ok(ranked.indexOf(mine) <= 1, `custom ranked too low: ${ranked.map(t => t.id)}`);
    assert.ok(mine.reasons.some(r => /full equipment fit/.test(r)));
  });

  it('templateVersionInfo reports custom versions without changelog history', ()=>{
    const info = templateVersionInfo(CUSTOM.id, [CUSTOM]);
    assert.equal(info.isCustom, true);
    assert.equal(info.templateVersion, 3);
    assert.deepEqual(info.templateChanges, []);
  });

  it('unknown custom ids fail loudly, not silently', ()=>{
    assert.throws(() => instantiateTemplate({ templateId: 'custom-nope', startDateISO: '2026-09-01' }));
  });
});

describe('custom templates — persistence', ()=>{
  const globalStoreBackup = globalThis.localStorage;

  it('mergeCustomTemplates prefers newer edits', ()=>{
    const older = { ...CUSTOM, updatedAtISO: '2026-08-01T00:00:00Z' };
    const merged = mergeCustomTemplates([older], [{ ...CUSTOM }]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].version, 3);
  });

  it('rides inside export payloads and survives import allowlist + merges', ()=>{
    globalThis.localStorage = { _m: {}, getItem(k){ return this._m[k] ?? null; }, setItem(k,v){ this._m[k]=String(v); }, removeItem(k){ delete this._m[k]; } };
    try{
      const store = { version: 6, onboarding: null, activeSchedule: null, history: [], preferences: {}, customTemplates: [CUSTOM] };
      const payload = buildExportPayload(store);
      const parsed = parseImportFile(JSON.stringify(payload));
      assert.equal(parsed.customTemplates.length, 1);
      assert.equal(parsed.customTemplates[0].id, CUSTOM.id);

      const merged = mergeStores({ customTemplates: [] }, parsed, 'merge');
      assert.equal(merged.customTemplates.length, 1);

      const synced = mergeStoresWithConflicts(
        { version: 6, history: [], customTemplates: [{ id: 'other', updatedAtISO: '2026-08-03T00:00:00Z' }] },
        { version: 6, history: [], customTemplates: [CUSTOM] },
      );
      assert.equal(synced.customTemplates.length, 2);
    }finally{
      globalThis.localStorage = globalStoreBackup;
    }
  });

  it('a hand-edited backup without customTemplates still imports cleanly', ()=>{
    const parsed = parseImportFile(JSON.stringify({ app: 'arise', data: { history: [], onboarding: null } }));
    assert.deepEqual(parsed.customTemplates, []);
  });
});
