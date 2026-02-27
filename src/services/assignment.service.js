const db = require('../db/connection');

function getAll() {
  return db.prepare('SELECT * FROM assignments ORDER BY assigned_at DESC').all();
}

function getByOperator(login) {
  return db.prepare('SELECT * FROM assignments WHERE operator_login = ?').all(login);
}

function getByAssigner(login) {
  // Get assignments made by this user (supervisor seeing their assignments)
  return db.prepare('SELECT * FROM assignments WHERE assigned_by = ?').all(login);
}

function getAccessibleSdCodes(user) {
  if (user.role === 'admin') {
    // Admin sees all assigned SDs
    return db.prepare('SELECT sd_code FROM assignments').all().map(r => r.sd_code);
  }

  if (user.role === 'supervisor') {
    // Supervisor sees SDs assigned to their children + themselves
    const children = JSON.parse(user.children || '[]');
    const logins = [user.login, ...children];
    const placeholders = logins.map(() => '?').join(',');
    return db.prepare(`SELECT sd_code FROM assignments WHERE operator_login IN (${placeholders})`).all(...logins).map(r => r.sd_code);
  }

  // Agent sees only their own assigned SDs
  return db.prepare('SELECT sd_code FROM assignments WHERE operator_login = ?').all(user.login).map(r => r.sd_code);
}

function assign(sdCode, operatorLogin, assignedBy) {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT OR REPLACE INTO assignments (sd_code, operator_login, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?)
  `).run(sdCode, operatorLogin, assignedBy, now);
  return { sdCode, operatorLogin, assignedBy, assignedAt: now };
}

function assignBatch(assignments, assignedBy) {
  const results = [];
  db.exec('BEGIN');
  try {
    for (const a of assignments) {
      const result = assign(a.sdCode || a.sd_code, a.operatorLogin || a.operator_login, assignedBy);
      results.push(result);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return results;
}

module.exports = { getAll, getByOperator, getByAssigner, getAccessibleSdCodes, assign, assignBatch };
