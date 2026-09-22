// Shared structured session-note tags. Standard and Guided mode persist the
// same ids so analytics can compare modes without parsing free-text notes.
export const NOTE_PROMPTS = [
  { id: 'felt-strong', label: 'Felt strong' },
  { id: 'felt-heavy', label: 'Felt heavy' },
  { id: 'poor-sleep', label: 'Poor sleep' },
  { id: 'short-on-time', label: 'Short on time' },
  { id: 'form-focus', label: 'Form focus' },
  { id: 'pain-discomfort', label: 'Pain / discomfort' },
];


export const NOTE_TEMPLATES = [
  { id: 'next-time', label: 'Next time', text: 'Next time: ' },
  { id: 'technique', label: 'Technique', text: 'Technique: ' },
  { id: 'recovery', label: 'Recovery', text: 'Recovery / energy: ' },
  { id: 'discomfort', label: 'Discomfort', text: 'Discomfort / movement to adjust: ' },
  { id: 'time', label: 'Time limit', text: 'Time constraint / skipped work: ' },
];

export function appendNoteTemplate(note, templateId){
  const template = NOTE_TEMPLATES.find((item)=> item.id === templateId);
  if(!template) return String(note || '');
  const current = String(note || '').trimEnd();
  return current ? `${current}\n${template.text}` : template.text;
}
