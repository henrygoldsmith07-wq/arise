// webdav.js — minimal WebDAV client for user-provided cloud storage.
//
// There is no Arise sync server: the user supplies any WebDAV endpoint
// (Nextcloud, ownCloud, Fastmail, Synology, many more) with their own
// credentials, and Arise stores one versioned (optionally encrypted) backup
// file there. PUT / GET only — no PROPFIND, so no listing of the user's other
// files. A 404 on GET means "no remote yet" (first sync), not a failure.

const TIMEOUT_MS = 20000;

/** Normalize a base URL: trim, ensure no trailing slash, and validate scheme. */
export function webdavBaseUrl(url){
  const trimmed = String(url || '').trim().replace(/\/+$/, '');
  if(!/^https:\/\//i.test(trimmed)) throw new Error('WebDAV URL must use https:// — your credentials travel to that server.');
  return trimmed;
}

function authHeader(username, password){
  const raw = `${username}:${password}`;
  // btoa for latin1; credentials are ASCII in practice (usernames can contain
  // non-ASCII on some providers — encode via UTF-8 first to be safe).
  return 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(raw)));
}

async function davFetch(url, options, externalSignal){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`WebDAV request timed out after ${TIMEOUT_MS / 1000}s.`)), TIMEOUT_MS);
  const relay = () => ctrl.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', relay, { once: true });
  try{
    return await fetch(url, { ...options, signal: ctrl.signal });
  }finally{
    clearTimeout(timer);
  }
}

/**
 * Build a { pull, push } adapter over a WebDAV remote.
 *   pull() → Uint8Array | null   (null when no remote file exists yet)
 *   push(body) → void           (PUT of string or bytes, overwrites previous)
 *
 * Bytes are the transport truth: an encrypted envelope is a binary container
 * ([ARCB][salt][iv][AES-GCM ciphertext]) and decoding it as text would
 * irreversibly replace invalid UTF-8 sequences with U+FFFD, destroying the
 * ciphertext. Plaintext JSON is also valid bytes, so one path handles both.
 */
export function makeWebdavAdapter({ url, username, password, filePath = 'arise-sync/arise-backup.arise', signal = null } = {}){
  const base = webdavBaseUrl(url);
  const path = String(filePath || '').replace(/^\/+/, '');
  const fileUrl = `${base}/${path}`;
  const headers = {
    Authorization: authHeader(username || '', password || ''),
    'Content-Type': 'application/octet-stream',
  };
  return {
    kind: 'webdav',
    fileUrl,
    async pull(){
      const res = await davFetch(fileUrl, { method: 'GET', headers }, signal);
      if(res.status === 404) return null;
      if(!res.ok) throw new Error(`WebDAV pull failed: HTTP ${res.status}.`);
      return new Uint8Array(await res.arrayBuffer());
    },
    async push(body){
      const res = await davFetch(fileUrl, { method: 'PUT', headers, body }, signal);
      if(!res.ok) throw new Error(`WebDAV push failed: HTTP ${res.status}.`);
    },
  };
}

/** Connectivity check for the settings form: never reads file contents. */
export async function webdavCheck({ url, username, password } = {}){
  const base = webdavBaseUrl(url);
  const res = await davFetch(`${base}/`, { method: 'OPTIONS', headers: { Authorization: authHeader(username || '', password || '') } }, null);
  if(res.status === 401) throw new Error('Server rejected the credentials (401).');
  if(!res.ok && res.status !== 404) throw new Error(`Server responded HTTP ${res.status}.`);
  const allow = res.headers.get('allow') || res.headers.get('dav') || '';
  return { ok: true, dav: Boolean(allow) };
}
