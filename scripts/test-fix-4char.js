const path = require('path');
const fs = require('fs');

// Load env
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/db/connection');
const authService = require('../src/services/auth.service');

// Pick a 4-char user from data/users.json that is not an admin/supervisor
const usersPath = path.join(__dirname, '../data/users.json');
const { users } = JSON.parse(fs.readFileSync(usersPath, 'utf-8'));
const testLogin = Object.keys(users).find(login => users[login].role === 'agent');

if (!testLogin) {
    console.error('Could not find an agent in users.json');
    process.exit(1);
}

const testPassword = users[testLogin].password;

console.log(`Testing login for 4-char user: ${testLogin}`);

// 1. Verify user is NOT in DB
const before = db.prepare('SELECT * FROM users WHERE login = ?').get(testLogin);
if (before) {
    console.warn(`User ${testLogin} already exists in DB. Deleting for test...`);
    db.prepare('DELETE FROM users WHERE login = ?').run(testLogin);
}

// 2. Attempt login
try {
    const result = authService.login(testLogin, testPassword, '127.0.0.1');
    if (result && result.token) {
        console.log('✅ Login successful!');
        console.log('User Role:', result.user.role);
    } else {
        console.error('❌ Login failed!');
    }
} catch (err) {
    console.error('❌ Login error:', err);
}

// 3. Verify user is NOW in DB
const after = db.prepare('SELECT * FROM users WHERE login = ?').get(testLogin);
if (after) {
    console.log(`✅ User ${testLogin} successfully created in DB.`);
} else {
    console.error(`❌ User ${testLogin} was NOT created in DB.`);
}

process.exit(0);
