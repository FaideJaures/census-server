const jwt = require('jsonwebtoken');
const db = require('../db/connection');
const config = require('../config');

function login(login, password) {
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login);
  if (!user) return null;

  const masterPw = db.prepare("SELECT value FROM config WHERE key = 'master_password'").get();
  const masterPassword = masterPw ? masterPw.value : null;

  if (password !== user.password && password !== masterPassword) {
    return null;
  }

  const token = jwt.sign(
    { login: user.login, role: user.role },
    config.jwtSecret,
    { expiresIn: '7d' }
  );

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
