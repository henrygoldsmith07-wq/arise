import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveXp, xpAwards, xpForLevel, levelForXp, XP_SOURCES } from '../src/lib/xp.js';
import { strengthTrends, workCapacity, consistencyReport, confidenceLanguage, personalBests } from '../src/lib/performance.js';

function session(id, dateISO, sets, title = id){
  return { id, dateISO, title, blocks:[{ exerciseId:'bench-press-dumbbell', sets }] };
}
function set(reps, kg, extra = {}){
  return { reps:String(reps), weightKg:String(kg), completed:true, ...extra };
}
function schedule(entries){
  return { programId:'p1', sessions:entries.map((e, i)=> ({ id:`s${i}`, week:1, dateISO:e, status:'done', title:`Plan ${i}` })) };
}

describe('Arise XP: motivation from observable behaviour', ()=>{
  it('never claims to measure fitness — the framing says so', ()=>{
    const xp = deriveXp({ history:[] });
    assert.match(xp.framing, /motivation/i);
    assert.match(xp.framing, /not a measure of fitness/i);
  });

  it('awards XP for completing a planned workout and logging well', ()=>{
    const hist = [session('s1', '2026-09-01', [set(8, 20), set(8, 20)], 'Plan 0')];
    const sched = schedule(['2026-09-01']);
    const awards = xpAwards({ history:hist, schedule:sched });
    const labels = awards.map((a)=> a.label);
    assert.ok(labels.includes(XP_SOURCES.sessionCompleted.label));
    assert.ok(labels.includes(XP_SOURCES.fullLogging.label));
    // every award explains itself
    for(const a of awards) assert.ok(a.why && a.why.length > 0);
  });

  it('treats an unlogged plan as its own, lower award', ()=>{
    const hist = [session('free', '2026-09-01', [set(8, 20)], 'Free session')];
    const awards = xpAwards({ history:hist, schedule:schedule([]) });
    assert.ok(awards.some((a)=> a.label === XP_SOURCES.unplannedSession.label));
    assert.ok(!awards.some((a)=> a.label === XP_SOURCES.sessionCompleted.label));
  });

  it('acknowledges returning after a break without guilt-trip language', ()=>{
    const hist = [
      session('s1', '2026-09-01', [set(8, 20)]),
      session('s2', '2026-09-22', [set(8, 20)]),
    ];
    const awards = xpAwards({ history:hist });
    const back = awards.find((a)=> a.label === XP_SOURCES.returnedAfterBreak.label);
    assert.ok(back, 'break return should be acknowledged');
    assert.match(back.why, /Back after/);
  });

  it('grants a full-week award only when every planned session happened', ()=>{
    const done = schedule(['2026-09-01', '2026-09-03', '2026-09-05']);
    const hist = ['2026-09-01', '2026-09-03', '2026-09-05'].map((d, i)=> session(`h${i}`, d, [set(8, 20)], `Plan ${i}`));
    assert.ok(xpAwards({ history:hist, schedule:done }).some((a)=> a.label === XP_SOURCES.weekCompleted.label));
    assert.ok(!xpAwards({ history:hist.slice(0, 2), schedule:done }).some((a)=> a.label === XP_SOURCES.weekCompleted.label));
  });

  it('levels up on a gentle monotone curve and reports progress to next', ()=>{
    assert.equal(levelForXp(0).level, 1);
    assert.equal(levelForXp(xpForLevel(3) - 1).level, 2);
    assert.equal(levelForXp(xpForLevel(3)).level, 3);
    const mid = levelForXp(xpForLevel(2) + 125);
    assert.equal(mid.xpIntoLevel, 125);
    assert.equal(mid.xpForNext, xpForLevel(3) - xpForLevel(2));
  });

  it('derives deterministic, replayable totals with recent reasons', ()=>{
    const input = {
      history:[session('s1', '2026-09-01', [set(8, 20)]), session('s2', '2026-09-03', [set(8, 20)])],
      schedule:null,
    };
    const first = deriveXp(input);
    const second = deriveXp(input);
    assert.equal(first.totalXp, second.totalXp);
    assert.ok(first.recent.length > 0);
    for(const r of first.recent) assert.ok(r.why && r.xp > 0);
  });
});

describe('performance metrics: evidence or honest silence', ()=>{
  it('refuses to call a trend with too few comparable sessions', ()=>{
    const hist = [session('s1', '2026-09-01', [set(8, 40)])];
    const [trend] = strengthTrends({ history:hist, exerciseIds:['bench-press-dumbbell'] });
    assert.equal(trend.status, 'insufficient');
    assert.match(trend.explanation, /at least 3 comparable sessions/);
  });

  it('claims improvement only with enough exposures and a meaningful move', ()=>{
    const hist = [
      session('s1', '2026-09-01', [set(8, 40)]),
      session('s2', '2026-09-05', [set(8, 40)]),
      session('s3', '2026-09-09', [set(8, 44)]),
      session('s4', '2026-09-13', [set(8, 46)]),
    ];
    const [trend] = strengthTrends({ history:hist, exerciseIds:['bench-press-dumbbell'] });
    assert.equal(trend.status, 'improving');
    assert.match(trend.explanation, /Estimated 1RM rose/);
    assert.ok(['medium', 'high'].includes(trend.confidence));
  });

  it('calls a flat trend flat — no manufactured confidence', ()=>{
    const hist = [
      session('s1', '2026-09-01', [set(8, 40)]),
      session('s2', '2026-09-05', [set(8, 40)]),
      session('s3', '2026-09-09', [set(8, 40)]),
    ];
    const [trend] = strengthTrends({ history:hist, exerciseIds:['bench-press-dumbbell'] });
    assert.equal(trend.status, 'stable');
  });

  it('ignores failed and skipped sets when estimating strength', ()=>{
    const hist = [
      session('s1', '2026-09-01', [set(8, 40)]),
      session('s2', '2026-09-05', [set(8, 40), set(2, 80, { failed:true })]),
      session('s3', '2026-09-09', [set(8, 40)]),
    ];
    const [trend] = strengthTrends({ history:hist, exerciseIds:['bench-press-dumbbell'] });
    assert.equal(trend.status, 'stable', 'a failed single must not read as a strength gain');
  });

  it('measures work capacity as recent average, never lifetime totals', ()=>{
    const hist = [
      session('s1', '2026-09-01', [set(10, 20)]),
      session('s2', '2026-09-05', [set(10, 20)]),
    ];
    const cap = workCapacity({ history:hist });
    assert.equal(cap.avgVolumeKg, 200);
    assert.equal(cap.sessionsMeasured, 2);
    assert.equal(cap.confidence, 'low');
    assert.match(cap.explanation, /average/);
  });

  it('scores consistency against the user plan, including post-miss recovery', ()=>{
    // Only the first plan row is marked done; the middle is missed outright.
    const sched = {
      programId:'p1',
      sessions:[
        { id:'s0', week:1, dateISO:'2026-09-01', status:'done', title:'Plan 0' },
        { id:'s1', week:1, dateISO:'2026-09-03', status:'planned', title:'Plan 1' },
        { id:'s2', week:1, dateISO:'2026-09-05', status:'planned', title:'Plan 2' },
      ],
    };
    const hist = [
      session('h0', '2026-09-01', [set(8, 20)], 'Plan 0'),
      session('h1', '2026-09-06', [set(8, 20)], 'Plan 2'),
    ];
    const report = consistencyReport({ history:hist, schedule:sched, today:'2026-09-07' });
    assert.equal(report.planned, 3);
    assert.equal(report.completed, 2);
    assert.equal(report.returnedAfterMiss, true);
    assert.match(report.explanation, /completed 2 of 3 planned sessions/i);
  });

  it('a single make-up log satisfies at most one planned session (regression: one log claimed 100%)', ()=>{
    // Two same-title planned sessions; ONE logged make-up. The old
    // `logged.some(...)` scan matched the log against BOTH planned rows, so
    // one workout reported 100% adherence and zero misses.
    const sched = {
      programId:'p1',
      sessions:[
        { id:'s1', week:1, dateISO:'2026-09-01', status:'planned', title:'Push' },
        { id:'s2', week:1, dateISO:'2026-09-09', status:'planned', title:'Push' },
      ],
    };
    const oneMakeUp = [session('h1', '2026-09-11', [set(8, 20)], 'Push')];
    const single = consistencyReport({ history:oneMakeUp, schedule:sched, today:'2026-09-13' });
    assert.equal(single.planned, 2);
    assert.equal(single.completed, 1, 'one log satisfies one planned session');
    assert.equal(single.missed, 1);
    assert.equal(single.adherencePct, 50);
    assert.match(single.explanation, /completed 1 of 2 planned sessions/i);

    // Two make-ups (one per missed date) still count both — the fix must not
    // under-count real work. Logs must land AFTER their own planned date and
    // within 7 days of it: 09-03 and 09-06 each satisfy one plan.
    const twoMakeUps = [
      session('h1', '2026-09-03', [set(8, 20)], 'Push'),
      session('h2', '2026-09-06', [set(8, 20)], 'Push'),
    ];
    const spreadPlan = {
      programId:'p1',
      sessions:[
        { id:'s1', week:1, dateISO:'2026-09-01', status:'planned', title:'Push' },
        { id:'s2', week:1, dateISO:'2026-09-05', status:'planned', title:'Push' },
      ],
    };
    const both = consistencyReport({ history:twoMakeUps, schedule:spreadPlan, today:'2026-09-13' });
    assert.equal(both.planned, 2);
    assert.equal(both.completed, 2, 'one make-up per missed session still completes both');
    assert.equal(both.missed, 0);
    assert.equal(both.adherencePct, 100);
    assert.equal(both.onTime, 0);
  });

  it('personalBests names which dimension moved: rep PR at same load beats the generic label', ()=>{
    // compareSets reads the PRIOR set, which bestByExercise never stored, so
    // every PR degraded to 'Estimated 1RM PR' regardless of what improved.
    const history = [
      { dateISO:'2026-01-01', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'8', weightKg:'100' }] }] },
      { dateISO:'2026-01-08', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'9', weightKg:'100' }] }] },
      { dateISO:'2026-01-15', blocks:[{ exerciseId:'bench-press-dumbbell', sets:[{ reps:'9', weightKg:'105' }] }] },
    ];
    const prs = personalBests({ history });
    const byDate = new Map(prs.map(p=> [p.dateISO, p]));
    assert.equal(byDate.get('2026-01-08').kind, 'Rep PR at same load',
      'same load, more reps must be named as a rep PR');
    assert.equal(byDate.get('2026-01-15').kind, 'Load PR at comparable reps',
      'more load at equal reps must be named as a load PR');
  });

  it('translates confidence into human language at every level', ()=>{
    assert.match(confidenceLanguage('low', 'only two comparable sessions'), /only two comparable sessions/);
    assert.match(confidenceLanguage('high', 'repeated performance at this load supports the increase'), /supports the increase/);
  });
});
