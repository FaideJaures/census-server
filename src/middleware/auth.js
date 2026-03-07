const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db/connection');

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token manquant' });
  }

  const token = header.slice(7);
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;

    // Update last_seen_at for this user's most recent session
    try {
      db.prepare(`
        UPDATE sessions SET last_seen_at = datetime('now')
        WHERE id = (SELECT id FROM sessions WHERE login = ? ORDER BY logged_in_at DESC LIMIT 1)
      `).run(payload.login);
    } catch { /* non-critical */ }

    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token invalide ou expiré' });
  }
}

module.exports = authMiddleware;
module.exports.auth = authMiddleware;

