import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveXp, xpAwards, xpForLevel, levelForXp, XP_SOURCES } from '../src/lib/xp.js';
import { strengthTrends, workCapacity, consistencyReport, confidenceLanguage } from '../src/lib/performance.js';

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

  it('translates confidence into human language at every level', ()=>{
    assert.match(confidenceLanguage('low', 'only two comparable sessions'), /only two comparable sessions/);
    assert.match(confidenceLanguage('high', 'repeated performance at this load supports the increase'), /supports the increase/);
  });
});
