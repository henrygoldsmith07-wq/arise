import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runPulseIntegrationE2E } from '../src/lib/pulse.js';
import { mergeHealthSummary, normaliseHealthSummary, pullHealthSummary } from '../src/lib/health.js';
import { loggingTimeStats, recommendationAcceptanceStats, workoutCompletionStats } from '../src/lib/telemetry.js';

const session={ id:'s1', dateISO:'2026-08-19', title:'Gym test', blocks:[{ exerciseId:'push-up', sets:[{ reps:'10', weightKg:'' }] }], savedAt:'2026-08-19T10:00:00Z' };

describe('Pulse integration', ()=>{
  it('runs the write/read E2E path with a mock adapter', async()=>{
    const calls=[];
    const adapter={
      pushWorkout:async payload=> calls.push(['workout',payload.id]),
      pushVolume:async payload=> calls.push(['volume',payload.totalVolumeKg]),
      pullMetrics:async()=> ({ steps:7200, sleepHours:7.5 }),
    };
    const result=await runPulseIntegrationE2E({ session, history:[session], adapter });
    assert.equal(result.ok,true);
    assert.deepEqual(calls.map(c=>c[0]),['workout','volume']);
    assert.equal(result.metrics.steps,7200);
  });

  it('reports partial connector failure', async()=>{
    const result=await runPulseIntegrationE2E({ session, history:[], adapter:{ pushWorkout:async()=>{}, pushVolume:async()=>{ throw new Error('offline'); } } });
    assert.equal(result.ok,false);
    assert.equal(result.pushed.volume.ok,false);
  });
});

describe('optional health summary', ()=>{
  it('normalises and merges a small summary', async()=>{
    const pulled=await pullHealthSummary({ source:'test-watch', pullSummary:async()=> ({ steps:'8000', sleepHours:'7.25', weightKg:'72' }) });
    assert.equal(pulled.ok,true);
    const merged=mergeHealthSummary(null,pulled.summary);
    assert.equal(merged.source,'test-watch');
    assert.equal(merged.steps,8000);
    assert.equal(normaliseHealthSummary({ note:'no metrics' }),null);
  });
});

describe('measurement summaries', ()=>{
  it('deduplicates resumed sessions for abandonment measurement', ()=>{
    const stats=workoutCompletionStats([
      { type:'session:start', sessionId:'s1' },
      { type:'session:resume', sessionId:'s1' },
      { type:'session:abandon', sessionId:'s1' },
    ]);
    assert.equal(stats.started,1);
    assert.equal(stats.abandoned,1);
    assert.equal(stats.abandonmentRate,1);
  });

  it('measures recommendation acceptance and logging time', ()=>{
    const events=[
      { type:'recommendation:shown' }, { type:'recommendation:accepted' }, { type:'recommendation:shown' }, { type:'recommendation:dismissed' },
      { type:'set:complete', elapsedMs:2000 }, { type:'set:complete', elapsedMs:12000 }, { type:'set:complete', elapsedMs:4000 },
    ];
    assert.equal(recommendationAcceptanceStats(events).acceptanceRate,0.5);
    const logging=loggingTimeStats(events);
    assert.equal(logging.n,3);
    assert.equal(logging.medianMs,4000);
    assert.equal(logging.p90Ms,12000);
    assert.equal(logging.under10sPct,67);
  });
});
