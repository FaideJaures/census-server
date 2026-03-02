const { Router } = require('express');
const db = require('../db/connection');

const { auth } = require('../middleware/auth');

const router = Router();

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

router.get('/details', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé' });
  }

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  const habCount = db.prepare('SELECT COUNT(*) as count FROM habitations').get();
  const assignCount = db.prepare('SELECT COUNT(*) as count FROM assignments').get();

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    stats: {
      users: userCount.count,
      habitations: habCount.count,
      assignments: assignCount.count,
    },
  });
});

module.exports = router;
