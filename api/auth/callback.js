// Completes Google sign-in: verifies state, exchanges the code, validates the
// id_token's claims, resolves the account and issues this app's session cookie.

import {
  callbackUrl,
  exchangeCode,
  GoogleNotConfigured,
  isGoogleConfigured,
  profileFromIdToken,
} from '../_lib/google.js';
import { DatabaseNotConfigured, upsertGoogleUser } from '../_lib/db.js';
import {
  clearFlowCookie,
  issueSession,
  MissingAuthSecret,
  readCookies,
  setSessionCookie,
} from '../_lib/session.js';
import { FLOW_COOKIE } from './google.js';

/** Sends the browser back to the app with a message it can show. */
function backToApp(res, params) {
  res.statusCode = 302;
  res.setHeader('Location', `/?${new URLSearchParams(params).toString()}`);
  res.end();
}

export default async function handler(req, res) {
  try {
    if (!isGoogleConfigured()) throw new GoogleNotConfigured();

    const url = new URL(req.url, 'http://localhost');
    const cookies = readCookies(req);
    clearFlowCookie(res, FLOW_COOKIE);

    // The user declining consent is a normal outcome, not an error.
    if (url.searchParams.get('error')) {
      return backToApp(res, { signin: 'cancelled' });
    }

    let flow;
    try {
      flow = JSON.parse(cookies[FLOW_COOKIE] || '');
    } catch {
      flow = null;
    }
    const state = url.searchParams.get('state');
    // Without this check an attacker can complete the flow in someone else's
    // browser and sign them into an account they do not control.
    if (!flow || !flow.state || !state || flow.state !== state) {
      return backToApp(res, { signin: 'failed', reason: 'state' });
    }

    const code = url.searchParams.get('code');
    if (!code) return backToApp(res, { signin: 'failed', reason: 'no-code' });

    const tokens = await exchangeCode({
      code,
      redirectUri: callbackUrl(req),
      verifier: flow.verifier,
    });
    const profile = profileFromIdToken(tokens.id_token);

    const user = await upsertGoogleUser(profile);
    setSessionCookie(res, issueSession(user.id));
    return backToApp(res, { signin: 'ok' });
  } catch (error) {
    if (error instanceof DatabaseNotConfigured || error instanceof GoogleNotConfigured
      || error instanceof MissingAuthSecret) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: error.message }));
    }
    // Anything else is a genuine failure. Log the detail; tell the user only
    // that it did not work, since the detail can carry token material.
    console.error('[auth] Google callback failed', error);
    return backToApp(res, { signin: 'failed' });
  }
}
