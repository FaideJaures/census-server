const { Router } = require('express');
const authService = require('../services/auth.service');

const router = Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ error: 'Login et mot de passe requis' });
  }

  const result = authService.login(login.toUpperCase(), password);
  if (!result) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }

  res.json(result);
});

module.exports = router;
