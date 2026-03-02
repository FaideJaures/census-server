const { Router } = require('express');
const db = require('../db/connection');
const syncService = require('../services/sync.service');
const authMiddleware = require('../middleware/auth');

const router = Router();

router.use(authMiddleware);

// Pull: get data from server
router.get('/:login', (req, res) => {
  const { login } = req.params;
  const { since, page = 1, limit = 500 } = req.query;

  // Users can only pull their own data (admins can pull any)
  if (req.user.role !== 'admin' && req.user.login !== login.toUpperCase()) {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login.toUpperCase());
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  // Parse JSON fields for the user object
  user.children = user.children || '[]';
  user.regions = user.regions || '[]';

  try {
    const result = syncService.pull(
      { ...user, children: user.children },
      since || null,
      parseInt(page, 10),
      parseInt(limit, 10)
    );
    res.json(result);
  } catch (err) {
    console.error('Pull error:', err);
    res.status(500).json({ error: 'Erreur lors de la synchronisation' });
  }
});

// Push: send data to server
router.post('/:login', (req, res) => {
  const { login } = req.params;

  if (req.user.role !== 'admin' && req.user.login !== login.toUpperCase()) {
    return res.status(403).json({ error: 'Accès non autorisé' });
  }

  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login.toUpperCase());
  if (!user) {
    return res.status(404).json({ error: 'Utilisateur non trouvé' });
  }

  try {
    const result = syncService.push(
      { ...user, role: user.role },
      req.body
    );
    res.json(result);
  } catch (err) {
    console.error('Push error:', err);
    res.status(500).json({ error: 'Erreur lors de la synchronisation' });
  }
});

module.exports = router;
