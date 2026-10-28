import test from 'node:test';
import assert from 'node:assert/strict';
import { replanToWeekdays, moveSession, nextAllowedDate, weekdayOf, normaliseWeekdays } from '../src/lib/weekdaySchedule.js';

const mk = (dates, done = []) => ({ rev: 1, sessions: dates.map((d, i) => ({ id: `s${i}`, dateISO: d, status: done.includes(i) ? 'done' : 'planned' })) });

test('normaliseWeekdays dedupes, sorts, drops junk', () => {
  assert.deepEqual(normaliseWeekdays([5, 1, 1, 9, 'x', 3]), [1, 3, 5]);
});
test('replan puts sessions on Mon/Wed/Fri', () => {
  const s = replanToWeekdays(mk(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-08']), [1, 3, 5], '2026-11-02');
  assert.deepEqual(s.sessions.map((x) => weekdayOf(x.dateISO)), [1, 3, 5, 1]);
  assert.equal(s.sessions[3].dateISO, '2026-11-09');
  assert.equal(s.rev, 2);
});
test('replan keeps done sessions and never goes backwards', () => {
  const s = replanToWeekdays(mk(['2026-11-02', '2026-11-04', '2026-11-06'], [0]), [2, 4], '2026-11-03');
  assert.equal(s.sessions[0].dateISO, '2026-11-02');
  assert.equal(s.sessions[1].dateISO, '2026-11-03');
  assert.equal(s.sessions[2].dateISO, '2026-11-05');
});
test('replan skips ride dates when another allowed day exists', () => {
  const s = replanToWeekdays(mk(['2026-11-02', '2026-11-04']), [1, 3, 5], '2026-11-02', { rideDates: ['2026-11-02'] });
  assert.equal(s.sessions[0].dateISO, '2026-11-04');
  assert.equal(s.sessions[1].dateISO, '2026-11-06');
});
test('empty weekdays leaves schedule unchanged', () => {
  const base = mk(['2026-11-02']);
  assert.equal(replanToWeekdays(base, [], '2026-11-02'), base);
});
test('nextAllowedDate finds same-day match', () => {
  assert.equal(nextAllowedDate('2026-11-02', [1]), '2026-11-02');
});
test('moveSession moves into a free day', () => {
  const r = moveSession(mk(['2026-11-02', '2026-11-04']), 's0', '2026-11-03', '2026-11-01');
  assert.equal(r.error, null);
  assert.equal(r.schedule.sessions[0].dateISO, '2026-11-03');
});
test('moveSession swaps with a planned clash and keeps order', () => {
  const r = moveSession(mk(['2026-11-02', '2026-11-04']), 's0', '2026-11-04');
  assert.deepEqual(r.schedule.sessions.map((x) => x.id), ['s1', 's0']);
  assert.equal(r.swapped, 's1');
});
test('moveSession refuses done, past, same and done-clash', () => {
  const sch = mk(['2026-11-02', '2026-11-04'], [1]);
  assert.equal(moveSession(sch, 's1', '2026-11-09').error, 'done');
  assert.equal(moveSession(sch, 's0', '2026-10-01', '2026-11-01').error, 'past');
  assert.equal(moveSession(sch, 's0', '2026-11-02').error, 'same');
  assert.equal(moveSession(sch, 's0', '2026-11-04').error, 'taken');
  assert.equal(moveSession(sch, 'zz', '2026-11-04').error, 'not-found');
});
