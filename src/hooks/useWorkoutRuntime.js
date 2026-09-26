import { useCallback, useEffect, useRef, useState } from 'react';
import { createWakeLock } from '../lib/wakeLock.js';

export function useWorkoutClock(active = true){
  const [clock,setClock] = useState(()=> Date.now());
  useEffect(()=>{
    if(!active) return undefined;
    const id = setInterval(()=> setClock(Date.now()), 500);
    return ()=> clearInterval(id);
  },[active]);
  return [clock,setClock];
}

export function useWorkoutWakeLock(enabled){
  useEffect(()=>{
    if(!enabled) return undefined;
    const lock = createWakeLock();
    void lock.acquire();
    return ()=> { void lock.release(); };
  },[enabled]);
}

export function useWorkoutDraftPersistence(snapshot, onDraftChange){
  const draftRef = useRef(null);
  const persistNow = useCallback((patch = null)=>{
    if(!draftRef.current) return null;
    const next = { ...draftRef.current, ...(patch || {}), updatedAt:new Date().toISOString() };
    draftRef.current = next;
    onDraftChange?.(next);
    return next;
  },[onDraftChange]);

  useEffect(()=>{
    const next = { ...snapshot, updatedAt:new Date().toISOString() };
    draftRef.current = next;
    onDraftChange?.(next);
  },[snapshot,onDraftChange]);

  useEffect(()=>{
    const onPageHide = ()=> { persistNow(); };
    window.addEventListener('pagehide', onPageHide);
    return ()=> window.removeEventListener('pagehide', onPageHide);
  },[persistNow]);

  return { draftRef, persistNow };
}
