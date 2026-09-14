import { test, expect } from '@playwright/test';
import { measureHitArea, gateVerdict } from './hit-target.js';

// Gate calibration: proves the shared 44px assertion itself discriminates,
// on synthetic controls with KNOWN geometry — a bare 36px box must fail on
// size, an exact 44px box must pass, and a 36px box with a real 6px ::before
// hit expansion must pass via the expansion path. Runs on a blank page.
test('44px gate calibration: rejects 36px, accepts 44px and expanded 36px', async ({ page }) => {
  await page.goto('about:blank');
  await page.evaluate(() => {
    const mk = (name, css, expand) => {
      const btn = document.createElement('button');
      btn.textContent = name;
      btn.setAttribute('aria-label', name);
      btn.style.cssText = `position:fixed;left:100px;top:${name === 'probe-36' ? 100 : name === 'probe-44' ? 200 : 300}px;${css}`;
      if(expand){
        const st = document.createElement('style');
        st.textContent = '.probe-expand::before{content:"";position:absolute;inset:-6px;}';
        document.head.appendChild(st);
        btn.className = 'probe-expand';
        btn.style.position = 'relative';
      }
      document.body.appendChild(btn);
    };
    mk('probe-36', 'width:36px;height:36px;', false);
    mk('probe-44', 'width:44px;height:44px;', false);
    mk('probe-36x', 'width:36px;height:36px;', true);
  });
  expect(gateVerdict(await measureHitArea(page, page.getByRole('button', { name: 'probe-36', exact: true })))).toBe('fail-size');
  expect(gateVerdict(await measureHitArea(page, page.getByRole('button', { name: 'probe-44', exact: true })))).toBe('pass');
  expect(gateVerdict(await measureHitArea(page, page.getByRole('button', { name: 'probe-36x', exact: true })))).toBe('pass');
});
