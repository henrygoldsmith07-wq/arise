import { useCallback, useEffect, useRef, useState } from 'react';

export function useTransientMessage(){
  const [message, setMessage] = useState(null);
  const timerRef = useRef(null);
  const clear = useCallback(()=>{
    if(timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setMessage(null);
  },[]);
  const flash = useCallback((text, duration = 4500)=>{
    if(timerRef.current) clearTimeout(timerRef.current);
    setMessage(text);
    timerRef.current = setTimeout(()=> { timerRef.current = null; setMessage(null); }, duration);
  },[]);
  useEffect(()=> ()=> { if(timerRef.current) clearTimeout(timerRef.current); },[]);
  return { message, setMessage, flash, clear };
}
