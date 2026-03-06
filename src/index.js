const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

// Initialize DB (runs schema)
require('./db/connection');

const app = express();

// Middleware
app.use(cors({
  origin: [
    'capacitor://localhost',
    'http://localhost',
    'http://localhost:3000',
    'http://localhost:3001',
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));

const rateLimit = require('express-rate-limit');

app.use('/api/', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Trop de requêtes. Réessayez dans quelques minutes.' },
}));

app.use('/api/auth/login', rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Increase max to 100 attempts
  message: { error: 'Trop de tentatives de connexion.' },
}));

app.use('/api/sync', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Synchronisation trop fréquente.' },
}));

// Routes
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/sync', require('./routes/sync.routes'));
app.use('/api/assignments', require('./routes/assignments.routes'));
app.use('/api/update', require('./routes/update.routes'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

app.listen(config.port, () => {
  console.log(`Census server running on port ${config.port}`);
});
