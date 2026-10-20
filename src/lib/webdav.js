// webdav.js — minimal WebDAV client for user-provided cloud storage.
//
// There is no Arise server: the user supplies any WebDAV endpoint
// (Nextcloud, ownCloud, Fastmail, Synology, many more) with their own
// credentials, and Arise stores one versioned (optionally encrypted) backup
// file there. GET / PUT, plus MKCOL to create the sync folder on first push —
// no PROPFIND, so no listing of the user's other files. A 404 on GET means
// "no remote yet" (first sync), not a failure.
//
// Writes are conditional when the server lets us see a strong ETag: the PUT
// carries If-Match with the tag from the pull, so a second device that wrote
// in between makes the PUT fail with 412 instead of being silently
// overwritten. runSync() then re-pulls, re-merges and retries.

const TIMEOUT_MS = 20000;

/** Thrown by push() when the remote file changed since this adapter's pull. */
export class WebdavConflictError extends Error {
  constructor(){
    super('The synced file changed on the server during this sync.');
    this.name = 'WebdavConflictError';
    this.conflict = true;
  }
}

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

// fetch() rejects with a bare TypeError ("Failed to fetch") for every
// network-level refusal: offline, DNS, TLS, and a server that does not allow
// cross-origin requests from this app (CORS). The browser does not say which,
// so the message names the likely causes instead of echoing "Failed to fetch".
function unreachable(url){
  let host = url;
  try{ host = new URL(url).host; }catch{}
  return new Error(`Could not reach ${host}. Check the address and your connection; the server must also allow requests from this app (CORS) — see the sync guide.`);
}

async function davFetch(url, options, externalSignal){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`WebDAV request timed out after ${TIMEOUT_MS / 1000}s.`)), TIMEOUT_MS);
  const relay = () => ctrl.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', relay, { once: true });
  try{
    return await fetch(url, { ...options, signal: ctrl.signal });
  }catch(err){
    if(err instanceof TypeError && !ctrl.signal.aborted) throw unreachable(url);
    throw err;
  }finally{
    clearTimeout(timer);
    externalSignal?.removeEventListener?.('abort', relay);
  }
}

// Only a strong validator can be used with If-Match (RFC 9110 §13.1.1 uses the
// strong comparison); a weak W/"…" tag would make every conditional PUT fail.
function strongEtag(res){
  const tag = res?.headers?.get?.('etag');
  return tag && !/^W\//.test(tag) ? tag : null;
}

/**
 * Build a { pull, push } adapter over a WebDAV remote.
 *   pull() → Uint8Array | null   (null when no remote file exists yet)
 *   push(body) → void           (PUT of string or bytes; throws
 *                                WebdavConflictError when the file changed
 *                                since pull())
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
  const auth = authHeader(username || '', password || '');
  const headers = { Authorization: auth, 'Content-Type': 'application/octet-stream' };
  // ETag of the version this adapter last read or wrote; null = unknown, so
  // the next PUT is unconditional (servers that hide ETag from CORS reads).
  let etag = null;

  // RFC 4918 §9.7.1: a PUT whose parent collection is missing MUST fail with
  // 409. Create each missing folder top-down; 405 means it already exists.
  async function ensureCollections(){
    const segments = path.split('/').slice(0, -1).filter(Boolean);
    for(let i = 1; i <= segments.length; i++){
      const res = await davFetch(`${base}/${segments.slice(0, i).join('/')}/`, { method: 'MKCOL', headers: { Authorization: auth } }, signal);
      if(!res.ok && res.status !== 405) throw new Error(`WebDAV could not create the sync folder: HTTP ${res.status}.`);
    }
  }

  async function put(body, conditional){
    const h = conditional && etag ? { ...headers, 'If-Match': etag } : headers;
    try{
      return await davFetch(fileUrl, { method: 'PUT', headers: h, body }, signal);
    }catch(err){
      // A server whose CORS policy exposes ETag but does not allow If-Match
      // fails the preflight; fall back to a plain PUT rather than never syncing.
      if(conditional && etag && !signal?.aborted && !/timed out/.test(String(err?.message))) return put(body, false);
      throw err;
    }
  }

  return {
    kind: 'webdav',
    fileUrl,
    async pull(){
      const res = await davFetch(fileUrl, { method: 'GET', headers }, signal);
      if(res.status === 404){ etag = null; return null; }
      if(!res.ok) throw new Error(`WebDAV pull failed: HTTP ${res.status}.`);
      etag = strongEtag(res);
      return new Uint8Array(await res.arrayBuffer());
    },
    async push(body){
      let res = await put(body, true);
      if(res.status === 409){
        await ensureCollections();
        res = await put(body, true);
      }
      if(res.status === 412) throw new WebdavConflictError();
      if(!res.ok) throw new Error(`WebDAV push failed: HTTP ${res.status}.`);
      etag = strongEtag(res);
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
