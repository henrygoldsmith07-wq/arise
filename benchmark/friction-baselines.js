// benchmark/friction-baselines.js — executable friction baselines.
//
// docs/friction-baseline.json is SOURCE DATA, not manually maintained claims:
// this module loads it, validates its schema, RECOMPUTES every derived
// statistic (absolute difference, percentage change, direction) from the
// stored baseline/current values, and fails loudly when a stored claim
// disagrees. Live probe measurements are checked against maxAllowed /
// minAllowed guardrails (regressions fail); wall-clock timings are never
// gated (apparatus noise, not human performance).
//
// Pure ESM with no app imports: unit tests and Playwright specs share it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DOC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'friction-baseline.json');
const DIRECTIONS = ['improvement', 'regression', 'held', 'new'];

// Derive delta/direction from a baseline/current pair. A null baseline means
// "first measured here" — no delta exists and none is invented.
export function deriveMetric(baseline, current){
  if(baseline == null) return { deltaAbs: null, deltaPct: null, direction: 'new' };
  const deltaAbs = current - baseline;
  const deltaPct = baseline === 0 ? null : Math.round((deltaAbs / baseline) * 100);
  const direction = deltaAbs < 0 ? 'improvement' : deltaAbs > 0 ? 'regression' : 'held';
  return { deltaAbs, deltaPct, direction };
}

function isNum(v){ return typeof v === 'number' && Number.isFinite(v); }

export function validateBaselines(doc){
  if(!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('friction baselines: document must be an object');
  if(!doc.flows || typeof doc.flows !== 'object' || Array.isArray(doc.flows) || !Object.keys(doc.flows).length){
    throw new Error('friction baselines: missing non-empty "flows" object');
  }
  for(const [flowName, flow] of Object.entries(doc.flows)){
    const where = `flows.${flowName}`;
    if(!flow || typeof flow !== 'object') throw new Error(`friction baselines: ${where} must be an object`);
    if(!flow.metrics || typeof flow.metrics !== 'object' || Array.isArray(flow.metrics) || !Object.keys(flow.metrics).length){
      throw new Error(`friction baselines: ${where} needs a non-empty "metrics" object`);
    }
    for(const [metric, m] of Object.entries(flow.metrics)){
      const at = `${where}.metrics.${metric}`;
      if(!m || typeof m !== 'object') throw new Error(`friction baselines: ${at} must be an object`);
      if(m.baseline !== null && m.baseline !== undefined && !isNum(m.baseline)){
        throw new Error(`friction baselines: ${at}.baseline must be a finite number or null`);
      }
      if(!isNum(m.current)) throw new Error(`friction baselines: ${at}.current must be a finite number`);
      const baseline = m.baseline ?? null;
      const derived = deriveMetric(baseline, m.current);
      if(m.deltaAbs !== derived.deltaAbs){
        throw new Error(`friction baselines: ${at}.deltaAbs claims ${m.deltaAbs} but baseline/current recompute to ${derived.deltaAbs}`);
      }
      if(m.deltaPct !== derived.deltaPct){
        throw new Error(`friction baselines: ${at}.deltaPct claims ${m.deltaPct} but baseline/current recompute to ${derived.deltaPct}`);
      }
      if(m.direction !== derived.direction){
        throw new Error(`friction baselines: ${at}.direction claims ${m.direction} but recomputes to ${derived.direction}`);
      }
      if(m.maxAllowed !== undefined && !isNum(m.maxAllowed)){
        throw new Error(`friction baselines: ${at}.maxAllowed must be a finite number`);
      }
      if(m.minAllowed !== undefined && !isNum(m.minAllowed)){
        throw new Error(`friction baselines: ${at}.minAllowed must be a finite number`);
      }
    }
  }
  return doc;
}

export function loadBaselines(docPath = DOC_PATH){
  let raw;
  try{ raw = fs.readFileSync(docPath, 'utf8'); }
  catch(err){ throw new Error(`friction baselines: cannot read ${docPath}: ${err.message}`); }
  let doc;
  try{ doc = JSON.parse(raw); }
  catch(err){ throw new Error(`friction baselines: invalid JSON in ${docPath}: ${err.message}`); }
  return validateBaselines(doc);
}

// Check one live probe result against the validated doc. Every live metric
// must exist in the doc (no unbaselined numbers) and every doc metric for
// the flow must be reported live (no stale entries); guardrails fail loudly.
// Returns the report with LIVE-derived deltas — never wall-clock timings.
export function checkLive(doc, flowName, live){
  const flow = doc?.flows?.[flowName];
  if(!flow) throw new Error(`friction baselines: unknown flow "${flowName}"`);
  if(!live || typeof live !== 'object') throw new Error(`friction baselines: live result for "${flowName}" must be an object`);
  for(const key of Object.keys(live)){
    if(!(key in flow.metrics)) throw new Error(`friction baselines: unbaselined live metric "${flowName}.${key}" — add it to docs/friction-baseline.json`);
  }
  const metrics = {};
  for(const key of Object.keys(flow.metrics)){
    if(!(key in live)) throw new Error(`friction baselines: stale entry "${flowName}.${key}" — the probe no longer reports it`);
    const value = live[key];
    if(!isNum(value)) throw new Error(`friction baselines: live "${flowName}.${key}" must be a finite number, got ${value}`);
    const { maxAllowed, minAllowed, baseline } = flow.metrics[key];
    if(maxAllowed !== undefined && value > maxAllowed){
      throw new Error(`friction regression: "${flowName}.${key}" measured ${value} exceeds maxAllowed ${maxAllowed} (baseline ${baseline})`);
    }
    if(minAllowed !== undefined && value < minAllowed){
      throw new Error(`friction regression: "${flowName}.${key}" measured ${value} below minAllowed ${minAllowed} (baseline ${baseline})`);
    }
    metrics[key] = { baseline: baseline ?? null, current: value, ...deriveMetric(baseline ?? null, value) };
  }
  return { flow: flowName, metrics };
}

export function formatReport(report){
  const lines = [`friction ${report.flow}:`];
  for(const [key, m] of Object.entries(report.metrics)){
    const delta = m.deltaAbs == null ? 'n/a' : `${m.deltaAbs >= 0 ? '+' : ''}${m.deltaAbs}`;
    const pct = m.deltaPct == null ? 'n/a' : `${m.deltaPct}%`;
    lines.push(`  ${key}: baseline=${m.baseline} current=${m.current} delta=${delta} (${pct}) ${m.direction}`);
  }
  return lines.join('\n');
}
