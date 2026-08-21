import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

class ErrorBoundary extends React.Component {
  constructor(p){ super(p); this.state={error:null}; }
  static getDerivedStateFromError(e){ return {error:e}; }
  render(){ if(!this.state.error) return this.props.children;
    return (
      <div style={{minHeight:'100dvh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:12,padding:24,textAlign:'center',fontFamily:'Inter,system-ui,sans-serif'}}>
        <p style={{fontSize:32}}>🛠️</p>
        <h1 style={{fontSize:18,fontWeight:800}}>Something broke</h1>
        <p style={{opacity:.6,fontSize:13,maxWidth:400}}>Reload fixes most things. Your progress is local and safe.</p>
        <button onClick={()=>location.reload()} style={{marginTop:6,padding:'10px 18px',borderRadius:12,border:'none',background:'#131316',color:'white',fontWeight:700}}>Reload</button>
      </div>
    );
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><ErrorBoundary><App /></ErrorBoundary></React.StrictMode>
);

if('serviceWorker' in navigator && import.meta.env.PROD){
  window.addEventListener('load', ()=> navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(()=>{}));
}
