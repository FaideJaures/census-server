const db = require('../db/connection');

function getById(id) {
  return db.prepare('SELECT * FROM habitations WHERE id = ?').get(id);
}

function getByAccessibleUser(user, since = null, page = 1, limit = 500) {
  let query;
  const params = [];

  if (user.role === 'admin') {
    query = `SELECT h.* FROM habitations h`;
  } else {
    // For non-admins, we see habitations created by our team OR in our assigned regions
    const children = JSON.parse(user.children || '[]');
    const teamLogins = [user.login, ...children].map(l => (typeof l === 'string' ? l : l.login));
    const placeholders = teamLogins.map(() => '?').join(',');

    query = `
      SELECT DISTINCT h.* 
      FROM habitations h
      LEFT JOIN assignments a ON h.sd_code LIKE a.sd_code || '%'
      WHERE (a.operator_login IN (${placeholders}) OR h.created_by IN (${placeholders}))
    `;
    params.push(...teamLogins, ...teamLogins);
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

  // Check if SD is locked
  const lock = db.prepare('SELECT sd_code FROM sd_locks WHERE ? LIKE sd_code || \'%\'').get(sdCode);
  if (lock) {
    console.warn(`[HabitationService] Rejected update for SD ${sdCode} because it is LOCKED.`);
    return 'rejected';
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
  let query;
  const params = [];

  if (user.role === 'admin') {
    query = `SELECT ilot_code, building_number, local_number FROM habitations`;
  } else {
    const children = JSON.parse(user.children || '[]');
    const teamLogins = [user.login, ...children].map(l => (typeof l === 'string' ? l : l.login));
    const placeholders = teamLogins.map(() => '?').join(',');

    query = `
      SELECT DISTINCT h.ilot_code, h.building_number, h.local_number 
      FROM habitations h
      LEFT JOIN assignments a ON h.sd_code LIKE a.sd_code || '%'
      WHERE (a.operator_login IN (${placeholders}) OR h.created_by IN (${placeholders}))
    `;
    params.push(...teamLogins, ...teamLogins);
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

function getKPIsForUser(user) {
  let query;
  const params = [];

  if (user.role === 'admin') {
    query = `SELECT form_data FROM habitations`;
  } else {
    const children = JSON.parse(user.children || '[]');
    const teamLogins = [user.login, ...children].map(l => (typeof l === 'string' ? l : l.login));
    const placeholders = teamLogins.map(() => '?').join(',');

    query = `
      SELECT DISTINCT h.id, h.form_data 
      FROM habitations h
      LEFT JOIN assignments a ON h.sd_code LIKE a.sd_code || '%'
      WHERE (a.operator_login IN (${placeholders}) OR h.created_by IN (${placeholders}))
    `;
    params.push(...teamLogins, ...teamLogins);
  }

  const rows = db.prepare(query).all(...params);
  let numerote = 0, recense = 0, nonVisite = 0;
  
  for (const row of rows) {
    const data = JSON.parse(row.form_data || '{}');
    if (data.VC16A === '1') numerote++;
    else if (data.VC16A === '2') recense++;
    else nonVisite++;
  }

  return { numerote, recense, nonVisite, total: rows.length };
}
function getLocks() {
  return db.prepare('SELECT sd_code, locked_by, locked_at FROM sd_locks').all();
}

module.exports = { getById, getByAccessibleUser, getByCreator, getAll, upsert, getCountersForUser, getLocks, getKPIsForUser };
