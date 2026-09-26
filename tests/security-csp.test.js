import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

describe('content security policy', ()=>{
  it('does not require unsafe-inline for scripts', ()=>{
    const index = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const vercel = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
    const header = vercel.headers.flatMap(row=> row.headers || []).find(row=> row.key === 'Content-Security-Policy')?.value || '';
    assert.match(index, /script-src 'self'/);
    assert.doesNotMatch(index, /script-src[^;]*'unsafe-inline'/);
    assert.doesNotMatch(header, /script-src[^;]*'unsafe-inline'/);
    assert.match(index, /<script src="\/boot\.js"><\/script>/);
  });

  it('keeps the generated offline fallback free of inline event handlers', ()=>{
    const generator = fs.readFileSync(new URL('../scripts/gen-offline.cjs', import.meta.url), 'utf8');
    assert.doesNotMatch(generator, /onclick=/i);
  });
});
