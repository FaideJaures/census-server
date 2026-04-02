const { Router } = require('express');
const authService = require('../services/auth.service');

const router = Router();

router.post('/login', (req, res) => {
  const { login, password } = req.body;

  if (!login || !password) {
    return res.status(400).json({ error: 'Login et mot de passe requis' });
  }

  const result = authService.login(login.toUpperCase(), password, req.ip);
  if (!result) {
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect' });
  }

  res.json(result);
});

router.post('/refresh', (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'refreshToken requis' });
  }

  const result = authService.refresh(refreshToken, req.ip);
  if (!result) {
    return res.status(401).json({ error: 'Refresh token invalide ou expiré' });
  }

  res.json(result);
});

module.exports = router;

