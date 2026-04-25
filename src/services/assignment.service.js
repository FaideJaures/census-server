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

function getForSupervisor(login) {
  // Get assignments for a supervisor + all their children (agents)
  const user = db.prepare('SELECT children FROM users WHERE login = ?').get(login);
  const children = JSON.parse(user?.children || '[]');
  const logins = [login, ...children];
  const placeholders = logins.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM assignments WHERE operator_login IN (${placeholders}) ORDER BY assigned_at DESC`).all(...logins);
}

function remove(sdCode, operatorLogin) {
  if (operatorLogin) {
    return db.prepare('DELETE FROM assignments WHERE sd_code = ? AND operator_login = ?').run(sdCode, operatorLogin);
  }
  return db.prepare('DELETE FROM assignments WHERE sd_code = ?').run(sdCode);
}

function removeBatch(assignments) {
  db.exec('BEGIN');
  try {
    const stmt = db.prepare('DELETE FROM assignments WHERE sd_code = ? AND operator_login = ?');
    for (const a of assignments) {
      stmt.run(a.sdCode || a.sd_code, a.operatorLogin || a.operator_login);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
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
  const userService = require('./user.service');
  userService.ensureUserFromLocalData((operatorLogin || '').trim().toUpperCase());

  const now = new Date().toISOString();
  // Ensure assignedBy is a login, not a display name.
  // We trim and uppercase it just in case.
  const finalAssigner = (assignedBy || '8A').trim().toUpperCase();

  db.prepare(`
    INSERT OR REPLACE INTO assignments (sd_code, operator_login, assigned_by, assigned_at)
    VALUES (?, ?, ?, ?)
  `).run(sdCode, operatorLogin.trim().toUpperCase(), finalAssigner, now);
  return { sdCode, operatorLogin, assignedBy: finalAssigner, assignedAt: now };
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

// ─── Region assignment (admin → supervisor) ─────────────────────────

function getRegions(login) {
  const user = db.prepare('SELECT regions FROM users WHERE login = ?').get(login);
  if (!user) return [];
  try { return JSON.parse(user.regions || '[]'); } catch { return []; }
}

function assignRegions(targetLogin, regionCodes, assignedBy, userName) {
  const userService = require('./user.service');

  // Ensure user exists first (creates from users.json if needed)
  userService.ensureUserFromLocalData(targetLogin);

  // Rename user if userName provided
  if (userName) {
    db.prepare('UPDATE users SET name = ? WHERE login = ?').run(userName, targetLogin);
    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      assignedBy || '8A', 'rename_user', targetLogin, JSON.stringify({ newName: userName })
    );
  }

  const existing = getRegions(targetLogin);
  const merged = [...new Set([...existing, ...regionCodes])].sort();
  db.prepare('UPDATE users SET regions = ? WHERE login = ?').run(JSON.stringify(merged), targetLogin);

  // Log the activity
  const logStmt = db.prepare(
    'INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)'
  );
  logStmt.run(assignedBy || '8A', 'assign_regions', targetLogin, JSON.stringify({ added: regionCodes, result: merged }));

  return { regions: merged };
}

function removeRegions(targetLogin, regionCodes, removedBy) {
  const existing = getRegions(targetLogin);
  const filtered = existing.filter(r => !regionCodes.includes(r));
  db.prepare('UPDATE users SET regions = ? WHERE login = ?').run(JSON.stringify(filtered), targetLogin);

  const logStmt = db.prepare(
    'INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)'
  );
  logStmt.run(removedBy || '8A', 'remove_regions', targetLogin, JSON.stringify({ removed: regionCodes, result: filtered }));

  return filtered;
}

function setRegions(targetLogin, regionCodes, assignedBy, userName) {
  const userService = require('./user.service');

  // Ensure user exists first (creates from users.json if needed)
  userService.ensureUserFromLocalData(targetLogin);

  // Rename user if userName provided
  if (userName) {
    db.prepare('UPDATE users SET name = ? WHERE login = ?').run(userName, targetLogin);
    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      assignedBy || '8A', 'rename_user', targetLogin, JSON.stringify({ newName: userName })
    );
  }

  const sorted = [...new Set(regionCodes)].sort();
  db.prepare('UPDATE users SET regions = ? WHERE login = ?').run(JSON.stringify(sorted), targetLogin);

  const logStmt = db.prepare(
    'INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)'
  );
  logStmt.run(assignedBy || '8A', 'set_regions', targetLogin, JSON.stringify({ regions: sorted }));

  return { regions: sorted };
}

module.exports = { getAll, getByOperator, getByAssigner, getForSupervisor, getAccessibleSdCodes, assign, assignBatch, remove, removeBatch, getRegions, assignRegions, removeRegions, setRegions };


