// Plain-language definitions for training jargon, shown by <JargonHelp>.
export const GLOSSARY = {
  RIR: { title: 'RIR (reps in reserve)', body: 'How many more good reps you could have done. RIR 2 means you stopped with two left in the tank. 0 is a true limit set.' },
  RPE: { title: 'RPE (effort rating)', body: 'How hard a set felt from 1 to 10. RPE 8 is about 2 reps in reserve; RPE 10 is nothing left.' },
  e1RM: { title: 'e1RM (estimated max)', body: 'An estimate of the heaviest single rep you could lift, worked out from a harder set. It is a guide for trends, not a max you must test.' },
  'double progression': { title: 'Double progression', body: 'Add reps at the same weight until you reach the top of the rep range on every set, then add a little load and start at the bottom again.' },
  deload: { title: 'Deload', body: 'A lighter week or session (about 10% less weight, same reps) so tiredness clears and you can progress again.' },
  PR: { title: 'PR (personal record)', body: 'Your best yet on a lift, either more weight, more reps, or a higher estimated max.' },
};
export function glossaryEntry(term){
  const key = Object.keys(GLOSSARY).find(k => k.toLowerCase() === String(term||'').trim().toLowerCase());
  return key ? GLOSSARY[key] : null;
}
// Glossary terms mentioned in a piece of text, in glossary order (whole words only).
export function jargonIn(text){
  const t = String(text||'');
  return Object.keys(GLOSSARY).filter(k => new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?![A-Za-z0-9])`,'i').test(t));
}
