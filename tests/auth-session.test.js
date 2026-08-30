// Session tokens and id_token claim validation.
//
// These are the two places where a mistake means "anyone can sign in as
// anyone", so they get direct tests rather than being covered only through the
// HTTP handlers.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_SECRET = 'test-secret-not-a-real-one';
process.env.AUTH_GOOGLE_ID = 'test-client-id.apps.googleusercontent.com';
process.env.AUTH_GOOGLE_SECRET = 'test-client-secret';

const { createHmac } = await import('node:crypto');
const { issueSession, readSession } = await import('../api/_lib/session.js');
const { profileFromIdToken } = await import('../api/_lib/google.js');

const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
/** A JWT with the given claims. The signature is never checked — see google.js. */
const idToken = (claims) => `${b64url({ alg: 'RS256' })}.${b64url(claims)}.signature`;

const validClaims = (overrides = {}) => ({
  iss: 'https://accounts.google.com',
  aud: 'test-client-id.apps.googleusercontent.com',
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: '1234567890',
  email: 'person@example.com',
  email_verified: true,
  name: 'A Person',
  ...overrides,
});

describe('session tokens', () => {
  test('round-trips the user id it was issued for', () => {
    assert.equal(readSession(issueSession('user-abc')), 'user-abc');
  });

  test('rejects a token whose payload was altered', () => {
    const token = issueSession('user-abc');
    const [, signature] = token.split('.');
    const forged = `${Buffer.from(JSON.stringify({
      uid: 'somebody-else',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url')}.${signature}`;
    assert.equal(readSession(forged), null);
  });

  test('rejects a token signed with a different secret', () => {
    const token = issueSession('user-abc');
    process.env.AUTH_SECRET = 'a-different-secret';
    assert.equal(readSession(token), null);
    process.env.AUTH_SECRET = 'test-secret-not-a-real-one';
  });

  test('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const encoded = Buffer.from(JSON.stringify({ uid: 'u', iat: past - 10, exp: past }))
      .toString('base64url');
    // Sign it properly, so expiry is the only thing that can reject it.
    const signature = createHmac('sha256', process.env.AUTH_SECRET).update(encoded).digest('base64url');
    assert.equal(readSession(`${encoded}.${signature}`), null);
  });

  test('rejects garbage without throwing', () => {
    for (const bad of [undefined, null, '', 'nodot', 'a.b', '....', 42, {}]) {
      assert.equal(readSession(bad), null);
    }
  });
});

describe('id_token claim validation', () => {
  test('accepts a well-formed token from Google for this client', () => {
    const profile = profileFromIdToken(idToken(validClaims()));
    assert.equal(profile.sub, '1234567890');
    assert.equal(profile.email, 'person@example.com');
    assert.equal(profile.name, 'A Person');
  });

  test('refuses an unverified email — this is the account-takeover guard', () => {
    // Accounts link by email. Honouring an unverified address would let anyone
    // who can create a Google account with someone else's address take over
    // the account that address already owns.
    assert.throws(
      () => profileFromIdToken(idToken(validClaims({ email_verified: false }))),
      /not verified/i,
    );
    assert.throws(
      () => profileFromIdToken(idToken(validClaims({ email_verified: undefined }))),
      /not verified/i,
    );
  });

  test('refuses a token minted for a different client', () => {
    assert.throws(
      () => profileFromIdToken(idToken(validClaims({ aud: 'someone-elses-client-id' }))),
      /different client/i,
    );
  });

  test('refuses an unexpected issuer', () => {
    assert.throws(
      () => profileFromIdToken(idToken(validClaims({ iss: 'https://evil.example' }))),
      /issuer/i,
    );
  });

  test('refuses an expired token', () => {
    assert.throws(
      () => profileFromIdToken(idToken(validClaims({ exp: Math.floor(Date.now() / 1000) - 1 }))),
      /expired/i,
    );
  });

  test('refuses a token with no subject or no email', () => {
    assert.throws(() => profileFromIdToken(idToken(validClaims({ sub: undefined }))), /subject/i);
    assert.throws(() => profileFromIdToken(idToken(validClaims({ email: undefined }))), /email/i);
  });

  test('accepts an audience array that contains this client', () => {
    const profile = profileFromIdToken(
      idToken(validClaims({ aud: ['other-client', 'test-client-id.apps.googleusercontent.com'] })),
    );
    assert.equal(profile.email, 'person@example.com');
  });
});
