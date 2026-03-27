const path = require('path');

// Load env before importing db
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./connection');

console.log('[Reset] Starting data-only reset...');

// Tables to clear (preserving users and config)
const tablesToClear = [
  'activity_log',
  'sync_log',
  'sessions',
  'assignments',
  'habitations'
];

db.exec('BEGIN');
try {
  for (const table of tablesToClear) {
    db.exec(`DELETE FROM ${table}`);
    console.log(`[Reset] Cleared table: ${table}`);
  }
  
  // Optionally update db_version in config if it exists
  const updateVersion = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('db_version', ?)");
  updateVersion.run(Date.now().toString());
  
  db.exec('COMMIT');
  console.log('[Reset] Data reset complete. User accounts and passwords preserved.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[Reset] Error during reset:', err);
  process.exit(1);
}

process.exit(0);
