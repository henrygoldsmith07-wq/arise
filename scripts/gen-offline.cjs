#!/usr/bin/env node
// scripts/gen-offline.cjs — generate public/offline.html at build time.
//
// The offline fallback page must live in the service worker's precache, but
// a build timestamp would churn the SW cache version every build for a file
// almost nobody fetches. So the page is static apart from its title, and this
// generator exists only to keep the SW's SHELL list and the file in lockstep.
// Regenerating is idempotent and safe to run on every build.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', 'public', 'offline.html');

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Arise — offline</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center;
         font-family: Inter, system-ui, sans-serif; background: #fafafa; color: #17171a; }
  @media (prefers-color-scheme: dark) {
    body { background: #131316; color: #f5f5f4; }
    .card { border-color: #2c2c30 !important; }
  }
  .card { max-width: 26rem; margin: 1rem; padding: 2rem; text-align: center;
          border: 1px solid #e5e5e3; border-radius: 1.25rem; background: #fff; }
  .emoji { font-size: 2rem; }
  h1 { font-size: 1.125rem; font-weight: 800; margin: .75rem 0 .25rem; }
  p { font-size: .8125rem; opacity: .65; line-height: 1.5; margin: .25rem 0; }
  button { margin-top: 1rem; padding: .65rem 1.25rem; border: 0; border-radius: .75rem;
           background: #17171a; color: #fff; font-weight: 700; font-size: .8125rem; }
  @media (prefers-color-scheme: dark) {
    button { background: #f5f5f4; color: #17171a; }
  }
</style>
</head>
<body>
  <main class="card">
    <div class="emoji" aria-hidden="true">📴</div>
    <h1>You're offline</h1>
    <p>This page needs the network, but the app itself keeps working from its
       cached shell — your training data is stored on this device.</p>
    <p>Close this tab and reopen Arise from your home screen, or retry below.</p>
    <button onclick="location.assign('./')">Open Arise</button>
  </main>
</body>
</html>
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, PAGE, 'utf8');
console.log(`gen-offline: wrote ${path.relative(process.cwd(), OUT)} (${PAGE.length} bytes)`);
