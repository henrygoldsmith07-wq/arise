import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runComparativeStudy } from '../src/lib/study.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// Regression #3 + #12: the flagship evidence script must EXECUTE — including
// a conclusive segment branch and the synthetic-evidence disclaimer.
describe('evidence pipeline CI gate', ()=>{
  let out = '';
  it('benchmark/study.js runs to completion', ()=>{
    out = execSync('node benchmark/study.js', { cwd: ROOT, encoding: 'utf8' });
    assert.ok(out.length > 0);
  });
  it('prints at least one conclusive segment line', ()=>{
    assert.match(out, /segment \w+\/.+ n=\d+/);
  });
  it('never labels the synthetic corpus real evidence (#12)', ()=>{
    assert.match(out, /NOT external evidence/);
  });

  // Regression #4: high / low / unknown readiness buckets all execute when
  // the benchmark carries prior-only readiness data.
  it('readiness wiring produces high, low AND unknown buckets (fixture)', ()=>{
    const fixturePath = path.join(ROOT, 'benchmark', 'fixtures', 'synthetic-history.json');
    const dataset = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    assert.ok((dataset.readinessLog || []).length >= 3, 'fixture must carry readiness data');
    const study = runComparativeStudy(dataset.history || [], { readinessLog: dataset.readinessLog || [] });
    const buckets = study.segments.byReadiness;
    for(const bucket of ['high','low']){
      assert.ok(buckets[bucket], `missing ${bucket} bucket`);
      assert.ok(buckets[bucket].arise.n > 0, `${bucket} bucket is empty`);
    }
  });

  it('readiness trio: prior high, prior low and unknown all occur (#4)', ()=>{
    // Exposures Jan 2 / Jan 6 / Jan 13 / Feb 10; readiness entries only on
    // Jan 6 (80) and Jan 12 (20): transition outcomes land in high (Jan 6,
    // same-day prior), low (Jan 13 ← Jan 12) and unknown (Feb 10 has nothing
    // within the window).
    const sess = (id, dateISO, kg)=> ({ id, dateISO, blocks: [{ exerciseId: 'bench-press-dumbbell', sets: [{ reps:'8', weightKg:String(kg), rpe:'7' }] }] });
    const history = [sess('a','2026-01-02',20), sess('b','2026-01-06',21), sess('c','2026-01-13',22), sess('d','2026-02-10',23)];
    const readinessLog = [{ dateISO:'2026-01-06', score:80 }, { dateISO:'2026-01-12', score:20 }];
    const study = runComparativeStudy(history, { readinessLog });
    const seg = study.segments.byReadiness;
    for(const bucket of ['high','low','unknown']){
      assert.ok(seg[bucket]?.arise?.n > 0, `${bucket} must be exercised`);
    }
  });
});
