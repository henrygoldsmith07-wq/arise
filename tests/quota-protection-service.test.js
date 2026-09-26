import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { checkQuotaProtection } from '../src/lib/quotaGuard.js';

describe('quota protection service', ()=>{
  it('keeps health reading and prompt evaluation in one runtime boundary', async ()=>{
    const calls = [];
    const result = await checkQuotaProtection({
      lastPromptedLevel:null,
      readHealth:async ()=> { calls.push('health'); return { level:'warning', ratio:0.84 }; },
      snapshotCritical:async ()=> { calls.push('snapshot'); return true; },
    });

    assert.deepEqual(result.decision, { shouldPrompt:true, level:'warning', reason:'storage-warning' });
    assert.equal(result.snapshotCaptured, false);
    assert.deepEqual(calls, ['health']);
  });

  it('attempts the safety snapshot exactly once on a new critical prompt', async ()=>{
    let snapshots = 0;
    const result = await checkQuotaProtection({
      lastPromptedLevel:'warning',
      readHealth:async ()=> ({ level:'critical', ratio:0.97 }),
      snapshotCritical:async (health)=> { snapshots++; assert.equal(health.level, 'critical'); return true; },
    });

    assert.equal(snapshots, 1);
    assert.equal(result.snapshotCaptured, true);
  });

  it('reports snapshot failure honestly instead of claiming protection', async ()=>{
    const result = await checkQuotaProtection({
      readHealth:async ()=> ({ level:'critical' }),
      snapshotCritical:async ()=> false,
    });
    assert.equal(result.snapshotCaptured, false);
  });

  it('does not snapshot when the same critical level was already prompted', async ()=>{
    let snapshots = 0;
    const result = await checkQuotaProtection({
      lastPromptedLevel:'critical',
      readHealth:async ()=> ({ level:'critical' }),
      snapshotCritical:async ()=> { snapshots++; return true; },
    });
    assert.equal(result.decision.shouldPrompt, false);
    assert.equal(snapshots, 0);
  });

  it('does not snapshot when the owning UI effect was cancelled mid-check', async ()=>{
    let active = true;
    let snapshots = 0;
    const result = await checkQuotaProtection({
      readHealth:async ()=> {
        active = false;
        return { level:'critical' };
      },
      isActive:()=> active,
      snapshotCritical:async ()=> { snapshots++; return true; },
    });
    assert.equal(result.decision.reason, 'cancelled');
    assert.equal(snapshots, 0);
  });
});
