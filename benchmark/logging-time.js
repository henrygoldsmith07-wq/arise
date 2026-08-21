import { loggingTimeStats } from '../src/lib/telemetry.js';

// Deterministic smoke benchmark for the metric calculation. Real gym runs
// replace this sample with exported set:complete events from consenting users.
const elapsedMs=[2100,2800,3200,3600,4100,4700,5200,6100,7200,8800,10300,12600];
const result=loggingTimeStats(elapsedMs.map((value,i)=> ({ type:'set:complete', id:`sample-${i}`, elapsedMs:value })));
console.log(`Logging-time benchmark: n=${result.n}, median=${result.medianMs}ms, p90=${result.p90Ms}ms, <=10s=${result.under10sPct}%`);
if(result.p90Ms > 15000) process.exitCode=1;
