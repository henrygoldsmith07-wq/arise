// nativeShare.js — hand a file (backup, CSV, coach export) or text to the
// platform share sheet where one exists (Android, iOS 15+); fall back to a
// clipboard copy or a download everywhere else. Never throws: sharing is a
// convenience, and a refused sheet (user swipe-away) must not surface as an
// error.

/**
 * Can this platform hand a FILE to the share sheet? Safari/Firefox desktop
 * answer no, so callers must keep a download fallback.
 */
export function canShareFiles({ mimeType = 'application/octet-stream', filename = 'f' } = {}){
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if(!nav?.share || !nav.canShare || typeof File === 'undefined') return false;
  try{
    return nav.canShare({ files: [new File([''], filename, { type: mimeType })] }) === true;
  }catch{ return false; }
}

/**
 * Share a real file (a backup is a File, not text) via the Web Share API
 * (Level 2). Returns 'shared' | 'cancelled' | 'unsupported'. A caller that
 * gets anything other than 'shared' owns the fallback, because by then the
 * user gesture may already be spent.
 */
export async function shareFile({ file, title = 'Arise export' }){
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  if(!nav?.share || !file) return 'unsupported';
  if(nav.canShare && nav.canShare({ files: [file] }) !== true) return 'unsupported';
  try{
    await nav.share({ files: [file], title });
    return 'shared';
  }catch(err){
    return err?.name === 'AbortError' ? 'cancelled' : 'unsupported';
  }
}

/**
 * Share text as a named file via the Web Share API (Level 2).
 * Returns 'shared' | 'copied' | 'cancelled'.
 */
export async function shareTextAsFile({ text, filename, mimeType = 'text/plain', title = 'Arise export' }){
  const file = typeof File !== 'undefined' ? new File([text], filename, { type: mimeType }) : null;
  const nav = typeof navigator !== 'undefined' ? navigator : null;

  if(nav?.share && file && nav.canShare?.({ files: [file] })){
    try{
      await nav.share({ files: [file], title });
      return 'shared';
    }catch(err){
      if(err?.name === 'AbortError') return 'cancelled';
      // fall through to clipboard
    }
  }
  // Some platforms can share text but not files.
  if(nav?.share){
    try{
      await nav.share({ title, text });
      return 'shared';
    }catch(err){
      if(err?.name === 'AbortError') return 'cancelled';
    }
  }
  const copied = await copyToClipboard(text);
  return copied ? 'copied' : 'cancelled';
}

export async function copyToClipboard(text){
  try{
    if(navigator.clipboard?.writeText){
      await navigator.clipboard.writeText(text);
      return true;
    }
  }catch{}
  // Legacy execCommand path for non-secure contexts.
  try{
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  }catch{ return false; }
}
