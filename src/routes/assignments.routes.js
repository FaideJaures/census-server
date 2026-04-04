const { Router } = require('express');
const db = require('../db/connection');
const assignService = require('../services/assignment.service');
const authMiddleware = require('../middleware/auth');

const router = Router();

router.use(authMiddleware);

// GET /api/assignments — list assignments filtered by role
router.get('/', (req, res) => {
  try {
    let assignments;

    if (req.user.role === 'admin') {
      assignments = assignService.getAll();
    } else if (req.user.role === 'supervisor') {
      assignments = assignService.getForSupervisor(req.user.login);
    } else {
      assignments = assignService.getByOperator(req.user.login);
    }

    const formatted = assignments.map(a => ({
      sdCode: a.sd_code,
      operatorLogin: a.operator_login,
      assignedBy: a.assigned_by,
      assignedAt: a.assigned_at,
    }));

    res.json({ assignments: formatted });
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/assignments — create/update assignments (supervisor+)
router.post('/', (req, res) => {
  if (req.user.role === 'agent') {
    return res.status(403).json({ error: 'Les agents ne peuvent pas assigner de SD' });
  }

  const { assignments } = req.body;
  if (!assignments || !Array.isArray(assignments)) {
    return res.status(400).json({ error: 'Liste d\'assignations requise' });
  }

  try {
    const results = assignService.assignBatch(assignments, req.user.login);
    res.json({ assigned: results.length, assignments: results });
  } catch (err) {
    console.error('Post assignments error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/assignments/sd — assign SD codes to agents (supervisor+)
router.post('/sd', (req, res) => {
  const { operatorLogin, sdCodes } = req.body;
  if (!operatorLogin || !Array.isArray(sdCodes)) {
    return res.status(400).json({ error: 'operatorLogin et sdCodes[] requis' });
  }

  if (req.user.role === 'agent') {
    return res.status(403).json({ error: 'Non autorisé' });
  }

  if (req.user.role === 'supervisor') {
    // Check if operatorLogin is a child
    const targetUser = db.prepare('SELECT parent FROM users WHERE login = ?').get(operatorLogin);
    if (!targetUser || targetUser.parent !== req.user.login) {
      return res.status(403).json({ error: 'Vous ne pouvez assigner des SD qu\'à vos propres agents' });
    }
  }

  try {
    const results = assignService.assignBatch(
      sdCodes.map(sd => ({ sdCode: sd, operatorLogin })),
      req.user.login
    );
    res.json({ assigned: results.length, assignments: results });
  } catch (err) {
    console.error('Assign SD error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ─── Region/SD assignment (admin only) — now uses assignments table ─────

// GET /api/assignments/regions/:login — get a user's assigned SD codes
router.get('/regions/:login', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }
  try {
    const login = req.params.login.toUpperCase();
    const assignments = assignService.getByOperator(login);
    const regions = assignments.map(a => a.sd_code);
    res.json({ login, regions });
  } catch (err) {
    console.error('Get regions error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/assignments/regions — add SD assignments to a user (merge)
router.post('/regions', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }

  const targetLogin = (req.body.userLogin || req.body.supervisorLogin || '').toUpperCase();
  const { regions, userName } = req.body;
  if (!targetLogin || !regions || !Array.isArray(regions)) {
    return res.status(400).json({ error: 'userLogin et regions[] requis' });
  }

  try {
    if (userName) {
      const userService = require('../services/user.service');
      userService.ensureUserFromLocalData(targetLogin);
      db.prepare('UPDATE users SET name = ? WHERE login = ?').run(userName, targetLogin);
      db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
        req.user.login, 'rename_user', targetLogin, JSON.stringify({ newName: userName })
      );
    }

    const results = assignService.assignBatch(
      regions.map(sd => ({ sdCode: sd, operatorLogin: targetLogin })),
      req.user.login
    );

    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      req.user.login, 'assign_regions', targetLogin, JSON.stringify({ added: regions })
    );

    // Return current full list for this user
    const current = assignService.getByOperator(targetLogin).map(a => a.sd_code);
    res.json({ login: targetLogin, regions: current });
  } catch (err) {
    console.error('Assign regions error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/assignments/regions — replace all SD assignments for a user
router.put('/regions', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }

  const targetLogin = (req.body.userLogin || req.body.supervisorLogin || '').toUpperCase();
  const { regions, userName } = req.body;
  if (!targetLogin || !Array.isArray(regions)) {
    return res.status(400).json({ error: 'userLogin et regions[] requis' });
  }

  try {
    if (userName) {
      const userService = require('../services/user.service');
      userService.ensureUserFromLocalData(targetLogin);
      db.prepare('UPDATE users SET name = ? WHERE login = ?').run(userName, targetLogin);
      db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
        req.user.login, 'rename_user', targetLogin, JSON.stringify({ newName: userName })
      );
    }

    // Remove all existing assignments for this operator, then add new ones
    const existing = assignService.getByOperator(targetLogin).map(a => a.sd_code);
    if (existing.length > 0) {
      assignService.removeBatch(existing);
    }
    if (regions.length > 0) {
      assignService.assignBatch(
        regions.map(sd => ({ sdCode: sd, operatorLogin: targetLogin })),
        req.user.login
      );
    }

    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      req.user.login, 'set_regions', targetLogin, JSON.stringify({ regions })
    );

    res.json({ login: targetLogin, regions });
  } catch (err) {
    console.error('Set regions error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/assignments/regions — remove SD assignments from a user
router.delete('/regions', (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
  }

  const targetLogin = (req.body.userLogin || req.body.supervisorLogin || '').toUpperCase();
  const { regions, userName } = req.body;
  if (!targetLogin || !regions || !Array.isArray(regions)) {
    return res.status(400).json({ error: 'userLogin et regions[] requis' });
  }

  try {
    if (userName) {
      db.prepare('UPDATE users SET name = ? WHERE login = ?').run(userName, targetLogin);
      db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
        req.user.login, 'rename_user', targetLogin, JSON.stringify({ newName: userName })
      );
    }

    assignService.removeBatch(regions);

    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      req.user.login, 'remove_regions', targetLogin, JSON.stringify({ removed: regions })
    );

    // Return remaining assignments
    const remaining = assignService.getByOperator(targetLogin).map(a => a.sd_code);
    res.json({ login: targetLogin, regions: remaining });
  } catch (err) {
    console.error('Remove regions error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;

