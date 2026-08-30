// Starts Google sign-in: mints state + PKCE, stores them in a short-lived
// cookie, and redirects to Google's consent screen.

import {
  authorizationUrl,
  callbackUrl,
  createPkce,
  GoogleNotConfigured,
  isGoogleConfigured,
} from '../_lib/google.js';
import { MissingAuthSecret, randomToken, setFlowCookie } from '../_lib/session.js';

export const FLOW_COOKIE = 'arise_oauth_flow';

export default async function handler(req, res) {
  try {
    if (!isGoogleConfigured()) throw new GoogleNotConfigured();

    const state = randomToken();
    const { verifier, challenge } = createPkce();
    // State and verifier live in an httpOnly cookie, never in the URL or in
    // server memory: the callback may well be served by a different instance.
    setFlowCookie(res, FLOW_COOKIE, JSON.stringify({ state, verifier }));

    res.statusCode = 302;
    res.setHeader('Location', authorizationUrl({
      redirectUri: callbackUrl(req),
      state,
      challenge,
    }));
    res.end();
  } catch (error) {
    const known = error instanceof GoogleNotConfigured || error instanceof MissingAuthSecret;
    res.statusCode = known ? 503 : 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: known ? error.message : 'Could not start sign-in' }));
    if (!known) console.error('[auth] failed to start Google sign-in', error);
  }
}
