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
import { readinessBand } from '../readinessLog.js';
import { localDateISO } from '../dateOnly.js';

// Exercise ID → display label. The full catalogue (data.js) is heavy, so the
// coaching state does not ship exercise names — IDs are unambiguous in the
// answer text and the user can cross-reference the session. If the coaching
// state ever adds names, this is the seam to plug them in.
function exerciseName(id){
  return id ? id.replace(/-/g, ' ') : id;
}

// ── Lift-name matching ──────────────────────────────────────────────────
// Users say "squats" for "squat", "rows" for "barbell-row". The matchers
// tokenise (lowercase, punctuation out, articles out), singularise the tokens,
// then accept a match when either side contains the other. Without this the
// follow-up path would demand the exact ID the store uses — a fidelity the
// stated contract ("how do I progress my push ups?") never had.
function singular(word){
  return word.length > 3 && /s$/.test(word) && !/(ss|us|x|z|ch|sh)$/.test(word) ? word.slice(0, -1) : word;
}
function liftTokens(text){
  const norm = String(text || '').toLowerCase().replace(/-/g, ' ')
    .replace(/[?!.]/g, '')
    .replace(/\b(?:my|the|a|an)\b/g, '')
    .replace(/\s+/g, ' ').trim();
  return norm ? norm.split(' ').map(singular).join(' ') : '';
}
function matchesAnyLift(asked, candidates){
  const a = liftTokens(asked);
  if(!a) return false;
  return (Array.isArray(candidates) ? candidates : []).some(c => {
    const t = liftTokens(c);
    return t ? (t.includes(a) || a.includes(t)) : false;
  });
}

// ── Follow-up memory (pure — the caller owns the storage) ────────────────
// A coach that forgets the lift it just discussed forces the user to re-type
// a full question every turn. The caller keeps the previous turn's `remember`
// object (returned by localCoachAnswer) in local state and passes it back as
// `last`; nothing is stored here, so the function stays pure and the memory
// stays session-scoped by construction.
const FOLLOW_INTENTS = new Set(['exercise', 'progression']);
const NAMED_FOLLOWUP_RE = /^(?:(?:and|also|or)\s+(?:for\s+|with\s+)?|(?:what|how)\s+about\s+|same\s+(?:for|with)\s+)(?:my\s+|the\s+|that\s+)?([a-z][a-z0-9\-\s]{2,40}?)[\?.!]*$/i;
const BARE_FOLLOWUP_RE = /^(?:and|also|or|more|the rest|anything else|what else|go on|continue|\?)\s*\??$/i;

/**
 * Resolve a potential follow-up against the previous turn.
 *
 * @param {string} question
 * @param {object} ctx  { last: {intent, question, actions}|null, knownLifts: string[] }
 * @returns {{question: string, rewritten?: string, followUp: boolean, exercise?: string, more?: boolean}}
 *   `question` is the question to actually answer (possibly rewritten); the
 *   extra fields describe WHY a rewrite happened so the caller can label it.
 */
export function resolveFollowUp(question, { last = null, knownLifts = [] } = {}){
  const text = String(question || '').trim();
  if(!last || !FOLLOW_INTENTS.has(last.intent) || !text) return { question: text, followUp: false };
  // A question that would stand on its own is never rewritten — memory only
  // fills gaps ("and for rows?"), it never overrides an explicit ask, and a
  // bare "also …" question that already carries its own intent is classified
  // normally rather than hijacked by the previous turn.
  if(classifyCoachQuestion(text).id !== 'general') return { question: text, followUp: false };
  const named = text.match(NAMED_FOLLOWUP_RE);
  const ex = named?.[1];
  if(ex && matchesAnyLift(ex, knownLifts)){
    // Ground the rewrite in lifts the engine actually knows about — a capture
    // that matches no known lift ("and also I feel tired?") must never become
    // a fabricated exercise question.
    const rewritten = last.intent === 'exercise'
      ? `why did my ${ex} stall`
      : `how do I progress my ${ex}`;
    return { question: rewritten, rewritten, followUp: true, exercise: ex };
  }
  // Bare continuation ("and?", "the rest?") after a progression question asks
  // for the other engine decisions of the day, minus what was already quoted.
  // Short, self-contained continuations only — "explain my week" is three words
  // and is NOT one.
  const isBare = text.split(/\s+/).length <= 3
    && /^(?:and|also|or|more|the rest|anything else|what else|go on|continue|\?)[\s?!]*$/i.test(text);
  if(isBare && last?.intent === 'progression' && Array.isArray(last.actions)){
    return { question: text, followUp: true, more: true };
  }
  return { question: text, followUp: false };
}

// ── Suggested questions ─────────────────────────────────────────────────
// The coach surface (CoachPanel) opens on a blank input otherwise, so a first
// question must be guessed. These are queries the answerers demonstrably
// handle today, personalised only with data the user already logged — a
// lift they actually train, not a generic demo lift. Pure + deterministic.
export function suggestedCoachQuestions({ history = [], programmeWhy = null, schedule = null, readinessLog = [] } = []){
  const out = [
    { id: 'week-review', text: 'Explain my week' },
    { id: 'progress', text: 'Am I improving?' },
  ];
  // The missed-session chip must never be suggested on a healthy schedule: the
  // answerer returns an honest "nothing is overdue" there, and a chip that
  // dead-ends is friction. Count real overdue rows the same way the recovery
  // engine marks them.
  let overdue = 0;
  const t = localDateISO();
  for(const s of schedule?.sessions || []){
    if(s?.dateISO && s.dateISO < t && s.status !== 'done') overdue++;
  }
  if(overdue) out.push({ id: 'missed', text: 'I missed a session this week' });
  // Same dead-end rule as the missed-session chip: only suggest the recovery
  // question when the user's own check-ins actually read low. "Am I overdoing
  // it?" now routes to the deload answerer and quotes the readiness-driven
  // safety findings — but on a healthy or absent readiness log there is no
  // positive finding to give, so the chip would dead-end there too.
  const ready = (Array.isArray(readinessLog) ? readinessLog : [])
    .map(r => Number(r?.score)).filter(Number.isFinite).slice(-3);
  if(ready.length >= 2){
    const avg = ready.reduce((a, b) => a + b, 0) / ready.length;
    if(avg <= 40) out.push({ id: 'recovery', text: 'Am I overdoing it?' });
  }
  // The lift that shows up most in logged sessions is the one the user will
  // actually ask about; the matcher in resolveFollowUp/answer builders
  // accepts loose names, so a display-name question resolves.
  const counts = new Map();
  for(const h of Array.isArray(history) ? history : []){
    for(const b of h?.blocks || []){
      if(!b?.exerciseId) continue;
      counts.set(b.exerciseId, (counts.get(b.exerciseId) || 0) + 1);
    }
  }
  const [topLift, topCount] = [...counts.entries()].sort((a, b)=> b[1] - a[1])[0] || [];
  if(topLift && topCount) out.push({ id: 'progression', text: `How do I progress my ${String(topLift).replace(/-/g, ' ')}?` });
  if(programmeWhy?.reasons?.length) out.push({ id: 'programme', text: 'Why this programme?' });
  return out;
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
    id: 'progression',
    re: /\b(how do i (get stronger|progress|continue)|progress (my|the|that) |make (my |the |that )?[a-z\- ]*(harder|tougher|more challenging)|what(?:'| i)s? my next.{0,24}(target|goal|reps?|weight)|\b(add|going|go) [a-z ]{0,12}\bup\b.{0,8}\b(weight|load|reps?|kg|lb)|\bin (weight|load|kg|lbs?)\b|\b(weight|load|reps?)\b.{0,24}\b(add|increase|go|went)\b|\b(add|increase|more)\b.{0,18}\b(weight|load|reps?|kg)\b|heavier (on|for)|(my|the) (next|target) (reps?|set|load|weight))/i,
  },
  {
    id: 'plateau',
    re: /\b(stall|stalled|stuck|plateau|no(t)? (progress|gains?|improving|moving)|not (progressing|improving))\b/i,
  },
  {
    id: 'deload',
    // "Overdoing it" is how users actually ask this; the old set only knew
    // the textbook words and sent "am I overdoing it?" to the general lane.
    re: /\b(deload|tired|fatigue[ds]?|worn (?:out|down)|jaded|overtrain(?:ing|ed)?|overdoing|burn(?:t|ed)? out|running myself into the ground|need a break|rest week)\b/i,
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

// A progression question names its lift loosely ("my push ups", "rows",
// "squats harder"): the tail after the last my/the/that, with verb tokens
// trimmed from the END until a plausible lift phrase remains. The caller's
// lift filter decides whether a phrase actually matches a known lift; when
// nothing matches, every prescription is quoted rather than guessing one.
function progressionLiftName(question){
  const tail = (String(question || '').match(/\b(?:my|the|that)\s+([a-z][a-z0-9\-\s]{2,40}?)[\?!.]*$/i) || [])[1];
  if(!tail) return null;
  const words = tail.replace(/[?!.]+$/, '').trim().split(/\s+/);
  while(words.length){
    const cand = words.join(' ');
    if(cand.length >= 3) return cand;
    words.pop();
  }
  return null;
}

function answerExercise(question, state){
  const asked = exerciseFromText(question);
  if(!asked) return null;
  const rec = (state.recommendations || []).find(r =>
    r.exerciseId && matchesAnyLift(asked, [r.exerciseId, r.action])
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
  const deloadDue = (state.recommendations || []).find(r => r.kind === 'deload');
  if(deloadDue){
    const out = [`${deloadDue.action}.`, deloadDue.reason];
    if(deloadDue.evidence?.length) out.push(`What it is based on: ${deloadDue.evidence.slice(0, 3).join('. ')}.`);
    out.push('A deload is a planned drop in volume, not a loss of progress — the engine picks it up again the week after.');
    return out;
  }
  // The user's own check-ins are the honest input a "tired / overdoing it?"
  // question needs, and they reach this state through TWO real paths:
  //   * safety warnings built from the readiness log (recovery deficit,
  //     excessive fatigue, the volume-hot deload prompt) — these live in
  //     `state.safety.warnings`; the old code read a nonexistent `.items`
  //     field and quoted nothing, ever;
  //   * the latest check-in itself (currentState.readiness), rendered with
  //     the same band wording the readiness UI uses.
  const tired = (state.safety?.warnings || [])
    .filter(w => /recovery-deficit|excessive-fatigue|deload-prompt/.test(w.id || ''));
  const readiness = state.currentState?.readiness || null;
  if(!tired.length && !readiness && !(state.risks || []).length){
    // No check-ins yet and nothing the engines flagged — say so, and say
    // where the signal would come from, rather than an empty reassurance.
    return [
      'Nothing on today\'s plan is asking for a deload right now — and I have no readiness check-ins to read yet.',
      'Log a quick check-in from Today; "am I overdoing it?" is only as honest as the signal behind it.',
    ];
  }
  const out = [];
  for(const w of tired.slice(0, 2)){
    out.push(`${w.title}. ${w.detail}`, w.action ? `What to do: ${w.action}` : null);
  }
  if(readiness?.score != null){
    const band = readinessBand(readiness.score);
    const ago = readiness.daysAgo == null ? ''
      : readiness.daysAgo === 0 ? ' (today)'
        : readiness.daysAgo === 1 ? ' (yesterday)'
          : ` (${readiness.daysAgo} days ago)`;
    out.push(`Latest check-in: ${band.label} — ${readiness.score}${ago}.`);
  } else if(!tired.length){
    out.push('Nothing on today\'s plan is asking for a deload right now.');
  }
  out.push('If you are feeling flat, the honest move is to log the session with real RPE numbers rather than guess a load down — the engine reads effort, not feelings.');
  return out.filter(Boolean);
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
  // The rows a "am I improving" question actually needs. Rows carry their
  // own confidence and evidence, so quoting them is quoting the engine —
  // recovery-readiness closes the check-in channel into the coach: the user's
  // own readings, bounded window and all, as context for the trend verdict.
  const picks = ['training-age', 'consistency', 'progression-rate', 'recovery-readiness']
    .map(id => profile.rows.find(r => r.id === id))
    .filter(Boolean);
  for(const row of picks){
    out.push(row.id === 'recovery-readiness'
      ? `Recovery context — ${row.label}: ${row.value}. ${row.detail}`
      : `${row.label}: ${row.value}. ${row.detail}`);
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

function answerProgression(question, state){
  // The engine's own prescription for the next exposure IS the answer to a
  // progression question: load, reps, or a variant step-up. Quoted verbatim,
  // with the reasoning — this is exactly the "a coach that shows its work"
  // contract. If today's plan has no prescriptions yet, the honest answer is
  // where the engine's decisions live.
  const rx = (state.recommendations || []).filter(r => r.kind === 'prescription');
  if(!rx.length) return [
    'Your plan holds the progression decisions — each lift on Today states what to do next with its reason, and Progress shows how each decision turned out.' +
    (state.summary ? ` Current state: ${state.summary}.` : ''),
  ];
  const asked = progressionLiftName(question) || exerciseFromText(question);
  let rows = rx;
  if(asked){
    const named = rx.filter(r => r.exerciseId && matchesAnyLift(asked, [r.exerciseId, r.action]));
    if(named.length) rows = named;
  }
  const out = [];
  for(const r of rows.slice(0, 5)){
    out.push(`${r.action}.`);
    if(r.reason) out.push(`Why: ${r.reason}`);
    if(r.expectedOutcome) out.push(`What it should achieve: ${r.expectedOutcome}.`);
    if(r.basis === 'initial') out.push('This is still on the initial estimate — it calibrates to your logged sets as they accumulate.');
  }
  const guardKinds = new Set(['plateau', 'recovery', 'deload']);
  const guards = (state.recommendations || []).filter(r => guardKinds.has(r.kind));
  if(guards.length){
    out.push(`Held: ${guards.slice(0, 2).map(g => g.reason || g.action).join(' ')}`);
  }
  return out;
}

function answerProgressionMore(state, excludeActions = []){
  const rx = (state.recommendations || [])
    .filter(r => r.kind === 'prescription')
    .filter(r => !excludeActions.includes(r.action));
  if(!rx.length) return [
    'Everything the engine is changing on today\'s plan has already been quoted — nothing else moves today.',
  ];
  const out = ['On the lifts not covered just now:'];
  for(const r of rx.slice(0, 5)){
    out.push(`${r.action}.`);
    if(r.reason) out.push(`Why: ${r.reason}`);
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
  out.push('Ask me about your week, how to progress a lift, a lift that has stalled, whether you are improving, a plateau, or a missed session.');
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
export function localCoachAnswer(question, { store = {}, today = null, plateConfig = null, last = null } = {}){
  const rawQuestion = String(question || '').trim();
  if(!rawQuestion) return { ok: false, error: 'Ask a question first.' };

  // Follow-up resolution needs today's lift universe, so the state is built
  // BEFORE the question is rewritten — a malformed store still fails softly,
  // and a rewrite is always grounded in a lift the engine actually knows.
  let state;
  try{
    state = buildCoachingState({ store, today, plateConfig });
  }catch(err){
    return { ok: false, error: `I could not read your training state on this device (${String(err?.message || err).slice(0, 120)}).` };
  }
  let profile = null;
  try{ profile = buildTrainingProfile({ store, today }); }catch{ profile = null; }

  const knownLifts = [
    ...(state.recommendations || []).filter(r => r.kind === 'prescription' && r.exerciseId).map(r => r.exerciseId),
    ...(store.history || []).flatMap(h => (h?.blocks || []).map(b => b?.exerciseId)).filter(Boolean),
  ].filter((v, i, arr) => arr.indexOf(v) === i);
  const fu = resolveFollowUp(rawQuestion, { last, knownLifts });
  const effectiveQuestion = fu.rewritten || rawQuestion;

  const { id: classifiedId } = classifyCoachQuestion(effectiveQuestion);
  // A bare continuation ("and?", "more?") borrows the previous turn's intent
  // and answers with the engine's remaining decisions; an explicit new question
  // never does.
  let id = classifiedId;
  if(fu.more && id === 'general' && last?.intent === 'progression' && Array.isArray(last.actions)) id = 'progression';

  let paragraphs = null;
  switch(id){
    case 'exercise': paragraphs = answerExercise(effectiveQuestion, state); break;
    case 'progression':
      paragraphs = (fu.more && Array.isArray(last?.actions))
        ? answerProgressionMore(state, last.actions)
        : answerProgression(effectiveQuestion, state);
      break;
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

  // Which recommendations the answer actually quoted — this drives BOTH the
  // evidence trail of this turn and the memory the next turn may need to know
  // what has already been covered by a bare "and?".
  const paragraphsOut = paragraphs.filter(Boolean);
  const text = paragraphsOut.join(' ');
  const quoted = (state.recommendations || [])
    .filter(r => r.action && paragraphsOut.some(p => p.includes(r.action)));
  const evidence = quoted.flatMap(r => (r.evidence || []).slice(0, 2));

  return {
    ok: true,
    text,
    intent: id,
    confidence: state.confidence || null,
    source: 'local-coach',
    evidence,
    // What the NEXT turn may use to resolve a follow-up. The CALLer stores it
    // (component state or session storage); this function stays pure and
    // nothing here is ever persisted or networked.
    remember: {
      intent: id,
      question: effectiveQuestion,
      exerciseId: quoted.length === 1 ? quoted[0].exerciseId : null,
      actions: quoted.map(r => r.action),
    },
    // Set only when this turn CONTINUED the previous one, so the UI can label
    // the thread honestly ("continuing from your last question").
    followUp: fu.followUp
      ? {
          more: !!fu.more,
          ...(fu.exercise ? { exercise: fu.exercise } : {}),
          basedOn: (last && last.question) || null,
        }
      : null,
  };
}
