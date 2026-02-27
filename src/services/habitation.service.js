const db = require('../db/connection');

function getById(id) {
  return db.prepare('SELECT * FROM habitations WHERE id = ?').get(id);
}

function getBySdCodes(sdCodes) {
  if (!sdCodes || sdCodes.length === 0) return [];
  const placeholders = sdCodes.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM habitations WHERE sd_code IN (${placeholders})`).all(...sdCodes);
}

function getByCreator(login) {
  return db.prepare('SELECT * FROM habitations WHERE created_by = ?').all(login);
}

function getAll() {
  return db.prepare('SELECT * FROM habitations').all();
}

function getSince(sdCodes, since) {
  if (!sdCodes || sdCodes.length === 0) return [];
  const placeholders = sdCodes.map(() => '?').join(',');
  return db.prepare(
    `SELECT * FROM habitations WHERE sd_code IN (${placeholders}) AND updated_at > ?`
  ).all(...sdCodes, since);
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

function getCounters(sdCodes) {
  if (!sdCodes || sdCodes.length === 0) return { buildingCounters: {}, localCounters: {} };

  const placeholders = sdCodes.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT ilot_code, building_number, local_number FROM habitations WHERE sd_code IN (${placeholders})`
  ).all(...sdCodes);

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

module.exports = { getById, getBySdCodes, getByCreator, getAll, getSince, upsert, getCounters };
