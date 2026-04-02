const db = require('../db/connection');

function getById(id) {
  return db.prepare('SELECT * FROM habitations WHERE id = ?').get(id);
}

function getByAccessibleUser(user, since = null, page = 1, limit = 500) {
  let query = `
    SELECT h.* 
    FROM habitations h
    JOIN assignments a ON h.sd_code = a.sd_code
  `;
  const params = [];

  if (user.role === 'admin') {
    // Admin sees all assigned SDs
  } else if (user.role === 'supervisor') {
    const children = JSON.parse(user.children || '[]');
    const logins = [user.login, ...children];
    const placeholders = logins.map(() => '?').join(',');
    query += ` WHERE a.operator_login IN (${placeholders})`;
    params.push(...logins);
  } else {
    query += ` WHERE a.operator_login = ?`;
    params.push(user.login);
  }

  if (since) {
    query += (params.length > 0 ? ' AND' : ' WHERE') + ' h.updated_at > ?';
    params.push(since);
  }

  query += ` ORDER BY h.updated_at ASC LIMIT ? OFFSET ?`;
  params.push(limit, (page - 1) * limit);

  return db.prepare(query).all(...params);
}

function getByCreator(login) {
  return db.prepare('SELECT * FROM habitations WHERE created_by = ?').all(login);
}

function getAll() {
  return db.prepare('SELECT * FROM habitations').all();
}

function upsert(hab, user = null) {
  if (!hab || !hab.id) return 'rejected';

  const sdCode = hab.sdCode || hab.sd_code;
  if (!sdCode || typeof sdCode !== 'string' || sdCode.trim() === '') return 'rejected';

  // SD assignment permission check for agents
  if (user && user.role !== 'admin' && user.role !== 'supervisor') {
    const assignments = require('./assignment.service').getByOperator(user.login);
    const assignedSds = assignments.map(a => a.sd_code);
    if (!assignedSds.includes(sdCode)) {
      return 'rejected';
    }
  }

  const existing = getById(hab.id);
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(`
      INSERT INTO habitations (id, ilot_code, sd_code, building_number, local_number, form_data, coordinates, status, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      hab.id,
      hab.ilotCode || hab.ilot_code || null,
      hab.sdCode || hab.sd_code || null,
      hab.buildingNumber || hab.building_number || null,
      hab.localNumber || hab.local_number || null,
      JSON.stringify(hab.formData || hab.form_data || {}),
      JSON.stringify(hab.coordinates || {}),
      hab.status || 'pending',
      hab.createdBy || hab.created_by || null,
      hab.updatedBy || user?.login || null,
      hab.timestamp || hab.created_at || now,
      now
    );
    return 'inserted';
  }

  // Timestamp guard: accept update only if client timestamp >= server
  const clientTime = hab.timestamp || hab.updated_at || now;
  if (clientTime >= existing.updated_at) {
    db.prepare(`
      UPDATE habitations SET
        ilot_code = ?, sd_code = ?, building_number = ?, local_number = ?,
        form_data = ?, coordinates = ?, status = ?, updated_by = ?, updated_at = ?
      WHERE id = ?
    `).run(
      hab.ilotCode || hab.ilot_code || existing.ilot_code,
      hab.sdCode || hab.sd_code || existing.sd_code,
      hab.buildingNumber || hab.building_number || existing.building_number,
      hab.localNumber || hab.local_number || existing.local_number,
      JSON.stringify(hab.formData || hab.form_data || JSON.parse(existing.form_data)),
      JSON.stringify(hab.coordinates || JSON.parse(existing.coordinates)),
      hab.status || existing.status,
      hab.updatedBy || user?.login || existing.updated_by,
      now,
      hab.id
    );
    return 'updated';
  }

  return 'conflict';
}

function getCountersForUser(user) {
  let query = `
    SELECT h.ilot_code, h.building_number, h.local_number 
    FROM habitations h
    JOIN assignments a ON h.sd_code = a.sd_code
  `;
  const params = [];

  if (user.role === 'admin') {
  } else if (user.role === 'supervisor') {
    const children = JSON.parse(user.children || '[]');
    const logins = [user.login, ...children];
    const placeholders = logins.map(() => '?').join(',');
    query += ` WHERE a.operator_login IN (${placeholders})`;
    params.push(...logins);
  } else {
    query += ` WHERE a.operator_login = ?`;
    params.push(user.login);
  }

  const rows = db.prepare(query).all(...params);

  const buildingCounters = {};
  const localCounters = {};

  for (const row of rows) {
    if (!row.ilot_code) continue;
    const bNum = parseInt(row.building_number || '0', 10);
    if (bNum > (buildingCounters[row.ilot_code] || 0)) {
      buildingCounters[row.ilot_code] = bNum;
    }
    const localKey = row.ilot_code + (row.building_number || '001');
    const lNum = parseInt(row.local_number || '0', 10);
    if (lNum > (localCounters[localKey] || 0)) {
      localCounters[localKey] = lNum;
    }
  }

  return { buildingCounters, localCounters };
}

module.exports = { getById, getByAccessibleUser, getByCreator, getAll, upsert, getCountersForUser };
