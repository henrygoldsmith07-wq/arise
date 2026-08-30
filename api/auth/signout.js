// Signing out clears the session cookie. It can never fail: there is no server
// record to delete, and leaving someone signed in because a database was down
// would be the worst possible outcome here.

import { clearSessionCookie } from '../_lib/session.js';

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Allow', 'POST');
    return res.end();
  }
  clearSessionCookie(res);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true }));
}
