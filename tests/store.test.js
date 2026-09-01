import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { lastExerciseSets, prsHitBySession, normaliseHistory, upsertHistory, runMigrations, STORE_SCHEMA_VERSION } from '../src/lib/store.js';

describe('store — soundCues, voiceCoach and voiceRate preference migrations (v6 → v9)', () => {
  it('defaults sound cues on, voice coach off, rate 1× for older stores, honouring explicit choices', () => {
    const migrated = runMigrations({ version: 6, preferences: {} });
    assert.equal(migrated.version, STORE_SCHEMA_VERSION);
    assert.equal(migrated.preferences.soundCues, true);
    assert.equal(migrated.preferences.voiceCoach, false);
    assert.equal(migrated.preferences.voiceRate, 1);

    const optedOut = runMigrations({ version: 6, preferences: { soundCues: false } });
    assert.equal(optedOut.preferences.soundCues, false);

    const fromV1 = runMigrations({ version: 1, preferences: { units: 'kg', theme: null } });
    assert.equal(fromV1.preferences.soundCues, true);
    assert.equal(fromV1.preferences.voiceCoach, false);
    assert.equal(fromV1.preferences.voiceRate, 1);

    const voiceOptIn = runMigrations({ version: 7, preferences: { voiceCoach: true } });
    assert.equal(voiceOptIn.preferences.voiceCoach, true);

    const fast = runMigrations({ version: 8, preferences: { voiceRate: 1.2 } });
    assert.equal(fast.preferences.voiceRate, 1.2);

    const absurd = runMigrations({ version: 8, preferences: { voiceRate: 42 } });
    assert.equal(absurd.preferences.voiceRate, 1);
  });
});

describe('store — lastExerciseSets / prsHitBySession (Life OS port)', () => {
  const hist = [
    { id: 'a', dateISO: '2026-01-01', title: 'Push + Legs', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '8', weightKg: '20' }, { reps: '8', weightKg: '20' }] }, { exerciseId: 'bodyweight-squat', sets: [{ reps: '12', weightKg: '' }] }] },
    { id: 'b', dateISO: '2026-01-03', title: 'Upper A', blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps: '6', weightKg: '24' }] }] },
  ];

  it('returns most recent prior sets for an exercise', () => {
    const got = lastExerciseSets(hist, 'bench-press-dumbbell');
    assert.ok(got);
    assert.equal(got.dateISO, '2026-01-03');
    assert.equal(got.sets[0].weightKg, '24');
  });

  it('returns null when exercise never logged', () => {
    const got = lastExerciseSets(hist, 'pull-up');
    assert.equal(got, null);
  });

  it('detects new PR vs prior history (Epley)', () => {
    const prior = hist.slice(0, 1);
    const session = hist[1]; // 24×6 → 28.8 e1RM vs prior 20×8 → 25.3
    const hits = prsHitBySession(session, prior);
    const hit = hits.find(h => h.exerciseId === 'bench-press-dumbbell');
    assert.ok(hit, 'should hit a PR');
    assert.ok(hit.e1rm > 25);
  });

  it('does not flag bodyweight-only sets as PRs', () => {
    const session = { id: 'c', dateISO: '2026-01-05', title: 'Legs', blocks: [{ exerciseId: 'bodyweight-squat', sets: [{ reps: '15', weightKg: '' }] }] };
    const hits = prsHitBySession(session, hist);
    assert.ok(!hits.some(h => h.exerciseId === 'bodyweight-squat'));
  });

  it('upserts duplicate session ids and keeps the newer edited record', () => {
    const older = { id: 'same', dateISO: '2026-01-05', savedAt: '2026-01-05T10:00:00Z', blocks: [] };
    const newer = { id: 'same', dateISO: '2026-01-05', savedAt: '2026-01-05T11:00:00Z', blocks: [{ exerciseId: 'push-up', sets: [] }] };
    assert.equal(upsertHistory([older], newer).length, 1);
    assert.equal(upsertHistory([older], newer)[0].blocks[0].exerciseId, 'push-up');
    assert.equal(normaliseHistory([newer, older]).length, 1);
    assert.equal(normaliseHistory([newer, older])[0].savedAt, newer.savedAt);
  });
});
