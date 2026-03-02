const path = require('path');

// Always load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || (() => {
    console.error('FATAL: JWT_SECRET not set in .env');
    process.exit(1);
  })(),
  dbPath: process.env.DB_PATH || './data/census.db',
};
