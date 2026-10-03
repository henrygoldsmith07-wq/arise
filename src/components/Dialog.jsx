// Dialog.jsx — the shared Arise dialog primitives.
//
// Every destructive flow used to reach for window.confirm/prompt: unstyled,
// unlabelled, hostile on mobile and a dead-end for screen readers. This module
// is the single owner of modal behaviour:
//   - role="alertdialog" for destructive confirmations, role="dialog" otherwise;
//   - focus lands on the safe action at open and returns to the opener at close;
//   - Tab is trapped inside; Escape always cancels (never confirms);
//   - actions are explicit primary/secondary with destructive styling.
//
// Presentation owns the dialog; callers own the operation. A confirmed
// destructive action is invoked through the caller's already-confirmed path —
// no second confirmation may exist below the presentation layer. Two entry
// points: declarative <ConfirmDialog>/<PromptDialog> for a component-owned
// flow, and useDialogs() for scattered one-off confirmations that used to be
// inline `confirm(...)` calls.

import { useCallback, useEffect, useRef, useState } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function DialogShell({ role = 'dialog', title, description, titleId, descriptionId, initialFocusRef, restoreFocus = true, children }){
  const rootRef = useRef(null);
  const openerRef = useRef(null);
  const mountSeqRef = useRef(0);
  useEffect(()=>{
    // Focus lands on the safe action at open and returns to the opener at
    // close. The restore is deferred one microtask and tagged with the mount
    // sequence: React StrictMode re-invokes this effect in dev, and a restore
    // firing inside that gap costs a spurious focus round-trip per dialog.
    // `restoreFocus: false` is for a dialog whose confirm dismisses the whole
    // surface: that surface's own dialog lifecycle restores focus, so a second
    // restore here would fight it (and fire against a detaching element).
    const seq = ++mountSeqRef.current;
    openerRef.current = document.activeElement;
    const target = initialFocusRef?.current;
    if(target && typeof target.focus === 'function'){
      try{ target.focus({ preventScroll: true }); }catch{ target.focus(); }
    }
    return ()=>{
      const opener = openerRef.current;
      queueMicrotask(()=>{
        if(!restoreFocus || mountSeqRef.current !== seq) return;
        if(opener && typeof opener.focus === 'function' && opener.isConnected && opener !== document.activeElement){
          try{ opener.focus({ preventScroll: true }); }catch{ opener.focus(); }
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);
  const trapTab = (e)=>{
    if(e.key !== 'Tab' || !rootRef.current) return;
    const focusables = [...rootRef.current.querySelectorAll(FOCUSABLE)];
    if(!focusables.length) return;
    // The dialog is its own modal: stop the event here so a wrapping modal's
    // trap (session runners render outside App's tree) never double-handles a
    // Tab and drags focus back to its own controls.
    e.stopPropagation();
    const first = focusables[0], last = focusables[focusables.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  };
  return (
    <div
      ref={rootRef}
      onKeyDown={trapTab}
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role={role}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <div className="w-full max-w-sm rounded-3xl bg-surface border border-line p-4 space-y-3">
        <p id={titleId} className="text-base font-bold">{title}</p>
        {description ? <p id={descriptionId} className="text-xs text-ink3">{description}</p> : null}
        {children}
      </div>
    </div>
  );
}

let dialogSeq = 0;
function useDialogIds(prefix){
  const ref = useRef(null);
  if(!ref.current) ref.current = { titleId: `${prefix}-title-${++dialogSeq}`, descriptionId: `${prefix}-desc-${dialogSeq}` };
  return ref.current;
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  escapeCloses = true,
  restoreFocus = true,
  onConfirm,
  onCancel,
}){
  const ids = useDialogIds(destructive ? 'confirm-destructive' : 'confirm');
  const cancelRef = useRef(null);
  useEffect(()=>{
    if(!escapeCloses) return undefined;
    const onKey = (e)=>{
      if(e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return ()=> window.removeEventListener('keydown', onKey, true);
  },[escapeCloses, onCancel]);
  return (
    <DialogShell
      role={destructive ? 'alertdialog' : 'dialog'}
      title={title}
      description={description}
      titleId={ids.titleId}
      descriptionId={ids.descriptionId}
      initialFocusRef={cancelRef}
      restoreFocus={restoreFocus}
    >
      <div className="flex gap-2">
        <button ref={cancelRef} onClick={onCancel} className="btn btn-primary flex-1 min-h-11 rounded-xl">{cancelLabel}</button>
        <button onClick={onConfirm} className={`btn btn-secondary flex-1 min-h-11 rounded-xl ${destructive ? 'text-danger' : ''}`}>{confirmLabel}</button>
      </div>
    </DialogShell>
  );
}

export function PromptDialog({
  title,
  description,
  fieldLabel,
  placeholder = '',
  inputType = 'text',
  minLength = 0,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  destructive = false,
  validate = null,
  onSubmit,
  onCancel,
}){
  const ids = useDialogIds(destructive ? 'prompt-destructive' : 'prompt');
  const inputRef = useRef(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const submit = ()=>{
    const text = value;
    if(minLength && text.length < minLength){
      setError(`Use at least ${minLength} characters.`);
      return;
    }
    const problem = validate ? validate(text) : null;
    if(problem){ setError(problem); return; }
    onSubmit(text);
  };
  useEffect(()=>{
    const onKey = (e)=>{
      if(e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener('keydown', onKey, true);
    return ()=> window.removeEventListener('keydown', onKey, true);
  },[onCancel]);
  return (
    <DialogShell
      role={destructive ? 'alertdialog' : 'dialog'}
      title={title}
      description={description}
      titleId={ids.titleId}
      descriptionId={ids.descriptionId}
      initialFocusRef={inputRef}
    >
      <label className="block">
        <span className="text-[11px] font-bold">{fieldLabel}</span>
        <input
          ref={inputRef}
          type={inputType}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          onChange={(e)=>{ setValue(e.target.value); setError(null); }}
          onKeyDown={(e)=>{ if(e.key === 'Enter'){ e.preventDefault(); submit(); } }}
          aria-describedby={error ? `${ids.descriptionId}-error` : undefined}
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </label>
      {error && <p id={`${ids.descriptionId}-error`} role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn btn-secondary flex-1 min-h-11 rounded-xl">{cancelLabel}</button>
        <button onClick={submit} className={`btn btn-primary flex-1 min-h-11 rounded-xl ${destructive ? 'text-danger' : ''}`}>{confirmLabel}</button>
      </div>
    </DialogShell>
  );
}

// Imperative host: `confirm(opts)` and `prompt(opts)` settle as promises, so a
// scattered one-off confirmation reads like the old window.confirm call while
// rendering the shared accessible dialog. Exactly one is open at a time.
export function useDialogs(){
  const [current, setCurrent] = useState(null);
  const currentRef = useRef(null);
  useEffect(()=> ()=>{ currentRef.current?.resolve(currentRef.current.kind === 'prompt' ? null : false); },[]);
  const open = useCallback((kind, options)=> new Promise((resolve)=>{
    currentRef.current?.resolve(kind === 'prompt' ? null : false);
    currentRef.current = { kind, options, resolve };
    setCurrent(currentRef.current);
  }),[]);
  const settle = useCallback((value)=>{
    const entry = currentRef.current;
    currentRef.current = null;
    setCurrent(null);
    entry?.resolve(value);
  },[]);
  const node = current ? (current.kind === 'confirm'
    ? (
      <ConfirmDialog
        {...current.options}
        onConfirm={()=> settle(true)}
        onCancel={()=> settle(false)}
      />
    )
    : (
      <PromptDialog
        {...current.options}
        onSubmit={(value)=> settle(value)}
        onCancel={()=> settle(null)}
      />
    )) : null;
  return { node, confirm:(options)=> open('confirm', options), prompt:(options)=> open('prompt', options) };
}
