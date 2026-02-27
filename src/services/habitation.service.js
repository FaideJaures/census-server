const db = require('../db/connection');

function getById(id) {
  return db.prepare('SELECT * FROM habitations WHERE id = ?').get(id);
}

function getByAccessibleUser(user, since = null) {
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

  return db.prepare(query).all(...params);
}

function getByCreator(login) {
  return db.prepare('SELECT * FROM habitations WHERE created_by = ?').all(login);
}

function getAll() {
  return db.prepare('SELECT * FROM habitations').all();
}

function upsert(hab) {
  const existing = getById(hab.id);
  const now = new Date().toISOString();

  if (!existing) {
    db.prepare(`
      INSERT INTO habitations (id, ilot_code, sd_code, building_number, local_number, form_data, coordinates, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        form_data = ?, coordinates = ?, status = ?, updated_at = ?
      WHERE id = ?
    `).run(
      hab.ilotCode || hab.ilot_code || existing.ilot_code,
      hab.sdCode || hab.sd_code || existing.sd_code,
      hab.buildingNumber || hab.building_number || existing.building_number,
      hab.localNumber || hab.local_number || existing.local_number,
      JSON.stringify(hab.formData || hab.form_data || JSON.parse(existing.form_data)),
      JSON.stringify(hab.coordinates || JSON.parse(existing.coordinates)),
      hab.status || existing.status,
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
