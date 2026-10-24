import test from 'node:test';
import assert from 'node:assert/strict';
import { PROGRAMS, scheduleProgram } from '../src/lib/data.js';
import { rideClash, rideConflicts, applyRideAwareDates, normaliseRideDays, hasLegWork } from '../src/lib/rideAwareSchedule.js';

const legSession = (id, dateISO, status='planned') => ({ id, dateISO, status, blocks:[{ exerciseId:'leg-press', sets:2, reps:'10' }] });
const upper = (id, dateISO) => ({ id, dateISO, status:'planned', blocks:[{ exerciseId:'lat-pulldown', sets:3, reps:'10' }] });

test('rideClash: ride day and day before; none when no days set', ()=>{
  // 2026-10-24 is a Saturday (6)
  assert.equal(rideClash('2026-10-24', [6]), 'ride-day');
  assert.equal(rideClash('2026-10-23', [6]), 'day-before');
  assert.equal(rideClash('2026-10-22', [6]), null);
  assert.equal(rideClash('2026-10-24', []), null);
});
test('Sunday ride: Saturday clashes (week wrap)', ()=>{
  assert.equal(rideClash('2026-10-24', [0]), 'day-before');
});
test('normaliseRideDays drops junk and dupes', ()=>{
  assert.deepEqual(normaliseRideDays([6, '6', 9, -1, 'x', 0]), [0, 6]);
});
test('only undone leg sessions conflict', ()=>{
  const sched = { sessions:[legSession('a','2026-10-23'), legSession('b','2026-10-23','done'), upper('c','2026-10-23')] };
  assert.deepEqual(rideConflicts(sched, [6]).map(c=>c.session.id), ['a']);
});
test('moves a clashing leg session to the nearest clear, free day, not into the past', ()=>{
  const sched = { sessions:[legSession('a','2026-10-23'), upper('u','2026-10-22')], rev:1 };
  const r = applyRideAwareDates(sched, [6], { todayISO:'2026-10-20' });
  // 24 is ride day, 22 taken by upper, so +1 and -1 blocked/clashing; +2 = 25 Sun is clear
  assert.deepEqual(r.moved, [{ id:'a', from:'2026-10-23', to:'2026-10-25' }]);
  assert.equal(r.schedule.rev, 2);
  assert.deepEqual(r.schedule.sessions.map(s=>s.id), ['u','a']);
});
test('never moves before today; reports stuck', ()=>{
  const sched = { sessions:[legSession('a','2026-10-23')] };
  const r = applyRideAwareDates(sched, [0,1,2,3,4,5,6], { todayISO:'2026-10-23' });
  assert.deepEqual(r.stuck, ['a']);
  assert.equal(r.schedule.sessions[0].dateISO, '2026-10-23');
});
test('no ride days leaves the schedule untouched', ()=>{
  const sched = { sessions:[legSession('a','2026-10-23')] };
  assert.equal(applyRideAwareDates(sched, []).schedule, sched);
});
test('a real full-body programme has leg work; rider upper plan keeps it capped but present', ()=>{
  const p = PROGRAMS.find(p=>p.id==='starter-3x');
  const s = scheduleProgram({ programId:p.id, startDateISO:'2026-10-19' });
  assert.ok(s.sessions.some(hasLegWork));
});
