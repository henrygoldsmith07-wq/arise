// CoachPanel.jsx — the on-device coach, surfaced in the main training loop.
//
// The entire local coach (localCoach.js + buildCoachingState) already existed
// and was fully tested — but its only call site was More → Settings →
// "AI coach (optional)", where a user asking about their training had to go
// looking for it inside a panel that reads as a cloud feature. This panel puts
// the coach where the coaching happens: right after the Weekly Review on Today
// and right after the "Am I improving?" assessment on Progress.
//
// Contract (unchanged from the engine):
//   * Answers come from localCoachAnswer — the deterministic engines' own
//     findings, quoted verbatim with their reasons. Nothing is invented.
//   * 100% on-device: no endpoint is contacted, no setting is toggled, no key
//     is needed. The panel never mutates AI settings — the settings-flow ask
//     path owns those writes; here there is nothing to write.
//   * Conversation memory is component state ONLY (the `remember` object is
//     passed back for follow-up resolution). Nothing persists — the same
//     session-scoped guarantee the settings panel has.
//
// The component itself is small; the heavy coaching-state graph rides in
// through the static import below, which is why the views lazy() this panel:
// it must never inflate the Today/Progress route chunks or the boot budget.

import { useMemo, useRef, useState } from 'react';
import { localCoachAnswer, suggestedCoachQuestions } from '../lib/coach/localCoach.js';

const MAX_TURNS = 6;

export default function CoachPanel({ store, programmeWhy = null }){
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]);
  // The previous turn's `remember` object; caller-owned session memory, so a
  // bare "and for rows?" resolves without re-typing the whole question.
  const lastRef = useRef(null);
  const inputRef = useRef(null);
  const turnSeqRef = useRef(0);

  const suggestions = useMemo(()=>
    suggestedCoachQuestions({
      history: store?.history || [],
      programmeWhy,
      schedule: store?.activeSchedule || null,
      readinessLog: store?.readinessLog || [],
    }), [store?.history, store?.activeSchedule, store?.readinessLog, programmeWhy]);

  const pushTurn = (turn)=> setTurns(prev=> [...prev.slice(-(MAX_TURNS - 1)), turn]);

  const ask = async (raw = null)=>{
    const text = String(raw ?? question).trim();
    if(!text || busy) return;
    setBusy(true);
    if(raw != null) setQuestion(raw);
    turnSeqRef.current += 1;
    const id = turnSeqRef.current;
    try{
      const answer = localCoachAnswer(text, { store: store || {}, last: lastRef.current });
      if(answer.ok) lastRef.current = answer.remember;
      pushTurn({
        id,
        question: text,
        ok: answer.ok === true,
        text: answer.ok ? answer.text : answer.error,
        followUp: answer.followUp || null,
      });
      setQuestion('');
    }catch(err){
      pushTurn({ id, question: text, ok: false, text: String(err?.message || err), followUp: null });
    }finally{
      setBusy(false);
    }
  };

  if(!open){
    return (
      <section className="rounded-2xl border border-line bg-surface p-4 flex flex-wrap items-center gap-2" aria-label="Ask the coach" data-testid="coach-panel-trigger">
        <span aria-hidden className="text-base">💬</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">On-device coach</p>
          <p className="text-xs text-ink2">Ask about your week, a stalled lift, progression or improving — answered entirely on this device.</p>
        </div>
        <button onClick={()=> setOpen(true)} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs">Ask the coach</button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 space-y-2" aria-label="Ask the coach" data-testid="coach-panel">
      <div className="flex items-baseline gap-2">
        <p className="text-[11px] font-bold uppercase tracking-widest text-ink3">On-device coach</p>
        <button onClick={()=> setOpen(false)} className="ml-auto text-[11px] font-bold text-ink3 underline underline-offset-2">Collapse</button>
      </div>
      <p className="text-[11px] text-ink3">
        Answers restate what the deterministic engines decided from your own logs — never invented, and nothing leaves this device. The optional cloud coach keeps its own home in <span className="font-semibold text-ink">More → Privacy &amp; integrations</span>.
      </p>

      {turns.map(turn=> (
        <div key={turn.id} className="rounded-xl border border-line bg-surface2 px-3 py-2 space-y-1">
          <p className="text-xs text-ink3"><span className="font-bold">You:</span> {turn.question}</p>
          <div aria-live="polite" className="text-xs text-ink whitespace-pre-wrap leading-snug">
            <span className="font-bold">Coach:</span> {turn.text}
          </div>
          {turn.followUp?.basedOn && (
            <p className="text-[10px] text-ink3">Continuing from “{turn.followUp.basedOn}”.</p>
          )}
          {turn.ok ? (
            <p className="text-[10px] text-ink3">Answered on-device from your logs — nothing left this device.</p>
          ) : (
            <p className="text-[10px] text-ink3">Honest no-finding answer — log a session or two, or ask about a lift that exists in your plan.</p>
          )}
        </div>
      ))}

      <div role="group" aria-label="Suggested questions" className="flex flex-wrap gap-1.5">
        {suggestions.map(s=> (
          <button key={s.id} type="button" onClick={()=> ask(s.text)} disabled={busy}
            className="rounded-full border border-line bg-surface2 px-2.5 py-1 text-[11px] font-bold text-ink3 hover:border-ink3 hover:text-ink min-h-8">
            {s.text}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <input ref={inputRef}
          value={question}
          onChange={e=> setQuestion(e.target.value)}
          onKeyDown={e=>{ if(e.key === 'Enter'){ e.preventDefault(); ask(); } }}
          placeholder="e.g. why did my bench press stall?"
          maxLength={500}
          aria-label="Ask the coach a question"
          className="flex-1 min-h-10 rounded-lg border border-line bg-surface px-3 text-sm" />
        <button onClick={()=> ask()} disabled={busy || !question.trim()} className="btn btn-primary min-h-10 rounded-xl px-3 text-xs disabled:opacity-40">{busy ? 'Thinking…' : 'Ask'}</button>
      </div>
    </section>
  );
}
