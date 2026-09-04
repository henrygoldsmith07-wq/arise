// nativeShare.js — hand a file (coach export, CSV, backup) or text to the
// platform share sheet where one exists (Android, iOS 15+); fall back to a
// clipboard copy everywhere else. Never throws: sharing is a convenience, and
// a refused sheet (user swipe-away) must not surface as an error.

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
