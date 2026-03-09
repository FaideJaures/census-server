const db = require('../db/connection');

function randomPassword(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < len; i++) {
        pw += chars[Math.floor(Math.random() * chars.length)];
    }
    return pw;
}

function agentLogin(chiefLogin, index) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (index < 26) {
        return chiefLogin + letters[index];
    }
    return chiefLogin + '_' + (index + 1);
}

/**
 * Create agents for a supervisor if they don't already have any.
 * Returns array of { login, password } for newly created agents, or [] if agents already exist.
 */
function createAgentsForSupervisor(supervisorLogin) {
    const supervisor = db.prepare('SELECT * FROM users WHERE login = ?').get(supervisorLogin);
    if (!supervisor) {
        throw new Error(`Supervisor ${supervisorLogin} not found`);
    }

    // Check if supervisor already has children
    const existingChildren = JSON.parse(supervisor.children || '[]');
    if (existingChildren.length > 0) {
        return []; // Agents already exist
    }

    const fs = require('fs');
    const path = require('path');
    let usersData = {};
    try {
        const usersJsonRaw = fs.readFileSync(path.join(__dirname, '../../data/users.json'), 'utf-8');
        usersData = JSON.parse(usersJsonRaw).users || {};
    } catch (e) {
        console.warn('Could not read data/users.json for pre-generated passwords. Falling back to random.');
    }

    const count = 26; // A-Z
    const agentCredentials = [];
    const childrenLogins = [];

    const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO users (login, password, role, name, parent, province, province_name, regions, children)
    VALUES (?, ?, 'agent', ?, ?, ?, ?, '[]', '[]')
  `);

    db.exec('BEGIN');
    try {
        for (let i = 0; i < count; i++) {
            const login = agentLogin(supervisorLogin, i);
            let password = randomPassword();
            // Use pre-generated password if available
            if (usersData[login] && usersData[login].password) {
                password = usersData[login].password;
            }

            childrenLogins.push(login);

            insertStmt.run(
                login,
                password,
                `Agent ${login}`,
                supervisorLogin,
                supervisor.province || '',
                supervisor.province_name || ''
            );

            agentCredentials.push({ login, password, name: `Agent ${login}` });
        }

        // Update supervisor's children array
        db.prepare('UPDATE users SET children = ? WHERE login = ?')
            .run(JSON.stringify(childrenLogins), supervisorLogin);

        db.exec('COMMIT');
    } catch (err) {
        db.exec('ROLLBACK');
        throw err;
    }

    // Log the activity
    db.prepare(
        'INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)'
    ).run('8A', 'create_agents', supervisorLogin, JSON.stringify({ count, logins: childrenLogins }));

    return agentCredentials;
}

/**
 * Get all agents for a supervisor
 */
function getAgentsBySupervisor(supervisorLogin) {
    return db.prepare('SELECT login, name, role, regions, province, province_name FROM users WHERE parent = ?')
        .all(supervisorLogin)
        .map(u => ({
            login: u.login,
            name: u.name,
            role: u.role,
            regions: JSON.parse(u.regions || '[]'),
            province: u.province,
            provinceName: u.province_name,
        }));
}

/**
 * Get all users (for admin listing)
 */
function getAllUsers() {
    return db.prepare('SELECT login, name, role, province, province_name, regions, children, parent FROM users ORDER BY role, login')
        .all()
        .map(u => ({
            login: u.login,
            name: u.name,
            role: u.role,
            province: u.province,
            provinceName: u.province_name,
            regions: JSON.parse(u.regions || '[]'),
            children: JSON.parse(u.children || '[]'),
            parent: u.parent,
        }));
}

/**
 * Ensure a user exists in the database by fetching from data/users.json if missing.
 */
function ensureUserFromLocalData(login) {
    const existing = db.prepare('SELECT login FROM users WHERE login = ?').get(login);
    if (existing) return true; // Already exists

    const fs = require('fs');
    const path = require('path');
    try {
        const usersJsonRaw = fs.readFileSync(path.join(__dirname, '../../data/users.json'), 'utf-8');
        const usersData = JSON.parse(usersJsonRaw).users || {};
        const userData = usersData[login];

        if (userData) {
            db.prepare(`
                INSERT INTO users (login, password, role, name, parent, province, province_name, regions, children)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                login,
                userData.password || randomPassword(),
                userData.role || 'agent',
                userData.name || login,
                userData.parent || null,
                userData.province || '',
                userData.provinceName || '',
                JSON.stringify(userData.regions || []),
                JSON.stringify(userData.children || [])
            );
            return true;
        }
    } catch (e) {
        console.error('Error ensuring user from local data:', e);
    }
    return false;
}

module.exports = { createAgentsForSupervisor, getAgentsBySupervisor, getAllUsers, randomPassword, agentLogin, ensureUserFromLocalData };
