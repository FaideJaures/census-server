require('dotenv').config();

module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  jwtSecret: process.env.JWT_SECRET || 'fallback-secret',
  dbPath: process.env.DB_PATH || './data/census.db',
};
