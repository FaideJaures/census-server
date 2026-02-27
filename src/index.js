const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');

// Initialize DB (runs schema)
require('./db/connection');

const app = express();

// Middleware
app.use(cors());
app.use(morgan('short'));
app.use(express.json({ limit: '10mb' }));

// Routes
app.use('/api/health', require('./routes/health.routes'));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/sync', require('./routes/sync.routes'));
app.use('/api/assignments', require('./routes/assignments.routes'));

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Erreur interne du serveur' });
});

app.listen(config.port, () => {
  console.log(`Census server running on port ${config.port}`);
});
