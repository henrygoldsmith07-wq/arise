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

    it('reads the tab from window.location.search when available', ()=>{
      const saved = globalThis.window;
      globalThis.window = { location: { search: '?tab=progress' } };
      try{
        assert.equal(getInitialTab(), 'progress');
      }finally{
        if(saved === undefined) delete globalThis.window; else globalThis.window = saved;
      }
    });
  });

  // The push-vs-replace contract. This is the behaviour App.jsx depends on,
  // and it had NO unit coverage when it was silently disabled by a caller
  // that always asked for replace. Pin it at the source.
  describe('syncTabToUrl push/replace contract', ()=>{
    it('replaces on the first call, then pushes for later tab changes', async ()=>{
      const calls = [];
      globalThis.window = {
        location: { pathname: '/', search: '', hash: '#main' },
        history: {
          replaceState: (_s, _t, url) => calls.push(['replace', url]),
          pushState: (_s, _t, url) => calls.push(['push', url]),
        },
      };
      try{
        // Fresh module instance so `initialTabSeen` starts false, exactly as
        // it does in a real page load.
        const url = '../src/lib/router.js?fresh=1';
        const mod = await import(url);
        mod.syncTabToUrl('today');
        mod.syncTabToUrl('train');
        mod.syncTabToUrl('progress');

        assert.deepEqual(calls.map(([kind]) => kind), ['replace', 'push', 'push'],
          'the first sync replaces (clean URL); every later tab change pushes (so Back works)');
        assert.match(calls[0][1], /^\/\?tab=today/);
        assert.match(calls[1][1], /^\/\?tab=train/);
        assert.match(calls[2][1], /^\/\?tab=progress/);
        // The skip-link anchor survives every rewrite.
        for (const [, u] of calls) assert.ok(u.endsWith('#main'), `hash preserved in ${u}`);
      }finally{
        delete globalThis.window;
      }
    });

    it('honours an explicit replace on a later call', async ()=>{
      globalThis.window = {
        location: { pathname: '/', search: '', hash: '' },
        history: {
          replaceState: (_s, _t, url) => last.push(['replace', url]),
          pushState: (_s, _t, url) => last.push(['push', url]),
        },
      };
      let last = [];
      try{
        const mod = await import('../src/lib/router.js?fresh=2');
        mod.syncTabToUrl('today');
        mod.syncTabToUrl('train', { replace: true });
        assert.deepEqual(last.map(([k]) => k), ['replace', 'replace']);
      }finally{
        delete globalThis.window;
      }
    });

    it('refuses an invalid tab and never touches history', async ()=>{
      let touched = false;
      globalThis.window = {
        location: { pathname: '/', search: '', hash: '' },
        history: {
          replaceState: () => { touched = true; },
          pushState: () => { touched = true; },
        },
      };
      try{
        const mod = await import('../src/lib/router.js?fresh=3');
        mod.syncTabToUrl('not-a-tab');
        assert.equal(touched, false, 'an unknown tab must not write history');
      }finally{
        delete globalThis.window;
      }
    });
  });

  describe('subscribeToPopState', ()=>{
    it('returns a no-op cleanup when window is unavailable', ()=>{
      const dispose = subscribeToPopState(() => {});
      assert.equal(typeof dispose, 'function');
      assert.doesNotThrow(() => dispose());
    });

    it('reports the tab from the new URL, falling back to the default', async ()=>{
      const saved = globalThis.window;
      const listeners = [];
      globalThis.window = {
        addEventListener: (name, fn) => { if(name === 'popstate') listeners.push(fn); },
        removeEventListener: () => {},
        location: { search: '?tab=train' },
      };
      try{
        const seen = [];
        const dispose = subscribeToPopState((t) => seen.push(t));
        listeners.forEach((fn) => fn());
        assert.deepEqual(seen, ['train']);
        dispose();
      }finally{
        if(saved === undefined) delete globalThis.window; else globalThis.window = saved;
      }
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
