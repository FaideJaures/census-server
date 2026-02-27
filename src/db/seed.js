const path = require('path');
const fs = require('fs');

// Load env before importing db
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const db = require('./connection');

const usersPath = path.join(__dirname, '../../data/users.json');
const raw = fs.readFileSync(usersPath, 'utf-8');
const { masterPassword, users } = JSON.parse(raw);

// Store master password in config table
const upsertConfig = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
upsertConfig.run('master_password', masterPassword);

// Seed users
const upsertUser = db.prepare(`
  INSERT OR REPLACE INTO users (login, password, role, name, parent, province, province_name, regions, children)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

let count = 0;
db.exec('BEGIN');
try {
  for (const [login, u] of Object.entries(users)) {
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
console.log(`Seeded ${count} users into database.`);
console.log(`Master password stored in config table.`);
process.exit(0);
