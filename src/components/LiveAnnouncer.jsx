// LiveAnnouncer.jsx — the app's single polite live region.
//
// The scheduling logic lives in lib/a11y.js (pure, unit-tested); this shell
// just renders whatever announce() last planned, unless the announcement was
// spoken by the voice coach (SR users asked for TTS — no double-read).

import { useEffect, useState } from 'react';
import { setLiveSink, _resetAnnouncerForTests } from '../lib/a11y.js';

export default function LiveAnnouncer(){
  const [message, setMessage] = useState('');
  const [muted, setMuted] = useState(false);
  useEffect(()=>{
    setLiveSink((text, spoken)=> {
      setMessage(text);
      setMuted(!!spoken);
    });
    return ()=> setLiveSink(null);
  },[]);
  return (
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {muted ? '' : message}
    </span>
  );
}
