// PWA layer tests: platform classification (incl. iPadOS masquerade),
// shortcut routing, haptic policy decisions, share-sheet fallback chain.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPlatform, isStandalone } from '../src/lib/install.js';
import { tabForShortcut, consumeShortcut } from '../src/lib/pwa.js';
import { patternForEvent, hapticsEnabled, HAPTIC_PATTERNS, resetHapticsForTests, setHapticsSource } from '../src/lib/haptics.js';
import { shareTextAsFile, copyToClipboard } from '../src/lib/nativeShare.js';

describe('platform classification (pure)', () => {
  it('recognises iPhone and Android UAs', () => {
    const ios = classifyPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15', 5);
    assert.equal(ios.isIOS, true);
    assert.equal(ios.isAndroid, false);
    assert.equal(ios.isDesktop, false);

    const android = classifyPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126', 5);
    assert.equal(android.isAndroid, true);
    assert.equal(android.isIOS, false);
  });

  it('unmasks iPadOS 13+ (Macintosh UA with multi-touch)', () => {
    const ipad = classifyPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 5);
    assert.equal(ipad.isIOS, true);
    const mac = classifyPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15', 0);
    assert.equal(mac.isIOS, false);
    assert.equal(mac.isDesktop, true);
  });

  it('flags social in-app browsers that cannot install', () => {
    const insta = classifyPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram 300', 5);
    assert.equal(insta.isIOS, true);
    assert.equal(insta.isWebview, true);
  });
});

describe('standalone detection', () => {
  it('false without window (node test env)', () => {
    assert.equal(isStandalone(), false);
  });
});

describe('home-screen shortcuts', () => {
  it('maps shortcut params to tabs, pure', () => {
    assert.equal(tabForShortcut('start-workout'), 'today');
    assert.equal(tabForShortcut('quick-log'), 'train');
    assert.equal(tabForShortcut('unknown'), null);
    assert.equal(tabForShortcut(null), null);
  });

  it('consumeShortcut navigates and scrubs the URL once', () => {
    const calls = [];
    let currentSearch = '?shortcut=quick-log';
    globalThis.window = {
      location: { get search() { return currentSearch; }, pathname: '/' },
      history: { replaceState: (_, __, url) => { calls.push(url); currentSearch = url.includes('?') ? url.slice(url.indexOf('?')) : ''; } },
      navigator: { standalone: false },
    };
    const tab = consumeShortcut((t) => calls.push('tab:' + t));
    assert.equal(tab, 'train');
    assert.ok(calls.includes('tab:train'));
    assert.ok(calls.some((c) => typeof c === 'string' && c.endsWith('/') && !c.includes('shortcut')));
    // A second consume is a no-op (URL already scrubbed).
    assert.equal(consumeShortcut(() => {}), null);
    delete globalThis.window;
  });
});

describe('haptic policy (pure core)', () => {
  it('every known event maps to a named pattern', () => {
    assert.equal(patternForEvent('set-complete'), 'setComplete');
    assert.equal(patternForEvent('rest-complete'), 'restComplete');
    assert.equal(patternForEvent('set-failed'), 'failedSet');
    assert.equal(patternForEvent('guided-finish'), 'guidedFinish');
    // unknown events degrade to the safe tap
    assert.equal(patternForEvent('mystery'), 'tap');
  });

  it('respects the preference source and platform support', () => {
    // Node has no navigator.vibrate → disabled regardless of preference.
    assert.equal(hapticsEnabled(), false);
    setHapticsSource(() => false);
    assert.equal(hapticsEnabled(), false);
    resetHapticsForTests();
  });

  it('patterns are documented constants', () => {
    assert.ok(HAPTIC_PATTERNS.restComplete >= 150, 'rest-complete must cut through a pocket');
    assert.ok(Array.isArray(HAPTIC_PATTERNS.failedSet));
  });
});

describe('native share fallback chain', () => {
  it('falls back to clipboard when Web Share is missing', async () => {
    let copied = '';
    globalThis.document = {
      createElement: () => ({ style: {}, select: () => {}, set value(v){ copied = v; }, get value(){ return copied; } }),
      body: { appendChild: () => {}, removeChild: () => {} },
    };
    globalThis.document.execCommand = () => true;
    const outcome = await shareTextAsFile({ text: 'hello', filename: 'x.md' });
    assert.equal(outcome, 'copied');
    assert.equal(await copyToClipboard('again'), true);
    delete globalThis.document;
  });

  it('reports cancelled on user abort (no throw)', async () => {
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { share: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }, canShare: () => true },
    });
    const outcome = await shareTextAsFile({ text: 'x', filename: 'x.md' });
    assert.equal(outcome, 'cancelled');
  });

  it('uses the share sheet when the platform supports files', async () => {
    let shared = null;
    globalThis.File = class {};
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { share: async (data) => { shared = data; }, canShare: ({ files }) => Boolean(files?.length) },
    });
    const outcome = await shareTextAsFile({ text: 'md', filename: 'a.md', mimeType: 'text/markdown' });
    assert.equal(outcome, 'shared');
    assert.equal(shared.files.length, 1);
    delete globalThis.File;
  });
});
