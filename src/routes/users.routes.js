const { Router } = require('express');
const db = require('../db/connection');
const authMiddleware = require('../middleware/auth');
const userService = require('../services/user.service');

const router = Router();
router.use(authMiddleware);

// PUT /api/users/:login/name — rename a user
router.put('/:login/name', (req, res) => {
  const targetLogin = req.params.login.toUpperCase();
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'name requis' });
  }

  // Ensure target user is instantiated in the DB
  userService.ensureUserFromLocalData(targetLogin);

  // Authorization check
  if (req.user.role === 'agent') {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }

  if (req.user.role === 'supervisor') {
    const user = db.prepare('SELECT parent FROM users WHERE login = ?').get(targetLogin);
    if (!user || user.parent !== req.user.login) {
      return res.status(403).json({ error: 'Vous ne pouvez renommer que vos propres agents' });
    }
  }

  try {
    db.prepare('UPDATE users SET name = ? WHERE login = ?').run(name, targetLogin);
    db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
      req.user.login, 'rename_user', targetLogin, JSON.stringify({ newName: name })
    );
    res.json({ login: targetLogin, name });
  } catch (err) {
    console.error('Rename user error:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
