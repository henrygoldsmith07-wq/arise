import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  SETUP_FIELDS, sanitizeSetupEntry, sanitizeSetupNotes, getSetupNote, formatSetup, setSetupNote,
  clearSetupNote, mergeSetupNotes, lastLoggedSetup, setupDrift, setupField, isEmptySetup,
} from '../src/lib/setupNotes.js';
import { buildSessionHistoryPayload } from '../src/lib/sessionRunnerModel.js';
import { buildGuidedPayload } from '../src/lib/guidedMode.js';
import { exerciseSessionHistory } from '../src/lib/exerciseHistory.js';
import { mergeGymPrefs } from '../src/lib/sync.js';
import { mergeStores } from '../src/lib/export.js';

const T1 = '2026-10-01T09:00:00.000Z';
const T2 = '2026-10-02T09:00:00.000Z';
const T3 = '2026-10-03T09:00:00.000Z';

const mkBlock = (extra = {}) => ({
  exerciseId: 'chest-press-machine', reps: '8-10', restSec: 90, unilateral: false,
  sets: [{ reps: '10', weightKg: '40', rpe: '8', completed: true, failed: false }], ...extra,
});
const mkSession = { id: 's1', dateISO: '2026-10-05', programId: 'p', title: 'Upper', blocks: [] };

describe('setupNotes — storage shape', () => {
  it('stores trimmed fields with a timestamp and formats one line', () => {
    const patch = setSetupNote(null, 'chest-press-machine', { seat: ' 4 ', pin: 'pin 3', grip: 'neutral', angle: '', note: 'strap\non pad' }, T1);
    const entry = getSetupNote(patch, 'chest-press-machine');
    assert.equal(entry.seat, '4');
    assert.equal(entry.note, 'strap on pad');
    assert.equal(entry.updatedAt, T1);
    assert.equal(formatSetup(entry), 'Seat 4 · Pin pin 3 · Grip neutral · strap on pad');
    assert.equal(patch.updatedAt, T1);
  });

  it('caps each field at its maximum length and strips control characters', () => {
    const long = 'x'.repeat(500);
    const e = sanitizeSetupEntry({ seat: long, note: `a\u0000b${long}`, updatedAt: T1 });
    const seatMax = SETUP_FIELDS.find((f) => f.key === 'seat').max;
    assert.equal(e.seat.length, seatMax);
    assert.ok(e.note.length <= SETUP_FIELDS.find((f) => f.key === 'note').max);
    assert.ok(!/\u0000/.test(e.note));
  });

  it('an unchanged save keeps the old timestamp (no fake recency)', () => {
    const first = setSetupNote(null, 'lat-pulldown', { seat: '3' }, T1);
    const again = setSetupNote(first, 'lat-pulldown', { seat: '3' }, T3);
    assert.equal(again.setupNotes['lat-pulldown'].updatedAt, T1);
    assert.equal(again.updatedAt, undefined);
  });

  it('clearing keeps a tombstone so a deletion beats an older copy', () => {
    const first = setSetupNote(null, 'lat-pulldown', { seat: '3' }, T1);
    const cleared = clearSetupNote(first, 'lat-pulldown', T2);
    assert.equal(getSetupNote(cleared, 'lat-pulldown'), null);
    assert.ok(isEmptySetup(cleared.setupNotes['lat-pulldown']));
    const merged = mergeSetupNotes(first.setupNotes, cleared.setupNotes);
    assert.equal(getSetupNote({ setupNotes: merged }, 'lat-pulldown'), null);
  });

  it('sanitizeSetupNotes drops junk ids and non-objects', () => {
    const out = sanitizeSetupNotes({ ok: { seat: '1', updatedAt: T1 }, 'bad id!': { seat: '2' }, nul: null, arr: [1], str: 'x' });
    assert.deepEqual(Object.keys(out), ['ok']);
    assert.deepEqual(sanitizeSetupNotes([1, 2]), {});
    assert.deepEqual(sanitizeSetupNotes('nope'), {});
  });
});

describe('setupNotes — merge', () => {
  const a = { x: { seat: '4', updatedAt: T1 }, y: { pin: '2', updatedAt: T3 } };
  const b = { x: { seat: '5', updatedAt: T2 }, z: { grip: 'wide', updatedAt: T1 } };
  it('newest edit wins per lift and unrelated lifts are kept', () => {
    const m = mergeSetupNotes(a, b);
    assert.equal(m.x.seat, '5');
    assert.equal(m.y.pin, '2');
    assert.equal(m.z.grip, 'wide');
  });
  it('is commutative and idempotent, including timestamp ties', () => {
    const tieA = { x: { seat: '4', updatedAt: T1 } }, tieB = { x: { seat: '6', updatedAt: T1 } };
    assert.deepEqual(mergeSetupNotes(tieA, tieB), mergeSetupNotes(tieB, tieA));
    assert.deepEqual(mergeSetupNotes(a, b), mergeSetupNotes(b, a));
    const m = mergeSetupNotes(a, b);
    assert.deepEqual(mergeSetupNotes(m, m), m);
    assert.deepEqual(mergeSetupNotes(m, a), m);
  });
  it('sync mergeGymPrefs merges setupNotes independently of rest presets', () => {
    const p1 = { restPresets: { x: 90 }, setupNotes: a, updatedAt: T1 };
    const p2 = { restPresets: { x: 120 }, setupNotes: b, updatedAt: T2 };
    const m = mergeGymPrefs(p1, p2);
    assert.equal(m.setupNotes.x.seat, '5');
    assert.equal(m.setupNotes.y.pin, '2');
    assert.deepEqual(mergeGymPrefs(p1, p2).setupNotes, mergeGymPrefs(p2, p1).setupNotes);
  });
  it('import (mergeStores) keeps the newest note per lift from either side', () => {
    const cur = { version: 1, gymPrefs: { restPresets: {}, setupNotes: { x: { seat: '4', updatedAt: T1 } } } };
    const imp = { version: 1, gymPrefs: { restPresets: {}, setupNotes: { x: { seat: '9', updatedAt: T2 }, q: { seat: '1', updatedAt: T1 } } } };
    const out = mergeStores(cur, imp, 'merge');
    assert.equal(out.gymPrefs.setupNotes.x.seat, '9');
    assert.equal(out.gymPrefs.setupNotes.q.seat, '1');
  });
  it('a hand-edited blob is cleaned on read and on merge', () => {
    const blob = { ok: { seat: '2', updatedAt: T1 }, 'bad id': { seat: '1' }, n: 5 };
    assert.equal(getSetupNote({ setupNotes: { x: { seat: ' 7 ', updatedAt: 'nonsense' } } }, 'x').seat, '7');
    assert.deepEqual(Object.keys(mergeSetupNotes(blob, null)), ['ok']);
  });
});

describe('setupNotes — history snapshot and drift', () => {
  const prefs = setSetupNote(null, 'chest-press-machine', { seat: '4', pin: '3' }, T1);

  it('the standard runner stamps the setup used onto the logged block', () => {
    const payload = buildSessionHistoryPayload({
      session: mkSession, blocks: [mkBlock(), mkBlock({ exerciseId: 'lat-pulldown' })],
      startedAt: '2026-10-05T10:00:00.000Z', nowISO: '2026-10-05T10:40:00.000Z', gymPrefs: prefs,
    });
    assert.equal(payload.blocks[0].setup, 'Seat 4 · Pin 3');
    assert.equal('setup' in payload.blocks[1], false);
  });

  it('guided mode stamps it too, and omits it without a note', () => {
    const withNote = buildGuidedPayload({ session: mkSession, blocks: [mkBlock()], startedAtISO: '2026-10-05T10:00:00.000Z', gymPrefs: prefs });
    assert.equal(withNote.blocks[0].setup, 'Seat 4 · Pin 3');
    const without = buildGuidedPayload({ session: mkSession, blocks: [mkBlock()], startedAtISO: '2026-10-05T10:00:00.000Z' });
    assert.equal('setup' in without.blocks[0], false);
  });

  it('lastLoggedSetup reads the newest session that included the lift', () => {
    const history = [
      { dateISO: '2026-10-01', blocks: [{ exerciseId: 'chest-press-machine', setup: 'Seat 2' }] },
      { dateISO: '2026-10-03', blocks: [{ exerciseId: 'chest-press-machine', setup: 'Seat 3' }] },
      { dateISO: '2026-10-04', blocks: [{ exerciseId: 'lat-pulldown' }] },
    ];
    assert.deepEqual(lastLoggedSetup(history, 'chest-press-machine'), { setup: 'Seat 3', dateISO: '2026-10-03' });
    assert.equal(lastLoggedSetup(history, 'never-done'), null);
  });

  it('setupDrift flags a change only when both setups exist and differ', ()=>{
    const hist = [{ dateISO: '2026-10-03', blocks: [{ exerciseId: 'chest-press-machine', setup: 'Seat 3 · Pin 3' }] }];
    assert.equal(setupDrift(prefs, hist, 'chest-press-machine').changed, true);
    assert.equal(setupDrift(prefs, hist, 'chest-press-machine').previous, 'Seat 3 · Pin 3');
    const same = [{ dateISO: '2026-10-03', blocks: [{ exerciseId: 'chest-press-machine', setup: 'Seat 4 · Pin 3' }] }];
    assert.equal(setupDrift(prefs, same, 'chest-press-machine').changed, false);
    assert.equal(setupDrift(null, hist, 'chest-press-machine').changed, false);
    assert.equal(setupDrift(null, [], 'chest-press-machine').changed, false);
    // Logged before the feature existed: a new note is not a "change".
    const legacy = [{ dateISO: '2026-09-01', blocks: [{ exerciseId: 'chest-press-machine' }] }];
    assert.equal(setupDrift(prefs, legacy, 'chest-press-machine').changed, false);
  });

  it('exerciseSessionHistory exposes each session\'s setup', () => {
    const history = [{ dateISO: '2026-10-03', blocks: [{ exerciseId: 'chest-press-machine', setup: 'Seat 3', sets: [{ reps: '10', weightKg: '40' }] }] }];
    assert.equal(exerciseSessionHistory(history, 'chest-press-machine')[0].setup, 'Seat 3');
  });

  it('setupField is empty for a cleared note', () => {
    const cleared = clearSetupNote(prefs, 'chest-press-machine', T2);
    assert.deepEqual(setupField(cleared, 'chest-press-machine'), {});
  });
});
