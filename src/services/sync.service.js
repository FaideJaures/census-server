const db = require('../db/connection');
const habService = require('./habitation.service');
const assignService = require('./assignment.service');

function pull(user, since) {
  const logId = startSyncLog(user.login, 'pull');

  try {
    // Determine accessible SD codes based on role
    const sdCodes = assignService.getAccessibleSdCodes(user);

    // Get habitations (optionally filtered by since timestamp)
    let habitations;
    if (since) {
      habitations = habService.getSince(sdCodes, since);
    } else {
      habitations = sdCodes.length > 0 ? habService.getBySdCodes(sdCodes) : [];
    }

    // Get assignments for accessible SDs
    let assignments;
    if (user.role === 'admin') {
      assignments = assignService.getAll();
    } else if (user.role === 'supervisor') {
      assignments = assignService.getByAssigner(user.login);
    } else {
      assignments = assignService.getByOperator(user.login);
    }

    // Get counters for accessible SDs
    const counters = habService.getCounters(sdCodes);

    // Format habitations for client consumption
    const formattedHabs = habitations.map(h => ({
      id: h.id,
      ilotCode: h.ilot_code,
      sdCode: h.sd_code,
      buildingNumber: h.building_number,
      localNumber: h.local_number,
      formData: JSON.parse(h.form_data || '{}'),
      coordinates: JSON.parse(h.coordinates || '{}'),
      status: h.status,
      createdBy: h.created_by,
      timestamp: h.updated_at,
    }));

    // Format assignments for client consumption
    const formattedAssignments = assignments.map(a => ({
      sdCode: a.sd_code,
      operatorLogin: a.operator_login,
      assignedBy: a.assigned_by,
      assignedAt: a.assigned_at,
    }));

    completeSyncLog(logId, formattedHabs.length, 'success');

    return {
      habitations: formattedHabs,
      assignments: formattedAssignments,
      counters,
      serverTime: new Date().toISOString(),
    };
  } catch (err) {
    completeSyncLog(logId, 0, 'error');
    throw err;
  }
}

function push(user, data) {
  const logId = startSyncLog(user.login, 'push');
  const results = { accepted: 0, rejected: 0, conflicts: 0 };

  try {
    // Process habitations
    if (data.habitations && Array.isArray(data.habitations)) {
      db.exec('BEGIN');
      try {
        for (const hab of data.habitations) {
          const result = habService.upsert(hab);
          if (result === 'inserted' || result === 'updated') {
            results.accepted++;
            logActivity(user.login, result === 'inserted' ? 'create_habitation' : 'update_habitation', hab.id);
          } else if (result === 'conflict') {
            results.conflicts++;
          } else {
            results.rejected++;
          }
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    }

    // Process assignments
    if (data.assignments && Array.isArray(data.assignments)) {
      db.exec('BEGIN');
      try {
        for (const a of data.assignments) {
          assignService.assign(
            a.sdCode || a.sd_code,
            a.operatorLogin || a.operator_login,
            a.assignedBy || a.assigned_by || user.login
          );
          logActivity(user.login, 'assign_sd', a.sdCode || a.sd_code, {
            operator: a.operatorLogin || a.operator_login,
          });
        }
        db.exec('COMMIT');
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    }

    completeSyncLog(logId, results.accepted, 'success');

    return {
      ...results,
      serverTime: new Date().toISOString(),
    };
  } catch (err) {
    completeSyncLog(logId, results.accepted, 'error');
    throw err;
  }
}

function startSyncLog(login, direction) {
  const result = db.prepare(
    'INSERT INTO sync_log (login, direction, status) VALUES (?, ?, ?)'
  ).run(login, direction, 'started');
  return result.lastInsertRowid;
}

function completeSyncLog(id, count, status) {
  db.prepare(
    "UPDATE sync_log SET records_count = ?, status = ?, completed_at = datetime('now') WHERE id = ?"
  ).run(count, status, id);
}

function logActivity(login, action, targetId, details) {
  db.prepare(
    'INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)'
  ).run(login, action, targetId || null, JSON.stringify(details || {}));
}

module.exports = { pull, push };
