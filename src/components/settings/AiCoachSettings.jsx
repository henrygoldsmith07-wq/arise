import { useMemo, useState } from 'react';
import ToggleRow from './ToggleRow.jsx';
import { DEFAULT_MODEL, DEFAULT_BASE_URL, clearAiSettings, getAiSettings, isValidEndpointUrl } from '../../lib/aiCoach.js';
import { getCoachRoutingSettings, saveCoachRoutingSettings } from '../../lib/feedbackClassifier.js';
import { runCoachRequest } from '../../services/coachService.js';
import { INTEGRATIONS_COMPILED_IN } from '../../lib/integrations.js';
import { useTransientMessage } from '../../hooks/useTransientMessage.js';

export default function AiCoachSettings({ store }){
  const initial = useMemo(()=> getAiSettings(), []);
  const [apiKeyInput,setApiKeyInput]=useState('');
  const [prompt,setPrompt]=useState('');
  const [baseUrl,setBaseUrl]=useState(initial.baseUrl || DEFAULT_BASE_URL);
  const [model,setModel]=useState(initial.model || DEFAULT_MODEL);
  const [persistKey,setPersistKey]=useState(initial.persistKey === true);
  const [routingEnabled,setRoutingEnabled]=useState(()=> getCoachRoutingSettings().enabled);
  const [busy,setBusy]=useState(false);
  const [result,setResult]=useState(null);
  const { message, flash } = useTransientMessage();
  const current = getAiSettings();

  const setRouting = (enabled)=>{
    saveCoachRoutingSettings({ enabled });
    setRoutingEnabled(enabled);
    flash(enabled
      ? 'Coach cloud routing enabled. Only ambiguous, redacted coach questions may reach classifier.dev.'
      : 'Coach cloud routing disabled. Routing stays local.');
  };

  const ask = async ()=>{
    if(busy) return;
    setBusy(true);
    setResult(null);
    try{
      const response = await runCoachRequest({
        question:prompt,
        store,
        apiKey:apiKeyInput.trim() || current.apiKey,
        baseUrl: baseUrl.trim() || current.baseUrl,
        model,
        persistKey,
      });
      setResult(response);
    }catch(err){
      setResult({ ok:false, error:String(err?.message || err).slice(0, 140) });
    }finally{
      setBusy(false);
    }
  };

  const clearKey = ()=>{
    clearAiSettings();
    setPersistKey(false);
    setResult(null);
    setApiKeyInput('');
    flash('AI key cleared from this browser.');
  };

  const endpointValid = baseUrl.trim() ? isValidEndpointUrl(baseUrl) : true;

  return (
    <section id="sec-ai" className="rounded-2xl border border-line bg-surface p-4 space-y-2">
      <h3 className="text-sm font-bold">AI coach (optional)</h3>
      {!INTEGRATIONS_COMPILED_IN && (
        <p role="note" className="text-xs text-ink2 bg-surface2 border border-line rounded-xl px-3 py-2">
          <strong>Not available in this build.</strong> This copy of Arise was built
          without the optional integrations, so it cannot contact any cloud
          endpoint at all — pasting a key below will not change that. The
          coach is an explanation layer; your prescriptions come from the local
          deterministic engine either way.
        </p>
      )}
      <p className="text-xs text-ink3">The endpoint gets <span className="font-semibold text-ink">aggregated training data and engine findings only</span>. Keys default to session-only and never enter exports, sync, diagnostics or backups. Point it at a local model (loopback) or any OpenAI-compatible API.</p>
      <ToggleRow
        label="Cloud-assisted coach request routing"
        checked={routingEnabled}
        onChange={setRouting}
        hint="Off by default. Routing is deterministic and local first. When switched on, only an ambiguous redacted coach question may reach classifier.dev; it selects a lane only and never creates training prescriptions."
      />
      <p className="text-xs text-ink3">Ask the coach routes your request invisibly: deterministic intent rules choose the local engine, the explanation path, or the local feedback queue. Training prescriptions always come from the deterministic engine — the cloud coach only explains.</p>
      <div className="rounded-xl border border-line bg-surface2 px-3 py-2.5 space-y-2">
        <label className="block">
          <span className="text-[11px] font-bold">Endpoint URL</span>
          <input value={baseUrl} onChange={e=> setBaseUrl(e.target.value)} placeholder="http://127.0.0.1:11434/v1/chat/completions" autoComplete="off" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs font-mono" />
          <p className="text-[10px] text-ink3 mt-1">Local loopback (http://) or any https OpenAI-compatible endpoint. Defaults to a local model.</p>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold">API key</span>
          <input type="password" value={apiKeyInput} onChange={e=> setApiKeyInput(e.target.value)} placeholder={current.apiKey ? '•••• saved — paste to replace' : 'sk-…'} autoComplete="off" className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="text-[11px] font-semibold text-ink3">Model</span>
          <input value={model} onChange={e=> setModel(e.target.value)} placeholder={DEFAULT_MODEL} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-xs" />
        </label>
        <ToggleRow label="Remember key" checked={persistKey} onChange={setPersistKey} hint="Off: session only. On: saved until cleared." />
        <label className="block">
          <span className="text-[11px] font-bold">Ask the coach</span>
          <textarea value={prompt} onChange={e=> setPrompt(e.target.value)} placeholder="e.g. summarise last week, explain why my bench stalled, or report a crash"
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm resize-none" rows={3} maxLength={500} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button onClick={ask} disabled={busy || !prompt.trim() || !endpointValid} className="btn btn-primary min-h-9 rounded-xl px-3 text-xs disabled:opacity-40">{busy ? 'Routing…' : 'Ask'}</button>
          {current.apiKey && <button onClick={clearKey} className="btn btn-secondary min-h-9 rounded-xl px-3 text-xs">Clear key</button>}
        </div>
        {result && (
          <div role="status" aria-live="polite" className={`rounded-xl border px-3 py-2 text-xs whitespace-pre-wrap ${result.ok ? 'border-line bg-surface' : 'border-review/40 bg-reviewsoft text-ink'}`}>
            {result.ok ? result.text : `AI request unavailable: ${result.error}`}
            {result.ok && (
              <p className="mt-2 pt-2 border-t border-line text-[10px] text-ink3">
                {result.offline
                  ? `Answered on device from the deterministic engine${result.confidence ? ` · confidence ${result.confidence}` : ''}${result.note ? ` · ${result.note}` : ''}. No training data leaves this device.`
                  : 'Answered by your configured endpoint using the engine\'s findings.'}
                {result.evidence?.length > 0 && (
                  <>
                    {' '}Based on {result.evidence.length} engine finding{result.evidence.length === 1 ? '' : 's'}.
                  </>
                )}
              </p>
            )}
          </div>
        )}
        {message && <p aria-live="polite" className="text-[11px] text-ink3">{message}</p>}
      </div>
    </section>
  );
}
