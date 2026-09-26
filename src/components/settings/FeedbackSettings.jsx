import { useState } from 'react';
import ToggleRow from './ToggleRow.jsx';
import { getFeedbackClassifierSettings, saveFeedbackClassifierSettings } from '../../lib/feedbackClassifier.js';
import { loadFeedbackRecords } from '../../lib/feedbackStore.js';
import { shareTextAsFile } from '../../lib/nativeShare.js';
import { classifyAndSaveFeedback, feedbackShareText, reviewFeedback } from '../../services/feedbackService.js';
import { useTransientMessage } from '../../hooks/useTransientMessage.js';

export default function FeedbackSettings(){
  const [classifierEnabled,setClassifierEnabled]=useState(()=> getFeedbackClassifierSettings().enabled);
  const [text,setText]=useState('');
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const [records,setRecords]=useState(()=> loadFeedbackRecords());
  const [sharePreview,setSharePreview]=useState(null);
  const { message, flash } = useTransientMessage();

  const setConsent = (enabled)=>{
    saveFeedbackClassifierSettings({ enabled });
    setClassifierEnabled(enabled);
    flash(enabled
      ? 'Feedback cloud categorisation enabled. Only redacted feedback may reach classifier.dev when you categorise it; nothing was shared with the developer.'
      : 'Feedback cloud categorisation disabled. Categorisation stays local.');
  };

  const submit = async ()=>{
    setBusy(true);
    try{
      const saved = await classifyAndSaveFeedback(text);
      setRecords(saved.records);
      setResult(saved.record);
      setText('');
      flash('Feedback categorised and saved locally. Nothing was sent to the developer.');
    }catch(err){
      flash(String(err?.message || err));
    }finally{
      setBusy(false);
    }
  };

  const markReviewed = (id)=> setRecords(reviewFeedback(id));
  const prepareShare = (record)=>{
    const payload = feedbackShareText(record);
    if(payload) setSharePreview({ text:payload });
  };
  const share = async ()=>{
    if(!sharePreview) return;
    const outcome = await shareTextAsFile({
      text:sharePreview.text,
      filename:`arise-feedback-${new Date().toISOString().slice(0, 10)}.json`,
      mimeType:'application/json',
      title:'Arise feedback report',
    });
    flash(outcome === 'shared'
      ? 'Redacted feedback report shared — no local record was sent automatically.'
      : outcome === 'copied'
        ? 'Redacted feedback report copied. Choose the developer as the recipient yourself.'
        : 'Sharing cancelled; nothing left the device.');
    if(outcome !== 'cancelled') setSharePreview(null);
  };

  return (
    <section id="sec-feedback" className="rounded-2xl border border-line bg-surface p-4 space-y-3">
      <h3 className="text-sm font-bold">Feedback &amp; issue triage</h3>
      <p className="text-xs text-ink3">Tell us about a problem, accessibility issue, content error, or request. Classification is local by default; when enabled, redacted feedback may be sent to classifier.dev. Categorisation never changes training, safety, study gates, or evidence.</p>
      <ToggleRow
        label="Cloud-assisted feedback categorisation"
        checked={classifierEnabled}
        onChange={setConsent}
        hint="Off by default. When switched on, feedback text may be sent to classifier.dev after obvious personal identifiers are redacted first. Training decisions never use this service. Switching it off keeps classification local."
      />
      <form onSubmit={e=> { e.preventDefault(); void submit(); }} className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2" aria-label="Save feedback locally">
        <label htmlFor="feedback-issue" className="block text-xs font-bold">Describe the issue or request</label>
        <textarea id="feedback-issue" value={text} onChange={e=> setText(e.target.value)} maxLength={2000} rows={4}
          placeholder="What happened? Please do not include passwords or other sensitive information."
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-ink3">{classifierEnabled ? 'Redacted feedback may be sent to classifier.dev for categorisation; developer sharing is separate.' : 'Classification stays on this device and is not sent to the developer.'}</span>
          <button type="submit" disabled={busy} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">{busy ? 'Categorising…' : 'Save feedback locally'}</button>
        </div>
      </form>
      {message && <p role="status" className="text-xs rounded-xl border border-line bg-surface2 px-3 py-2">{message}</p>}
      {result && (
        <div data-testid="feedback-result" role="status" aria-live="polite" className="rounded-xl border border-line bg-surface2 px-3 py-2 text-xs space-y-1">
          <p className="font-bold">Latest category: <span data-testid="feedback-category">{result.category}</span></p>
          <p className="text-ink3">Confidence: {result.confidence == null ? 'not available' : Math.round(result.confidence * 100) + '%'} · {result.needsReview ? 'needs operator review' : 'accepted automatically'} · {result.source}</p>
        </div>
      )}
      <div aria-label="Local feedback review queue" className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <h4 className="text-xs font-bold">Local feedback review queue</h4>
          <span className="ml-auto text-[11px] text-ink3">{records.length} stored locally</span>
        </div>
        <p className="text-[11px] text-ink3">This device-only queue is not a developer inbox. Saving or categorising feedback never sends it to the Arise developer. Only redacted issue text and triage metadata are stored.</p>
        {sharePreview && (
          <div data-testid="feedback-share-preview" className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 space-y-2">
            <p className="text-[11px] font-bold text-amber-950">Exactly this redacted report will leave the device only if you confirm sharing:</p>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-amber-200 bg-white px-2 py-1.5 text-[10px] text-amber-950">{sharePreview.text}</pre>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={share} className="btn btn-primary min-h-8 rounded-lg px-2.5 text-[11px]">Share externally</button>
              <button type="button" onClick={()=> setSharePreview(null)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Cancel</button>
            </div>
          </div>
        )}
        {records.length ? (
          <div className="space-y-2">
            {records.map(record=> {
              const status = record.reviewedAt ? 'Reviewed' : record.needsReview ? 'Needs review' : 'Auto-accepted';
              return (
                <article key={record.id} className="rounded-lg border border-line bg-surface px-2.5 py-2 space-y-1" aria-label={'Feedback ' + record.category}>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-bold" data-testid="operator-category">{record.category}</span>
                    <span className="ml-auto rounded-full border border-line px-1.5 py-0.5 text-[10px] font-semibold">{status}</span>
                  </div>
                  <p className="text-[11px] text-ink2 break-words">{record.redactedText || '(empty)'}</p>
                  <p className="text-[10px] text-ink3">confidence {record.confidence == null ? '—' : Math.round(record.confidence * 100) + '%'} · {record.source} · taxonomy v{record.taxonomyVersion}</p>
                  {!record.reviewedAt && <button onClick={()=> markReviewed(record.id)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Mark reviewed</button>}
                  <button onClick={()=> prepareShare(record)} className="btn btn-secondary min-h-8 rounded-lg px-2.5 text-[11px]">Share with developer</button>
                </article>
              );
            })}
          </div>
        ) : <p className="text-[11px] text-ink3">No feedback submitted on this device yet.</p>}
      </div>
    </section>
  );
}
