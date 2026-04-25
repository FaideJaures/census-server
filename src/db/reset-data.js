const fs = require('fs');
const path = require('path');

// Load env before importing db
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./connection');

console.log('[Reset] Starting full schema reset...');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

// Tables to drop in order (foreign keys might be an issue, so we use a pragmatic approach)
const tablesToDrop = [
  'refresh_tokens',
  'sessions',
  'activity_log',
  'sync_log',
  'habitations',
  'assignments',
  'config',
  'movements'
];

db.exec('PRAGMA foreign_keys = OFF');
db.exec('BEGIN');
try {
  for (const table of tablesToDrop) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    console.log(`[Reset] Dropped table: ${table}`);
  }
  
  // Re-create all tables
  db.exec(schema);
  console.log('[Reset] Schema re-created successfully.');

  // Initialize db_version
  db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES ('db_version', ?)")
    .run(Date.now().toString());
  
  db.exec('COMMIT');
  console.log('[Reset] Full reset complete.');
} catch (err) {
  db.exec('ROLLBACK');
  console.error('[Reset] Error during reset:', err);
  process.exit(1);
} finally {
  db.exec('PRAGMA foreign_keys = ON');
}

process.exit(0);
