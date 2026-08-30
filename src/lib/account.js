// Google account and cross-device sync.
//
// Sync deliberately reuses the backup format and the merge that Export/Import
// already uses: `buildExportPayload` produces what is uploaded, and
// `mergeStores` folds a downloaded copy back in. Inventing a second, parallel
// notion of "all my data" is how the two drift apart and one of them starts
// quietly losing sessions.
//
// The server never merges. It stores one document per account and reports when
// it last changed; this module decides what to do about it, because only the
// client can see both copies.

const SIGNED_OUT = { available: false, user: null };

/**
 * Who is signed in, and whether sign-in exists on this deployment at all.
 * Never throws: no accounts configured is a normal state, not an error.
 */
export async function fetchAccount(){
  try{
    const response = await fetch('/api/auth/session', { headers:{ accept:'application/json' } });
    if(!response.ok) return SIGNED_OUT;
    const body = await response.json();
    return { available: Boolean(body.available), user: body.user ?? null };
  } catch {
    // A Vite dev server with no API routes lands here — the right answer is
    // "no accounts", not a broken screen.
    return SIGNED_OUT;
  }
}

export function startGoogleSignIn(){
  // A full navigation: the consent screen is Google's page, not ours.
  window.location.href = '/api/auth/google';
}

export async function signOut(){
  await fetch('/api/auth/signout', { method:'POST' }).catch(()=>{});
}

/** When the account's snapshot last changed on the server, or null. */
export async function remoteUpdatedAt(){
  const response = await fetch('/api/sync', { headers:{ accept:'application/json' } });
  if(!response.ok) return null;
  const body = await response.json();
  return body.state?.updated_at ?? null;
}

/**
 * Uploads `payload` for this account.
 *
 * `expected` is the timestamp the caller believes is on the server. If the
 * server has moved on, the push is refused as a conflict rather than silently
 * overwriting a copy this device has never seen — losing a training history
 * that way is not recoverable. `force` overwrites deliberately, after asking.
 */
export async function push(payload, expected, force=false){
  if(!force){
    const actual = await remoteUpdatedAt();
    if(actual !== expected) return { status:'conflict', remoteUpdatedAt: actual };
  }
  const response = await fetch('/api/sync', {
    method:'PUT',
    headers:{ 'content-type':'application/json' },
    body: JSON.stringify({ payload, version: payload?.data?.version ?? 1 }),
  });
  if(response.status === 401) return { status:'signed-out' };
  if(response.status === 503) return { status:'unavailable', message:'Sync is not configured for this deployment.' };
  if(!response.ok){
    const body = await response.json().catch(()=>({}));
    return { status:'error', message: body.error || `Sync failed (${response.status})` };
  }
  const body = await response.json();
  return { status:'ok', updatedAt: body.updated_at };
}

/** Downloads this account's snapshot, or reports that there is not one yet. */
export async function pull(){
  const response = await fetch('/api/sync', { headers:{ accept:'application/json' } });
  if(response.status === 401) return { status:'signed-out' };
  if(response.status === 503) return { status:'unavailable', message:'Sync is not configured for this deployment.' };
  if(!response.ok) return { status:'error', message:`Sync failed (${response.status})` };
  const body = await response.json();
  if(!body.state) return { status:'empty' };
  return { status:'ok', payload: body.state.payload, updatedAt: body.state.updated_at };
}

/** Removes the account's snapshot from the server. This device keeps its data. */
export async function deleteRemote(){
  const response = await fetch('/api/sync', { method:'DELETE' });
  if(!response.ok) return { status:'error', message:`Delete failed (${response.status})` };
  return { status:'empty' };
}
