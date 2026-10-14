// weeklyReviewMarkdown.js — backlog item 6: Weekly Review Markdown export.
//
// The Weekly Review card already computes everything a lifter would want to
// keep or share: completion, volume, per-exercise comparisons, the engine's
// findings, the graduated readiness read and next week's directives with
// reasons. This module turns that computed shape into Markdown — pure text
// in, pure text out, no network, no storage, no exercise catalogue. Any
// device that can paste text can archive a week, which is exactly the
// local-first posture of the product: your record, your format.
//
// Why the builder is fed PRE-PLANED strings (names already resolved, numbers
// already formatted): it stays dumb and testable, and it can never invent a
// figure the card did not compute. It renders what it is given or nothing.
//
// deferred-no-more: the roadmap deferred this "while the runtime bundle is at
// its product budget": the builder ships as a static-imported pure module of
// a few hundred bytes that rides the already-loaded review card — no new
// chunk, no new dependency.

/** Graduated-readiness recommendation → one honest line. Exported because
 * the review card speaks the SAME wording in its recovery row — one phrase
 * source, no drift between spoken and exported text. */
export function readinessVerdictLabel(rd){
  const rec = rd?.recommendation;
  if(rec === 'genuine-deload') return 'a deload is advised';
  if(rec === 'recovery-session') return 'a recovery session is advised';
  if(rec === 'small-adjustment') return 'a small adjustment is advised';
  if(rec === 'as-planned') return 'recovery supports the plan as written';
  return null;
}

const fmtPct = (v)=> `${v > 0 ? '+' : ''}${v}%`;

/** Malformed input degrades to “section omitted”, never to “undefined”
 * soup or a throw — the export is a convenience and must not become the
 * one place a broken week crashes the card. */
const rowList = (v)=> Array.isArray(v) ? v.filter(Boolean) : [];

/**
 * Build the Markdown document for one reviewed week.
 *
 * @param {object} data  the WeeklyReviewCard's computed shape, all optional:
 *   { weekLabel, reviewedWeekKey, completion:{done,total}, volumeKg,
 *     volumeDelta, improved:[{name,deltaPct,conf}], steady:[{name,note}],
 *     insufficient:[name...], prs, noticed:[string], learned:[{question,
 *     result, confidence, note}], readinessDecision, readinessInWeek:number,
 *     directives:[{text, reason, evidence:[...]}], deloadDecision:{yes,signals} }
 * @returns {string} Markdown. Empty/unavailable sections are omitted, never
 *   rendered as placeholders.
 */
export function buildWeeklyReviewMarkdown(data = {}){
  const improved = rowList(data.improved);
  const steady = rowList(data.steady);
  const insufficient = rowList(data.insufficient);
  const noticed = rowList(data.noticed);
  const learned = rowList(data.learned);
  const directives = rowList(data.directives);
  const lines = [];
  lines.push('# Arise weekly review');
  lines.push('');
  if(data.weekLabel) lines.push(`Week: ${data.weekLabel}`);
  else if(data.reviewedWeekKey) lines.push(`Week: ${data.reviewedWeekKey}`);

  // ── What happened ──
  const done = data.completion?.done, total = data.completion?.total;
  const didBits = [];
  if(done != null && total != null) didBits.push(`${done}/${total} workouts completed`);
  if(data.volumeKg != null) didBits.push(`${data.volumeKg.toLocaleString()} kg of work`);
  if(data.volumeDelta != null) didBits.push(`${fmtPct(data.volumeDelta)} volume vs last week`);
  if(didBits.length){
    lines.push('');
    lines.push('## What happened');
    lines.push(`- ${didBits.join(' · ')}`);
  }

  // ── Did I improve? ──
  const trendLines = [
    ...improved.map(r => `- ${r.name} ↑ ${r.deltaPct}%${r.conf ? ` (${r.conf} confidence)` : ''}`),
    ...steady.map(r => `- ${r.name} — ${r.note}`),
    ...(insufficient.length ? [`- No clear trend yet on ${insufficient.slice(0, 3).join(', ')}`] : []),
    ...(data.prs ? [`- 🏆 ${data.prs} new personal best${data.prs === 1 ? '' : 's'} (best estimated 1RM on the day's top set)`] : []),
  ];
  if(trendLines.length){
    lines.push('');
    lines.push('## Did I improve?');
    lines.push(...trendLines);
  }

  // ── What Arise noticed ──
  if(noticed.length){
    lines.push('');
    lines.push('## What Arise noticed');
    lines.push(...noticed.slice(0, 6).map(n => `- ${n}`));
  }

  // ── What Arise learned (own concluded experiments only) ──
  const usableLearned = learned.filter(l => l?.question || l?.result);
  if(usableLearned.length){
    lines.push('');
    lines.push('## What Arise learned');
    lines.push(...usableLearned.map(l =>
      `- “${l.question || 'Training experiment'}” → ${l.result || 'inconclusive'} (${l.confidence || 'low'} confidence)${l?.note ? `: ${l.note}` : ''}`));
  }

  // ── Recovery read (graded engine verdict, verbatim) ──
  const rd = data.readinessDecision;
  const verdict = readinessVerdictLabel(rd);
  const recBits = [];
  if(verdict){
    let line = `Verdict: ${verdict}`;
    if(rd.score != null) line += ` — ${rd.score} pts, ${rd.confidence || 'low'} confidence`;
    recBits.push(line);
    if(Array.isArray(rd.factors) && rd.factors.length){
      recBits.push(`Based on: ${rd.factors.slice(0, 4).join('; ')}.`);
    }
    if(rd.action) recBits.push(rd.action);
  }
  if(data.readinessInWeek != null){
    recBits.push(data.readinessInWeek > 0
      ? `${data.readinessInWeek} readiness check-in${data.readinessInWeek === 1 ? '' : 's'} logged this week.`
      : 'No check-ins logged this week — the read leans on the surrounding log.');
  }
  if(recBits.length){
    lines.push('');
    lines.push('## Recovery read');
    lines.push(...recBits.map(b => `- ${b}`));
  }

  // ── Next week ──
  if(directives.length){
    lines.push('');
    lines.push('## Next week');
    lines.push(...directives.slice(0, 10).map(d => {
      if(!d?.text) return null;
      let line = `- ${d.text}`;
      if(line.split(' — ').length === 1 && d.reason) line = `- ${d.text} — ${d.reason}`;
      return line;
    }).filter(Boolean));
  }
  if(data.deloadDecision?.yes){
    lines.push('');
    lines.push('Next week is a planned deload — volume is cut on purpose.');
  }

  lines.push('');
  lines.push('_Generated on-device by Arise from your own logs — every line traces to what the engines decided._');
  return lines.join('\n');
}
