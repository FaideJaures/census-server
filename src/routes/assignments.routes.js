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
      assignments = assignService.getByAssigner(req.user.login);
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

module.exports = router;
