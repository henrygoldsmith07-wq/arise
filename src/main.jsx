import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateStorage } from './lib/storage.js';
import { isIdbBlocked } from './lib/idb.js';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={error:null}; }
  static getDerivedStateFromError(e){ return {error:e}; }
  render(){ if(!this.state.error) return this.props.children;
    return (
      <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:24,textAlign:'center',fontFamily:'Inter,system-ui,sans-serif'}}>
        <p style={{fontSize:32}}>🛠️</p>
        <h1 style={{fontSize:18,fontWeight:800}}>Something broke</h1>
        <p style={{opacity:.6,fontSize:13,maxWidth:400}}>Reload fixes most things. Arise stores training data on this device and will re-check it when the app starts again.</p>
        <button onClick={()=>location.reload()} style={{marginTop:6,padding:'10px 18px',borderRadius:12,border:'none',background:'#131316',color:'white',fontWeight:700}}>Reload</button>
      </div>
    );
  }
}

// Hydrate the IndexedDB-backed store before first render so every existing
// synchronous consumer starts from fully composed state.
// Boot can hang forever when a second tab blocks the IDB version upgrade
// (onblocked fires, neither onsuccess nor onerror follows). Race hydration
// against an ~8s timeout so a blocked upgrade surfaces an actionable failure
// state instead of an infinite splash.
const BOOT_TIMEOUT_MS = 8000;
function bootTimeout(){
  return new Promise((_, reject)=>{
    setTimeout(()=>{
      const blocked = (()=> { try{ return isIdbBlocked(); }catch{ return false; } })();
      const err = new Error(blocked
        ? 'blocked: another Arise tab is open with an older version'
        : 'boot timeout: storage hydration did not settle in time');
      err.code = blocked ? 'IDB_BLOCKED' : 'BOOT_TIMEOUT';
      err.blocked = blocked;
      reject(err);
    }, BOOT_TIMEOUT_MS);
  });
}
function renderBootFailure(err){
  const blocked = Boolean(err?.blocked) || /blocked/i.test(String(err?.message || ''));
  const root = document.getElementById('root');
  if(!root) return;
  root.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;font-family:Inter,system-ui,sans-serif';
  const title = document.createElement('h1');
  title.style.cssText = 'font-size:18px;font-weight:800;margin:0';
  title.textContent = blocked ? 'Another Arise tab is blocking this update' : 'Arise could not start';
  const msg = document.createElement('p');
  msg.style.cssText = 'opacity:.7;font-size:13px;max-width:440px;margin:0';
  msg.textContent = blocked
    ? 'Another Arise tab is open with an older version, so this tab is waiting on a storage upgrade. Close other Arise tabs, then reload.'
    : 'Storage hydration timed out. Reload to retry — your training data stays on this device.';
  const btnRow = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:center';
  const reloadBtn = document.createElement('button');
  reloadBtn.textContent = 'Reload';
  reloadBtn.style.cssText = 'padding:10px 18px;border-radius:12px;border:none;background:#131316;color:white;font-weight:700;min-height:44px;min-width:44px';
  reloadBtn.addEventListener('click', ()=> location.reload());
  const diagBtn = document.createElement('button');
  diagBtn.textContent = 'Copy diagnostics';
  diagBtn.style.cssText = 'padding:10px 18px;border-radius:12px;border:1px solid #888;background:transparent;font-weight:700;min-height:44px;min-width:44px';
  diagBtn.addEventListener('click', async ()=>{
    const diag = `arise-boot-failure at=${new Date().toISOString()} code=${err?.code || 'unknown'} blocked=${blocked} message=${String(err?.message || err)} ua=${navigator.userAgent}`;
    try{ await navigator.clipboard.writeText(diag); diagBtn.textContent = 'Copied'; }
    catch{ diagBtn.textContent = 'Copy failed'; }
    setTimeout(()=> { diagBtn.textContent = 'Copy diagnostics'; }, 2000);
  });
  btnRow.appendChild(reloadBtn);
  btnRow.appendChild(diagBtn);
  wrap.appendChild(title);
  wrap.appendChild(msg);
  wrap.appendChild(btnRow);
  root.appendChild(wrap);
}
Promise.race([hydrateStorage(), bootTimeout()]).then(()=>{
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>
  );
}).catch((err)=>{
  try{ console.error('[arise] boot hydration failed', err); }catch{}
  renderBootFailure(err);
});

if('serviceWorker' in navigator && import.meta.env.PROD){
  const registerServiceWorker = ()=> navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>{});
  if(document.readyState === 'complete') void registerServiceWorker();
  else window.addEventListener('load', registerServiceWorker, { once:true });
}
