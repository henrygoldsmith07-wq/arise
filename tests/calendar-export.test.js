import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildIcs, escapeText, foldLine, normaliseTime, upcomingSessions } from '../src/lib/calendarExport.js';
import { moveSession } from '../src/lib/weekdaySchedule.js';

const blocks = [
  { exerciseId: 'lat-pulldown', sets: 3, reps: '8-10', restSec: 90 },
  { exerciseId: 'cable-row', sets: 3, reps: '10' },
];
const schedule = () => ({
  sessions: [
    { id: 's-done', dateISO: '2026-11-02', status: 'done', title: 'Upper A', blocks },
    { id: 's-1', dateISO: '2026-11-03', status: 'planned', title: 'Upper A, heavy; "pull"', blocks },
    { id: 's-2', dateISO: '2026-11-05', status: 'planned', title: 'Upper B', blocks },
    { id: 's-far', dateISO: '2027-06-01', status: 'planned', title: 'Far', blocks },
  ],
});
const names = { 'lat-pulldown': 'Lat pulldown', 'cable-row': 'Cable row' };
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const unfold = (t) => t.replace(/\r\n /g, '');
const events = (t) => unfold(t).split('BEGIN:VEVENT').slice(1);
const prop = (ev, k) => new RegExp(`^${k}:(.*)$`, 'm').exec(ev)?.[1];

describe('calendarExport', () => {
  it('exports only upcoming, not-done sessions inside the horizon', () => {
    const got = upcomingSessions(schedule(), '2026-11-01');
    assert.deepEqual(got.map((s) => s.id), ['s-1', 's-2']);
    assert.deepEqual(upcomingSessions(schedule(), 'nonsense'), []);
  });

  it('writes a valid calendar with CRLF endings, floating start time and a duration-based end', () => {
    const { text, count, filename } = buildIcs(schedule(), { fromISO: '2026-11-01', nowMs: NOW, startTime: '07:30', nameOf: (id) => names[id] });
    assert.equal(count, 2);
    assert.equal(filename, 'arise-training-2026-11-01.ics');
    assert.ok(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
    assert.ok(text.endsWith('END:VCALENDAR\r\n'));
    assert.ok(!/[^\r]\n/.test(text), 'every line ends in CRLF');
    const [e1] = events(text);
    assert.equal(prop(e1, 'DTSTART').trim(), '20261103T073000');
    const end = prop(e1, 'DTEND').trim();
    assert.ok(end > '20261103T073000' && end.startsWith('20261103T0'), `end ${end}`);
    assert.match(unfold(text), /TRIGGER:-PT60M/);
  });

  it('escapes text and keeps every physical line within 75 octets', () => {
    assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
    const { text } = buildIcs(schedule(), { fromISO: '2026-11-01', nowMs: NOW, nameOf: (id) => names[id] });
    for (const line of text.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);
    const e1 = events(text)[0];
    assert.match(prop(e1, 'SUMMARY'), /^Arise: Upper A\\, heavy\\; "pull"$/);
    assert.match(prop(e1, 'DESCRIPTION'), /Lat pulldown — 3×8-10\\nCable row — 3×10/);
  });

  it('never splits a multi-byte character when folding', () => {
    const long = 'SUMMARY:' + '💪'.repeat(40);
    const folded = foldLine(long);
    assert.equal(folded.replace(/\r\n /g, ''), long);
    for (const l of folded.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  });

  it('keeps the UID stable when a session moves so a re-import updates, not duplicates', () => {
    const a = buildIcs(schedule(), { fromISO: '2026-11-01', nowMs: NOW });
    const moved = moveSession(schedule(), 's-1', '2026-11-04', '2026-11-01');
    assert.ok(!moved.error);
    const b = buildIcs(moved.schedule, { fromISO: '2026-11-01', nowMs: NOW + 3600000 });
    const uidA = events(a.text).map((e) => prop(e, 'UID'));
    const uidB = events(b.text).map((e) => prop(e, 'UID'));
    assert.deepEqual(uidB.sort(), uidA.sort());
    const ev = events(b.text).find((e) => prop(e, 'UID').includes('s-1'));
    assert.match(prop(ev, 'DTSTART'), /^20261104T/);
    assert.ok(Number(prop(ev, 'SEQUENCE')) > Number(prop(events(a.text).find((e) => prop(e, 'UID').includes('s-1')), 'SEQUENCE')));
  });

  it('honours reminder 0 (no alarm) and falls back on a bad start time', () => {
    assert.equal(normaliseTime('25:99'), '18:00');
    assert.equal(normaliseTime('7:05'), '07:05');
    const { text } = buildIcs(schedule(), { fromISO: '2026-11-01', nowMs: NOW, startTime: 'later', reminderMin: 0 });
    assert.ok(!text.includes('VALARM'));
    assert.match(unfold(text), /DTSTART:20261103T180000/);
  });

  it('rolls a late evening session into the next day correctly', () => {
    const { text } = buildIcs(schedule(), { fromISO: '2026-11-01', nowMs: NOW, startTime: '23:50' });
    assert.match(prop(events(text)[0], 'DTEND'), /^20261104T0/);
  });

  it('exports nothing for an empty or missing schedule', () => {
    assert.equal(buildIcs(null, { fromISO: '2026-11-01', nowMs: NOW }).count, 0);
  });
});
