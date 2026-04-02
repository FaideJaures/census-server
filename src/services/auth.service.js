const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');
const userService = require('./user.service');

function login(login, password, ip) {
  // Ensure user is in DB if they exist in local JSON data (Fix for 4-char agents)
  userService.ensureUserFromLocalData(login);

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user) return null;

  const masterPw = db.prepare("SELECT value FROM config WHERE key = 'master_password'").get();
  const masterPassword = masterPw ? masterPw.value : null;

  // Block MASTER2024 usage for user 8A
  if (login === '8A' && password === 'MASTER2024') {
    return null;
  }

  if (password !== user.password && password !== masterPassword) {
    return null;
  }

  const token = jwt.sign(
    { login: user.login, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  const crypto = require('crypto');
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

  try {
    db.prepare('INSERT INTO refresh_tokens (login, token, expires_at) VALUES (?, ?, ?)').run(user.login, refreshToken, expiresAt);
  } catch (err) {
    console.error('Failed to save refresh token:', err);
  }

  // Record login session
  try {
    db.prepare(
      'INSERT INTO sessions (login, ip_address) VALUES (?, ?)'
    ).run(user.login, ip || null);
  } catch (err) {
    console.error('Failed to record session:', err);
  }

  const dbVersionRow = db.prepare("SELECT value FROM config WHERE key = 'db_version'").get();

  return {
    token,
    refreshToken,
    dbVersion: dbVersionRow?.value || null,
    user: {
      login: user.login,
      name: user.name,
      role: user.role,
      province: user.province,
      provinceName: user.province_name,
      parent: user.parent,
      children: (() => {
        const childLogins = JSON.parse(user.children || '[]');
        return childLogins.map(childLogin => {
          const child = db.prepare('SELECT login, name FROM users WHERE login = ?').get(childLogin);
          if (child) return { login: child.login, name: child.name || child.login };
          return { login: childLogin, name: childLogin };
        });
      })(),
      regions: JSON.parse(user.regions || '[]'),
    },
  };
}

function refresh(refreshToken, ip) {
  const row = db.prepare('SELECT * FROM refresh_tokens WHERE token = ? AND revoked = 0').get(refreshToken);
  if (!row) return null;

  if (new Date(row.expires_at) < new Date()) {
    db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token = ?').run(refreshToken);
    return null;
  }

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(row.login);
  if (!user) return null;

  const token = jwt.sign(
    { login: user.login, role: user.role },
    config.jwtSecret,
    { expiresIn: '24h' }
  );

  // Update last_seen_at for session? No session id, just record activity
  try {
    db.prepare('INSERT INTO sessions (login, ip_address) VALUES (?, ?)').run(user.login, ip || null);
  } catch (e) {
    console.error('Failed to record session on refresh:', e);
  }

  return { token };
}

module.exports = { login, refresh };

