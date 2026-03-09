const path = require('path');
const fs = require('fs');

// Load env before importing db
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./connection');

const usersPath = path.join(__dirname, '../../data/users.json');
const raw = fs.readFileSync(usersPath, 'utf-8');
const { masterPassword, users } = JSON.parse(raw);

// Full DB reset before seeding
db.exec('DELETE FROM activity_log');
db.exec('DELETE FROM sync_log');
db.exec('DELETE FROM sessions');
db.exec('DELETE FROM assignments');
db.exec('DELETE FROM habitations');
db.exec('DELETE FROM users');
db.exec('DELETE FROM config');
console.log('Database reset complete.');

// Store master password in config table
const upsertConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
upsertConfig.run('master_password', masterPassword);

const dbVersion = Date.now().toString();
upsertConfig.run('db_version', dbVersion);
console.log(`DB version set to: ${dbVersion}`);

// Seed users
const upsertUser = db.prepare(`
  INSERT OR REPLACE INTO users (login, password, role, name, parent, province, province_name, regions, children)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let count = 0;
db.exec('BEGIN');
try {
  for (const [login, u] of Object.entries(users)) {
    if (u.role === 'agent') {
      continue; // Agents are kept in users.json but NOT seeded into DB. They are created dynamically by 8A later.
    }
    upsertUser.run(
      login,
      u.password,
      u.role,
      u.name,
      u.parent || null,
      u.province || null,
      u.provinceName || null,
      JSON.stringify(u.regions || []),
      JSON.stringify(u.children || [])
    );
    count++;
  }
  db.exec('COMMIT');
} catch (err) {
  db.exec('ROLLBACK');
  throw err;
}
// Clean start: clear assignments and sessions
db.exec('DELETE FROM assignments');
db.exec('DELETE FROM sessions');
console.log(`Seeded ${count} users into database.`);
console.log(`Master password stored in config table.`);
console.log(`Cleared assignments and sessions tables for clean start.`);
process.exit(0);
