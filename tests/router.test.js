import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTabFromUrl, getInitialTab, syncTabToUrl, subscribeToPopState, VALID_TABS, DEFAULT_TAB } from '../src/lib/router.js';

describe('router', ()=>{
  describe('parseTabFromUrl', ()=>{
    it('returns valid tab names from search params', ()=>{
      for(const tab of VALID_TABS){
        const params = new URLSearchParams(`tab=${tab}`);
        assert.equal(parseTabFromUrl(params), tab);
      }
    });

    it('returns null for invalid tab names', ()=>{
      const params = new URLSearchParams('tab=nonexistent');
      assert.equal(parseTabFromUrl(params), null);
    });

    it('returns null when no tab parameter is present', ()=>{
      const params = new URLSearchParams('');
      assert.equal(parseTabFromUrl(params), null);
    });
  });

  describe('getInitialTab', ()=>{
    it('returns the default tab when window is unavailable (SSR)', ()=>{
      // In Node.js, window is undefined → returns DEFAULT_TAB
      assert.equal(getInitialTab(), DEFAULT_TAB);
    });
  });

  describe('syncTabToUrl', ()=>{
    it('is a no-op when window is undefined', ()=>{
      // Should not throw
      assert.doesNotThrow(() => syncTabToUrl('today'));
    });
  });

  describe('VALID_TABS', ()=>{
    it('contains the five core tabs', ()=>{
      assert.deepEqual([...VALID_TABS].sort(), ['exercises', 'more', 'progress', 'today', 'train'].sort());
    });
  });

  describe('DEFAULT_TAB', ()=>{
    it('is today', ()=>{
      assert.equal(DEFAULT_TAB, 'today');
    });
  });
});
