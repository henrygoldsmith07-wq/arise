// Session cookies: a compact HMAC-signed token, verified in constant time.
//
// Deliberately not a dependency. The whole requirement is "carry a user id and
// an expiry, and prove this server issued it", which is ~40 lines of node:crypto
// and avoids pulling a JWT library into an app that needs nothing else from one.
//
// The token is `base64url(payload).base64url(hmac)`. The payload is readable by
// anyone holding the cookie — it carries only a user id and timestamps, never
// anything secret — but it cannot be forged or altered without AUTH_SECRET.

import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'arise_session';
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

/** HTTPS-only cookies outside local development. */
export function useSecureCookies() {
  return process.env.NODE_ENV === 'production';
}

export class MissingAuthSecret extends Error {
  constructor() {
    super('AUTH_SECRET is not set. Generate one with: openssl rand -base64 32');
    this.name = 'MissingAuthSecret';
  }
}

function secret() {
  const value = process.env.AUTH_SECRET && process.env.AUTH_SECRET.trim();
  // Refusing to run without a secret is the point: a default would mean every
  // deployment sharing a forgeable signing key.
  if (!value) throw new MissingAuthSecret();
  return value;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payloadText) {
  return createHmac('sha256', secret()).update(payloadText).digest();
}

export function issueSession(userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = JSON.stringify({ uid: userId, iat: now, exp: now + SESSION_TTL_SECONDS });
  const encoded = b64url(payload);
  return `${encoded}.${b64url(sign(encoded))}`;
}

/** The user id inside a valid, unexpired token, or null. */
export function readSession(token) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;

  const encoded = token.slice(0, dot);
  const provided = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = sign(encoded);
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.uid !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload.uid;
}

function serializeCookie(name, value, maxAge) {
  const parts = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  if (useSecureCookies()) parts.push('Secure');
  return parts.join('; ');
}

export function setSessionCookie(res, token) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS));
}

export function clearSessionCookie(res) {
  appendCookie(res, serializeCookie(SESSION_COOKIE, '', 0));
}

/** Short-lived cookie holding the OAuth state and PKCE verifier. */
export function setFlowCookie(res, name, value) {
  appendCookie(res, serializeCookie(name, value, 600));
}

export function clearFlowCookie(res, name) {
  appendCookie(res, serializeCookie(name, '', 0));
}

function appendCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');
  const all = existing ? (Array.isArray(existing) ? existing : [existing]) : [];
  all.push(cookie);
  res.setHeader('Set-Cookie', all);
}

export function readCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

export function randomToken() {
  return randomBytes(32).toString('base64url');
}
