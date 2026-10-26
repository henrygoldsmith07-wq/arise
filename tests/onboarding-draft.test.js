import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ONBOARDING_DRAFT_KEY, ONBOARDING_DRAFT_MAX_AGE_MS, sanitizeDraft, saveDraft, loadDraft, clearDraft, draftDiffers,
} from '../src/lib/onboardingDraft.js';

const mem = ()=>{ const m = new Map(); return { getItem:k=> m.has(k)?m.get(k):null, setItem:(k,v)=>m.set(k,String(v)), removeItem:k=>m.delete(k), m }; };

describe('onboarding draft', ()=>{
  it('keeps the ride-days answer', ()=>{
    const storage = mem();
    saveDraft({ sport:'cycling', rideDaysPerWeek:4 }, { storage, now:1000 });
    assert.equal(loadDraft({ storage, now:2000 }).rideDaysPerWeek, 4);
    assert.equal(draftDiffers({ rideDaysPerWeek:4 }, { rideDaysPerWeek:0 }), true);
  });
  it('round-trips answers', ()=>{
    const storage = mem();
    const d = { goal:'strength', equipment:['machine','cable'], days:3, minutes:50, step:2, dumbbellsInput:'10 12' };
    assert.equal(saveDraft(d, { storage, now:1000 }), true);
    assert.deepEqual(loadDraft({ storage, now:2000 }), d);
  });
  it('drops expired and future-dated drafts', ()=>{
    const storage = mem();
    saveDraft({ goal:'x' }, { storage, now:1000 });
    assert.equal(loadDraft({ storage, now:1000 + ONBOARDING_DRAFT_MAX_AGE_MS + 1 }), null);
    saveDraft({ goal:'x' }, { storage, now:10_000_000 });
    assert.equal(loadDraft({ storage, now:1000 }), null);
  });
  it('sanitises hostile or corrupt data', ()=>{
    assert.equal(sanitizeDraft(null), null);
    assert.equal(sanitizeDraft({ evil:1 }), null);
    assert.deepEqual(sanitizeDraft({ goal:5, equipment:['a',3,null], days:'3', minutes:40 }), { equipment:['a'], minutes:40 });
    const storage = mem(); storage.setItem(ONBOARDING_DRAFT_KEY, '{bad');
    assert.equal(loadDraft({ storage }), null);
  });
  it('clear removes it; missing storage is safe', ()=>{
    const storage = mem(); saveDraft({ goal:'a' }, { storage });
    clearDraft({ storage });
    assert.equal(loadDraft({ storage }), null);
    assert.equal(saveDraft({ goal:'a' }, { storage:null }), false);
    assert.equal(loadDraft({ storage:null }), null);
  });
  it('draftDiffers ignores the step and equal answers', ()=>{
    assert.equal(draftDiffers({ goal:'general', step:3 }, { goal:'general' }), false);
    assert.equal(draftDiffers({ goal:'strength' }, { goal:'general' }), true);
    assert.equal(draftDiffers(null, {}), false);
  });
});
