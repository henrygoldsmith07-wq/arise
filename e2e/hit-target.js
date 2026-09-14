// e2e/hit-target.js — shared 44px effective-hit-area measurement.
//
// A control passes iff BOTH hold:
//   size:    effective span (visible box expanded by REAL ::before/::after
//            hit insets; transparent padding is already in the box) ≥43.5
//            CSS px in both dims (0.5px sub-pixel allowance);
//   cover:   probes strictly inside that span (central 42px) all resolve
//            into the control itself (overlap/occlusion fails).
// A bare 36px box fails size even if its centre hits; an overlapped 44px
// box fails cover even with full size. Neither half can be gamed alone.

export async function measureHitArea(page, locator, { attempts = 3 } = {}){
  // Retried measurement: under parallel CI load a ticking rest countdown can
  // break Playwright's stability check mid-measure. Retries only ride out
  // transient instability — a genuinely missing/covered control still fails
  // after the last attempt, with its error.
  let lastError = null;
  for(let attempt = 0; attempt < attempts; attempt++){
    try{
      await locator.evaluate((btn) => btn.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }), null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(200);
      return await locator.evaluate((btn) => {
      const r = btn.getBoundingClientRect();
      let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
      for(const pseudo of ['::before', '::after']){
        let cs = null;
        try{ cs = getComputedStyle(btn, pseudo); }catch{ continue; }
        if(!cs || cs.content === 'none' || cs.content === 'normal') continue;
        if(cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none') continue;
        if(cs.position !== 'absolute' && cs.position !== 'fixed') continue;
        const num = (v)=> { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
        x0 = Math.min(x0, r.left + Math.min(0, num(cs.left)));
        y0 = Math.min(y0, r.top + Math.min(0, num(cs.top)));
        x1 = Math.max(x1, r.right - Math.min(0, num(cs.right)));
        y1 = Math.max(y1, r.bottom - Math.min(0, num(cs.bottom)));
      }
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      const hits = [];
      for(const [dx, dy] of [[0, 0], [-21, 0], [21, 0], [0, -21], [0, 21]]){
        const el = document.elementFromPoint(cx + dx, cy + dy);
        hits.push(el === btn || (el && btn.contains(el)));
      }
      return { w: x1 - x0, h: y1 - y0, hits };
      }, null, { timeout: 8000 });
    }catch(err){ lastError = err; }
  }
  throw lastError;
}

export function gateVerdict(measured){
  if(!(measured.w >= 43.5) || !(measured.h >= 43.5)) return 'fail-size';
  if(!measured.hits.every(Boolean)) return 'fail-cover';
  return 'pass';
}
