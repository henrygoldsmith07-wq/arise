// Who is signed in? Answers `{ user: null }` when nobody is — being signed out
// is a normal state, not an error the client has to special-case.

import { DatabaseNotConfigured, findUserById } from '../_lib/db.js';
import { isGoogleConfigured } from '../_lib/google.js';
import { MissingAuthSecret, readCookies, readSession, SESSION_COOKIE } from '../_lib/session.js';

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  // `available` lets the UI hide sign-in entirely on a deployment that has no
  // accounts configured, rather than offering a button that cannot work.
  const available = isGoogleConfigured();

  try {
    const userId = readSession(readCookies(req)[SESSION_COOKIE]);
    if (!userId) return res.end(JSON.stringify({ available, user: null }));

    // The token outlives the row it names, so resolve it every time: a deleted
    // account must stop working at once.
    const user = await findUserById(userId);
    if (!user) return res.end(JSON.stringify({ available, user: null }));

    return res.end(JSON.stringify({
      available,
      user: { id: user.id, email: user.email, name: user.name, image: user.image },
    }));
  } catch (error) {
    if (error instanceof DatabaseNotConfigured || error instanceof MissingAuthSecret) {
      return res.end(JSON.stringify({ available: false, user: null }));
    }
    console.error('[auth] session lookup failed', error);
    res.statusCode = 500;
    return res.end(JSON.stringify({ available, user: null, error: 'Session lookup failed' }));
  }
}
