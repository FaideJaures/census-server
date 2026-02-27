const { Router } = require('express');
const db = require('../db/connection');

const router = Router();

router.get('/', (req, res) => {
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
