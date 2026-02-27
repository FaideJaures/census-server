const path = require('path');

// Always load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  dbPath: process.env.DB_PATH || './data/census.db',
};
