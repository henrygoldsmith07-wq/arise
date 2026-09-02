import test from 'node:test';
import assert from 'node:assert/strict';
import { linePath, e1rmChartModel, stackedVolumeModel, adherenceStripModel } from '../src/lib/charts.js';

const session = (id, dateISO, blocks)=> ({ id, dateISO, title: id, week: 1, day: 1, blocks });
const block = (exerciseId, sets)=> ({ exerciseId, sets });
const set = (reps, weightKg)=> ({ reps, weightKg });

// A rising bench press: e1RM climbs steadily, so the fit has a positive slope.
const rising = [
  session('s1', '2026-01-05', [block('bench-press-barbell', [set(8, 60), set(8, 60)])]),
  session('s2', '2026-01-12', [block('bench-press-barbell', [set(8, 62.5), set(8, 62.5)])]),
  session('s3', '2026-01-19', [block('bench-press-barbell', [set(8, 65), set(8, 65)])]),
  session('s4', '2026-01-26', [block('bench-press-barbell', [set(8, 67.5), set(8, 67.5)])]),
];

const byId = {
  'bench-press-barbell': { muscle: 'Chest' },
  'barbell-squat': { muscle: 'Legs' },
  'run-easy': { muscle: 'Cardio' },
};

test('linePath emits a move then line segments', ()=>{
  assert.equal(linePath([{ x: 0, y: 10 }, { x: 5, y: 2 }]), 'M0 10 L5 2');
  assert.equal(linePath([]), '');
});

test('e1rm model refuses a trend below two points', ()=>{
  const none = e1rmChartModel([], 'bench-press-barbell');
  assert.equal(none.n, 0);
  assert.equal(none.line, '');
  assert.equal(none.band, null);
  assert.match(none.summary, /No loaded sets/);

  const one = e1rmChartModel([rising[0]], 'bench-press-barbell');
  // One session logs two sets at the same load, so there is a single distinct
  // point per set — both land on the same e1RM and the band stays undrawn.
  assert.equal(one.band, null);
});

test('e1rm model draws points, a trend line and a confidence band', ()=>{
  const model = e1rmChartModel(rising, 'bench-press-barbell', { width: 200, height: 50 });
  assert.equal(model.n, 8); // two logged sets per session
  assert.equal(model.points.length, 8);
  assert.ok(model.line.startsWith('M'));
  assert.ok(model.trend.startsWith('M'));
  assert.ok(model.band.endsWith('Z'), 'band is a closed polygon');
  assert.ok(model.slope > 0, 'rising loads give a positive slope');
  assert.ok(model.bandHalfKg >= 0);
  assert.match(model.summary, /rising/);
  assert.match(model.summary, /not a prediction/);
});

test('e1rm points stay inside the frame', ()=>{
  const model = e1rmChartModel(rising, 'bench-press-barbell', { width: 200, height: 50, pad: 5 });
  for(const p of model.points){
    assert.ok(p.x >= 5 && p.x <= 195, `x ${p.x} within frame`);
    assert.ok(p.y >= 5 && p.y <= 45, `y ${p.y} within frame`);
  }
});

test('a flat series still renders without dividing by zero', ()=>{
  const flat = [1, 2, 3].map((n, i)=> session(`f${n}`, `2026-02-0${i + 1}`, [block('bench-press-barbell', [set(5, 50)])]));
  const model = e1rmChartModel(flat, 'bench-press-barbell');
  assert.equal(model.n, 3);
  for(const p of model.points) assert.ok(Number.isFinite(p.y));
  assert.match(model.summary, /flat/);
});

test('stacked volume buckets sets per week per muscle and skips cardio', ()=>{
  const history = [
    session('a', '2026-01-05', [block('bench-press-barbell', [set(8, 60), set(8, 60)]), block('run-easy', [set(1, 0)])]),
    session('b', '2026-01-07', [block('barbell-squat', [set(5, 80)])]),
    session('c', '2026-01-14', [block('bench-press-barbell', [set(8, 60)])]),
  ];
  const model = stackedVolumeModel(history, byId, { width: 100, height: 40 });
  assert.equal(model.weeks.length, 2, 'two distinct training weeks');
  assert.equal(model.weeks[0].total, 3, 'two chest sets plus one leg set; cardio excluded');
  assert.ok(!model.muscles.some(m=> m.muscle === 'Cardio'));
  assert.equal(model.max, 3);
  const chest = model.muscles.find(m=> m.muscle === 'Chest');
  assert.equal(chest.sets, 3);
});

test('stacked volume segments stack without overlapping', ()=>{
  const history = [session('a', '2026-01-05', [
    block('bench-press-barbell', [set(8, 60), set(8, 60)]),
    block('barbell-squat', [set(5, 80), set(5, 80)]),
  ])];
  const model = stackedVolumeModel(history, byId, { width: 100, height: 40 });
  const [bar] = model.weeks;
  assert.equal(bar.segments.length, 2);
  const [first, second] = bar.segments;
  // Segments are laid bottom-up: the second sits directly on top of the first.
  assert.ok(Math.abs((second.y + second.h) - first.y) < 0.5);
  assert.ok(first.y + first.h <= model.height + 0.5);
});

test('stacked volume flags muscles in the high landmark band', ()=>{
  // Twelve chest sets a week for four weeks clears the `high` landmark.
  const history = [];
  for(let week = 0; week < 4; week++){
    const day = 5 + week * 7;
    history.push(session(`w${week}`, `2026-01-${String(day).padStart(2, '0')}`, [
      block('bench-press-barbell', Array.from({ length: 12 }, ()=> set(8, 60))),
    ]));
  }
  const model = stackedVolumeModel(history, byId);
  const chest = model.muscles.find(m=> m.muscle === 'Chest');
  assert.equal(chest.band, 'high');
  assert.equal(chest.breach, true);
  assert.match(model.summary, /high landmark band/);
  assert.ok(model.weeks.every(w=> w.segments.every(s=> s.breach === true)));
});

test('stacked volume is empty-safe', ()=>{
  const model = stackedVolumeModel([], byId);
  assert.deepEqual(model.weeks, []);
  assert.match(model.summary, /No sets logged/);
});

test('adherence strip classifies done, missed and upcoming', ()=>{
  const schedule = { sessions: [
    { id: 'p1', dateISO: '2026-01-05', title: 'Push' },
    { id: 'p2', dateISO: '2026-01-07', title: 'Pull' },
    { id: 'p3', dateISO: '2026-01-09', title: 'Legs' },
    { id: 'p4', dateISO: '2026-01-12', title: 'Push' },
  ] };
  const history = [session('p1', '2026-01-05', [])];
  const model = adherenceStripModel(schedule, history, { today: '2026-01-10' });
  assert.deepEqual(model.cells.map(c=> c.state), ['done', 'missed', 'missed', 'upcoming']);
  assert.equal(model.done, 1);
  assert.equal(model.missed, 2);
  assert.equal(model.upcoming, 1);
  // Upcoming sessions never lower the rate: 1 of the 3 already due.
  assert.equal(model.rate, 0.33);
  assert.match(model.summary, /still upcoming/);
});

test('adherence strip honours a session already marked done', ()=>{
  const schedule = { sessions: [{ id: 'p1', dateISO: '2026-01-05', status: 'done' }] };
  const model = adherenceStripModel(schedule, [], { today: '2026-01-10' });
  assert.equal(model.cells[0].state, 'done');
  assert.equal(model.rate, 1);
});

test('adherence strip reports no rate before anything is due', ()=>{
  const schedule = { sessions: [{ id: 'p1', dateISO: '2026-02-05' }] };
  const model = adherenceStripModel(schedule, [], { today: '2026-01-10' });
  assert.equal(model.rate, null);
  assert.match(model.summary, /None are due yet/);
});

test('adherence strip is empty-safe', ()=>{
  const model = adherenceStripModel(null, null);
  assert.deepEqual(model.cells, []);
  assert.match(model.summary, /No programme scheduled/);
});

test('strip cells fill the width in date order', ()=>{
  const schedule = { sessions: [
    { id: 'b', dateISO: '2026-01-09' },
    { id: 'a', dateISO: '2026-01-05' },
  ] };
  const model = adherenceStripModel(schedule, [], { today: '2026-01-10', width: 100, gap: 0 });
  assert.deepEqual(model.cells.map(c=> c.id), ['a', 'b']);
  assert.equal(model.cells[0].x, 0);
  assert.equal(model.cells[1].x, 50);
});
