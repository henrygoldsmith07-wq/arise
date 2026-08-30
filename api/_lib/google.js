// Google OAuth 2.0 (OIDC) — authorization-code flow with PKCE.
//
// Written directly against Google's endpoints rather than through a library:
// this app needs identity and nothing else, and the flow is small enough that
// having it visible is worth more than the abstraction.
//
// Two things here are load-bearing and easy to get wrong, so they are explicit:
//
//  1. `state` is checked against a cookie this server set. Without it, an
//     attacker can complete the flow in a victim's browser with their own code
//     and sign the victim into the attacker's account (login CSRF).
//  2. The id_token's claims are only trusted after checking issuer, audience,
//     expiry and email_verified. Skipping email_verified would let anyone who
//     can create a Google account with someone else's address take over the
//     account that address already owns.
//
// The id_token arrives over TLS directly from Google's token endpoint in
// response to a code this server just sent, so its signature does not need
// separate verification — this is the flow Google documents as allowing that.
// If this ever moved to reading an id_token from the client, the signature
// would have to be verified against Google's JWKS first.

import { createHash } from 'node:crypto';
import { randomToken } from './session.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const VALID_ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

export class GoogleNotConfigured extends Error {
  constructor() {
    super(
      'Google sign-in is not configured. Set AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET, ' +
        'and add this deployment\'s /api/auth/callback URL to the OAuth client.',
    );
    this.name = 'GoogleNotConfigured';
  }
}

export function isGoogleConfigured() {
  return Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
}

function credentials() {
  if (!isGoogleConfigured()) throw new GoogleNotConfigured();
  return {
    clientId: process.env.AUTH_GOOGLE_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET,
  };
}

/**
 * Where Google sends the browser back. Derived from the request so a preview
 * deployment works without extra configuration, but AUTH_URL wins when set —
 * needed when a proxy rewrites the host.
 */
export function callbackUrl(req) {
  const configured = process.env.AUTH_URL && process.env.AUTH_URL.trim();
  if (configured) return `${configured.replace(/\/$/, '')}/api/auth/callback`;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}/api/auth/callback`;
}

/** PKCE: a high-entropy verifier and its S256 challenge. */
export function createPkce() {
  const verifier = randomToken();
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizationUrl({ redirectUri, state, challenge }) {
  const { clientId } = credentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    // Identity only — no API scope, so no refresh token is requested either.
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

/** Exchanges the code for tokens. Throws when Google rejects the exchange. */
export async function exchangeCode({ code, redirectUri, verifier }) {
  const { clientId, clientSecret } = credentials();
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Google rejected the code exchange (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json();
}

/** Decodes a JWT's claims WITHOUT verifying its signature. See the file header. */
function decodeClaims(idToken) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) throw new Error('Malformed id_token');
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}

/**
 * Validates the id_token's claims and returns the profile they assert.
 * Every rejection here is a refusal to sign anyone in.
 */
export function profileFromIdToken(idToken) {
  const { clientId } = credentials();
  const claims = decodeClaims(idToken);

  if (!VALID_ISSUERS.has(claims.iss)) throw new Error('id_token has an unexpected issuer');
  // The audience must be THIS client — a token minted for another application
  // is not evidence that this user meant to sign in here.
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(clientId)) throw new Error('id_token was issued for a different client');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) {
    throw new Error('id_token has expired');
  }
  if (!claims.sub) throw new Error('id_token carries no subject');
  if (!claims.email) throw new Error('id_token carries no email');
  // Accounts link by email, so an unverified address is a takeover vector.
  if (claims.email_verified !== true && claims.email_verified !== 'true') {
    throw new Error('Google has not verified this email address');
  }

  return {
    sub: String(claims.sub),
    email: String(claims.email),
    name: typeof claims.name === 'string' ? claims.name : null,
    image: typeof claims.picture === 'string' ? claims.picture : null,
  };
}
