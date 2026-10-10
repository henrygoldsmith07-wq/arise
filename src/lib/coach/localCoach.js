// localCoach.js — the offline coach.
//
// WHY THIS EXISTS
// ---------------
// The remote LLM coach is optional by design (see aiCoach.js): the shipped
// default compiles it out and no key is present, so any request that needs the
// cloud dead-ends on "not available in this build". That was fine when the only
// question worth asking was "phrase my findings for me", but the app already
// computes a complete, structured, evidence-tagged coaching state on device —
// buildCoachingState() — and it was never used to answer anything. The richest
// intelligence in the product was disconnected from the only conversational
// surface it had.
//
// This module closes that gap. It composes a real, specific answer from the
// deterministic engines:
//
//   question → intent → the engine's own findings for that intent → prose
//
// HARD CONTRACT (the same one the LLM prompt enforces)
// ----------------------------------------------------
// It never invents, modifies or suggests a prescription, load, set or
// programme change. It only restates what the engines decided, plus the
// evidence they used. Every claim it makes is traceable to a field in the
// coaching state. If the engines have nothing to say, it says so instead of
// filling the silence — an honest "I don't have enough logged to answer that"
// is the correct answer, and the app's own evidence layer already treats
// manufactured confidence as a defect.
//
// It is pure: same store + question ⇒ same text. No network, no storage, no
// timestamps beyond the ones the engines put in their outputs.

import { buildCoachingState } from './coachingState.js';
import { buildTrainingProfile } from './trainingProfile.js';

// Exercise ID → display label. The full catalogue (data.js) is heavy, so the
// coaching state does not ship exercise names — IDs are unambiguous in the
// answer text and the user can cross-reference the session. If the coaching
// state ever adds names, this is the seam to plug them in.
function exerciseName(id){
  return id ? id.replace(/-/g, ' ') : id;
}

// ── Intent classification ────────────────────────────────────────────────
// Deliberately conservative and explicit: a question that matches no intent
// gets a "here is what I can tell you" answer rather than a guessed one.
// Ordered most-specific first so "why did my bench stall" does not match the
// generic "what should I do" rule.
const INTENTS = [
  {
    id: 'missed',
    re: /\b(missed|miss|skipped?|skip)\b.*\b(session|workout|day|week|past)|(behind|overdue|behind on my)\b/i,
  },
  {
    id: 'exercise',
    re: /\b(my|the)\s+([a-z][a-z0-9\-\s]{2,40}?)\s+(stall|stalled|plateau|stuck|regress|lose|losing|drop|falling|not (?:going|moving|improving))/i,
  },
  {
    id: 'plateau',
    re: /\b(stall|stalled|stuck|plateau|no(t)? (progress|gains?|improving|moving)|not (progressing|improving))\b/i,
  },
  {
    id: 'deload',
    re: /\b(deload|tired|fatigue[ds]?|worn out|jaded|overtrain|need a break|rest week)\b/i,
  },
  {
    id: 'week-review',
    re: /\b(week|last week|past week|my week|summar)/i,
  },
  {
    id: 'today',
    re: /\b(today|tonight|this session|this workout|what(?:'s| is) next|what should i do)\b/i,
  },
  {
    id: 'progress',
    re: /\b(progress|improving|improvement|better|stronger|getting better|am i (getting )?better|trend|results)\b/i,
  },
  {
    id: 'programme',
    re: /\b(programme|program|plan|schedule|rep scheme|why (this|my) (programme|plan))\b/i,
  },
];

export function classifyCoachQuestion(question){
  const text = String(question || '').trim();
  if(!text) return { id: 'empty', matches: [] };
  const matches = INTENTS.filter(intent => intent.re.test(text));
  // multiple intents ⇒ answer the most specific and say which; never blend
  // unrelated findings into one confident paragraph.
  const id = matches.length ? matches[0].id : 'general';
  return { id, matches: matches.map(m => m.id), raw: text };
}

// ── Answer builders ──────────────────────────────────────────────────────
// Each returns an array of paragraphs (strings) or null when the engines have
// nothing to say for that intent. Null ⇒ the caller falls through to the
// honest "not enough logged yet" answer.

function exerciseFromText(text){
  const m = String(text || '').match(/(?:my|the)\s+([a-z][a-z0-9\-\s]{2,40}?)\s+(?:stall|stalled|plateau|stuck|regress|lose|losing|drop|falling|not (?:going|moving|improving))/i);
  return m ? m[1].trim() : null;
}

function answerExercise(question, state){
  const asked = exerciseFromText(question);
  if(!asked) return null;
  const rec = (state.recommendations || []).find(r =>
    r.exerciseId && (
      r.exerciseId.replace(/-/g, ' ').includes(asked.replace(/-/g, ' ')) ||
      asked.replace(/-/g, ' ').includes(r.exerciseId.replace(/-/g, ' ')) ||
      String(r.action || '').toLowerCase().includes(asked.toLowerCase())
    )
  );
  if(!rec){
    // No prescription-level finding for that lift. Say so honestly rather than
    // inventing one — the alternative (a confident guess) is exactly the failure
    // mode the AI prompt is written to prevent.
    const known = (state.recommendations || []).filter(r => r.exerciseId);
    const lines = [`I don't have a finding on "${asked}" in today's plan.`];
    if(known.length){
      lines.push(`What the engine is deciding about today's lifts: ${known.slice(0, 4).map(r => r.action).join('; ')}.`);
    }
    lines.push('If that lift is in your history but not today\'s session, open it in Progress — the exercise history card shows the trend the engine sees.');
    return lines;
  }
  const out = [];
  out.push(`${rec.action}.`);
  if(rec.reason) out.push(`Why: ${rec.reason}`);
  if(rec.previousState) out.push(`Before that: ${rec.previousState}.`);
  if(rec.expectedOutcome) out.push(`What it should achieve: ${rec.expectedOutcome}.`);
  if(rec.basis === 'initial') out.push('This one is on the initial estimate rather than a personalised one — it firms up once you have a few sessions logged on it.');
  return out;
}

function answerPlateau(state){
  const plateaus = (state.recommendations || []).filter(r => r.kind === 'plateau');
  if(!plateaus.length) return null;
  const out = [];
  out.push(`${plateaus.length === 1 ? 'One lift' : `${plateaus.length} lifts`} on today's plan ${plateaus.length === 1 ? 'is' : 'are'} holding, and the engine says it is a genuine plateau rather than a bad day.`);
  for(const p of plateaus.slice(0, 3)){
    out.push(`${p.action}. ${p.reason} Confidence: ${p.confidence}.`);
  }
  out.push('A plateau is a hold and investigate signal, not a reason to add load. The engine keeps the load where it is while recovery, volume and technique get checked.');
  return out;
}

function answerDeload(state){
  const signs = state.signals || state.risks || [];
  const deloadDue = (state.recommendations || []).find(r => r.kind === 'deload');
  if(deloadDue){
    const out = [`${deloadDue.action}.`, deloadDue.reason];
    if(deloadDue.evidence?.length) out.push(`What it is based on: ${deloadDue.evidence.slice(0, 3).join('. ')}.`);
    out.push('A deload is a planned drop in volume, not a loss of progress — the engine picks it up again the week after.');
    return out;
  }
  const fatigue = (state.safety?.items || []).filter(s => /fatigue|tired|effort|load/i.test(s.label || ''));
  if(!signs.length && !fatigue.length) return null;
  const out = ['Nothing on today\'s plan is asking for a deload right now.'];
  if(fatigue.length) out.push(`What the engine is watching: ${fatigue.slice(0, 3).map(f => `${f.label}${f.detail ? ` — ${f.detail}` : ''}`).join('; ')}.`);
  out.push('If you are feeling flat, the honest move is to log the session with real RPE numbers rather than guess a load down — the engine reads effort, not feelings.');
  return out;
}

function answerMissed(state){
  const rec = state.recovery;
  if(!rec?.needed) return null;
  const out = [];
  const n = rec.missedSessions.length;
  out.push(n === 1
    ? 'One session is overdue. It is not debt — nothing doubles up behind it.'
    : `${n} sessions are overdue. They are data, not debt, so nothing doubles up behind them.`);
  if(rec.recommendation) out.push(rec.recommendation);
  if(rec.missedSessions?.length){
    out.push(`Overdue: ${rec.missedSessions.slice(0, 5).map(s => s.title).join(', ')}.`);
  }
  out.push('Your call on how to fold them forward — the schedule keeps its order either way.');
  return out;
}

function answerWeekReview(state, profile){
  const out = [];
  out.push(state.summary);
  if(state.adherence?.sessions){
    const done = state.adherence.sessions.done ?? state.adherence.done ?? null;
    const total = state.adherence.sessions.total ?? state.adherence.total ?? null;
    if(done != null && total != null) out.push(`You have completed ${done} of ${total} planned sessions in this programme.`);
  }
  const adapted = (state.recommendations || []).filter(r => r.kind === 'prescription' && r.adapted?.length);
  if(adapted.length){
    out.push(`${adapted.length === 1 ? 'One lift' : `${adapted.length} lifts`} on today's plan is ${adapted.length === 1 ? 'set' : 'set'} differently from the template because of your own training.`);
  }
  if(state.nextBestAction?.title || state.nextBestAction?.action){
    const a = state.nextBestAction.title || state.nextBestAction.action;
    out.push(`Best next move: ${a}.`);
  }
  if(profile?.rows?.length) out.push(`What Arise uses to decide what to change: ${profile.rows.length} measured pattern${profile.rows.length === 1 ? '' : 's'} about your training.`);
  if(state.confidence) out.push(`Overall confidence in these decisions: ${state.confidence}.`);
  return out;
}

function answerToday(state){
  const next = state.nextSession;
  if(!next?.hero) return null;
  const out = [];
  out.push(state.summary);
  if(next.keyBlocks?.length){
    out.push(`Today's working lifts: ${next.keyBlocks.map(b => `${exerciseName(b.exerciseId)} ${b.sets}×${b.reps}${b.loadHint ? ` @ ${b.loadHint}` : ''}`).join('; ')}.`);
  }
  if(state.focus?.length){
    out.push(`Focus: ${state.focus.map(f => f.text || f.label || String(f)).join(' ')}`);
  }
  return out;
}

function answerProgress(state, profile){
  const out = [];
  if(!profile?.rows?.length) return null;
  out.push(profile.summary);
  // The three rows a "am I improving" question actually needs. Rows carry their
  // own confidence and evidence, so quoting them is quoting the engine.
  const picks = ['training-age', 'consistency', 'progression-rate']
    .map(id => profile.rows.find(r => r.id === id))
    .filter(Boolean);
  for(const row of picks){
    out.push(`${row.label}: ${row.value}. ${row.detail}`);
    const ev = row.evidence?.[0];
    if(ev) out.push(`Evidence: ${ev}`);
  }
  if(state.nextBestAction?.title) out.push(`Best next move: ${state.nextBestAction.title}.`);
  return out;
}

function answerProgramme(state){
  const why = state.programmeWhy;
  const out = [];
  if(why?.reasons?.length){
    out.push(`Your programme was chosen for these reasons:`);
    for(const r of why.reasons.slice(0, 4)) out.push(`- ${r}`);
  } else if(state.currentState?.programmeName){
    out.push(`You are running ${state.currentState.programmeName}. I don't have the original selection reasons stored for this one — they are recorded on newly started programmes.`);
  } else {
    return null;
  }
  if(state.nextWeek?.phase) out.push(`Current phase: ${state.nextWeek.phase}.`);
  if(state.nextWeek?.latestAdaptation?.label){
    out.push(`Most recent change: ${state.nextWeek.latestAdaptation.label}.`);
  }
  return out;
}

function answerGeneral(state, profile){
  // The honest fallback: what the engines can actually tell this user right
  // now, plus where to go. Better than a confident answer about nothing.
  const out = [];
  if(state.summary) out.push(state.summary);
  if(state.nextBestAction?.title) out.push(`Best next move: ${state.nextBestAction.title}.`);
  const rx = (state.recommendations || []).filter(r => r.kind === 'prescription').slice(0, 3);
  if(rx.length) out.push(`What the engine is deciding today: ${rx.map(r => r.action).join('; ')}.`);
  if(profile?.rows?.length) out.push(`What Arise uses to decide what to change: ${profile.rows.length} measured pattern${profile.rows.length === 1 ? '' : 's'} about your training.`);
  out.push('Ask me about your week, a lift that has stalled, whether you are improving, a plateau, or a missed session.');
  return out;
}

// ── The public API ───────────────────────────────────────────────────────

/**
 * Answer a coaching question from the deterministic engines, offline.
 *
 * @param {string} question  the user's prompt
 * @param {object} opts      { store, today, plateConfig }
 * @returns {{ok:true, text:string, intent:string, confidence:string|null, source:'local-coach', evidence:string[]}
 *          |{ok:false, error:string}}
 */
export function localCoachAnswer(question, { store = {}, today = null, plateConfig = null } = {}){
  const { id } = classifyCoachQuestion(question);
  if(id === 'empty') return { ok: false, error: 'Ask a question first.' };

  let state;
  try{
    state = buildCoachingState({ store, today, plateConfig });
  }catch(err){
    return { ok: false, error: `I could not read your training state on this device (${String(err?.message || err).slice(0, 120)}).` };
  }
  let profile = null;
  try{ profile = buildTrainingProfile({ store, today }); }catch{ profile = null; }

  let paragraphs = null;
  switch(id){
    case 'exercise': paragraphs = answerExercise(question, state); break;
    case 'plateau': paragraphs = answerPlateau(state); break;
    case 'deload': paragraphs = answerDeload(state); break;
    case 'missed': paragraphs = answerMissed(state); break;
    case 'week-review': paragraphs = answerWeekReview(state, profile); break;
    case 'today': paragraphs = answerToday(state) || answerGeneral(state, profile); break;
    case 'progress': paragraphs = answerProgress(state, profile) || answerGeneral(state, profile); break;
    case 'programme': paragraphs = answerProgramme(state); break;
    default: paragraphs = answerGeneral(state, profile);
  }

  if(!paragraphs || !paragraphs.filter(Boolean).length){
    return { ok: false, error: 'Not enough logged yet for me to answer that honestly — log a session or two and ask again.' };
  }

  const text = paragraphs.filter(Boolean).join(' ');
  // Evidence travels with the answer so the UI can show provenance, and so a
  // remote model can be held to the same standard if one is configured later.
  // Match recommendations whose action text is quoted in a paragraph — a
  // recommendation without an action contributes its raw evidence instead.
  const evidence = (state.recommendations || [])
    .filter(r => r.action && paragraphs.some(p => p.includes(r.action)))
    .flatMap(r => (r.evidence || []).slice(0, 2));

  return {
    ok: true,
    text,
    intent: id,
    confidence: state.confidence || null,
    source: 'local-coach',
    evidence,
  };
}
