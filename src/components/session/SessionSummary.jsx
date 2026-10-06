// SessionSummary.jsx — the post-workout summary strip of the standard runner:
// optional note prompts, a session-quality rating, and the free-text note.
// Extracted from SessionRunner; JSX and behaviour are unchanged (every
// interaction still funnels through the runner's markUserEdited contract).
import { NOTE_PROMPTS } from '../../lib/sessionNotes.js';
import { SESSION_QUALITY_OPTIONS } from '../../lib/gymMode.js';

export default function SessionSummary({
  note,
  noteTags = [],
  qualityRating = null,
  onNoteChange,
  onToggleNoteTag,
  onQualityToggle,
}){
  return (
    <section className="rounded-2xl border border-line bg-surface p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">Session notes</span>
        <span className="text-[11px] text-ink3">Optional, useful for next targets</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {NOTE_PROMPTS.map(prompt=> <button key={prompt.id} onClick={()=> onToggleNoteTag(prompt.id)} aria-pressed={noteTags.includes(prompt.id)} className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${noteTags.includes(prompt.id)?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>{prompt.label}</button>)}
      </div>
      <div role="group" aria-label="How did the session feel?" className="flex flex-wrap gap-1.5">
        <span className="text-[11px] text-ink3 self-center mr-1">Session quality:</span>
        {SESSION_QUALITY_OPTIONS.map(opt=> (
          <button key={opt.id} onClick={()=> onQualityToggle(opt.id)} aria-pressed={qualityRating===opt.id}
            className={`text-xs font-semibold px-2.5 py-1.5 rounded-full border ${qualityRating===opt.id?'bg-ink text-bg border-ink':'bg-surface2 border-line'}`}>
            {opt.emoji} {opt.label}
          </button>
        ))}
      </div>
      <textarea value={note} onChange={e=> onNoteChange(e.target.value)} rows={2} placeholder="What should change next time? Mention sleep, pain, technique, ROM, time or load." className="w-full rounded-xl border border-line bg-surface2 px-3 py-2.5 text-sm" />
    </section>
  );
}
