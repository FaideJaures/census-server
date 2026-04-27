const { Router } = require('express');
const db = require('../db/connection');
const authMiddleware = require('../middleware/auth');

const router = Router();

router.use(authMiddleware);

// GET /api/admin/state — full server state for 8A admin
router.get('/state', (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    }

    try {
        // Recent sessions (last 100 login events)
        const sessions = db.prepare(`
      SELECT s.login, u.name, u.role, s.logged_in_at, s.last_seen_at, s.ip_address
      FROM sessions s
      LEFT JOIN users u ON s.login = u.login
      ORDER BY s.logged_in_at DESC
      LIMIT 100
    `).all();

        // Sync activity (last 100 sync events)
        const syncActivity = db.prepare(`
      SELECT login, direction, records_count, status, started_at, completed_at
      FROM sync_log
      ORDER BY started_at DESC
      LIMIT 100
    `).all();

        // All users with their roles and current region assignments
        const users = db.prepare(`
      SELECT login, name, role, province, province_name, regions, children, parent
      FROM users
      ORDER BY role, login
    `).all().map(u => ({
            login: u.login,
            name: u.name,
            role: u.role,
            province: u.province,
            provinceName: u.province_name,
            regions: JSON.parse(u.regions || '[]'),
            children: JSON.parse(u.children || '[]'),
            parent: u.parent,
        }));

        // Assignment summary: count per operator
        const assignmentSummary = db.prepare(`
      SELECT operator_login, COUNT(*) as sd_count
      FROM assignments
      GROUP BY operator_login
      ORDER BY sd_count DESC
    `).all();

        // Activity log (last 100 entries)
        const activityLog = db.prepare(
            'SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 100'
        ).all();

        // All assignments (sd_code → operator mapping)
        const allAssignments = db.prepare('SELECT sd_code, operator_login, assigned_by FROM assignments').all();

        // Total counts
        const habCount = db.prepare('SELECT COUNT(*) as count FROM habitations').get();

        res.json({
            timestamp: new Date().toISOString(),
            sessions,
            syncActivity,
            users,
            assignmentSummary,
            allAssignments,
            activityLog,
            totals: {
                users: users.length,
                habitations: habCount.count,
                assignments: allAssignments.length,
            },
        });
    } catch (err) {
        console.error('Admin state error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// PUT /api/admin/users/:login/name — rename a user
router.put('/users/:login/name', (req, res) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Accès réservé à l\'administrateur' });
    }

    const login = req.params.login.toUpperCase();
    const { name } = req.body;
    if (!name) {
        return res.status(400).json({ error: 'name requis' });
    }

    try {
        db.prepare('UPDATE users SET name = ? WHERE login = ?').run(name, login);
        db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
            req.user.login, 'rename_user', login, JSON.stringify({ newName: name })
        );
        res.json({ login, name });
    } catch (err) {
        console.error('Rename user error:', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

// GET /api/admin/users — list all users with basic stats (paginated)
router.get('/users', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        // Ensure is_disabled column exists
        try { db.exec('ALTER TABLE users ADD COLUMN is_disabled INTEGER DEFAULT 0'); } catch(e) { /* column already exists */ }
        
        const users = db.prepare(`
            SELECT u.login, u.name, u.role, u.parent, u.children, u.regions, u.is_disabled,
                   (SELECT COUNT(*) FROM habitations h WHERE h.created_by = u.login) as habitation_count,
                   (SELECT MAX(s.last_seen_at) FROM sessions s WHERE s.login = u.login) as last_sync
            FROM users u
            ORDER BY u.role, u.login
            LIMIT ? OFFSET ?
        `).all(parseInt(limit), offset).map(u => ({
            ...u,
            regions: JSON.parse(u.regions || '[]'),
            children: JSON.parse(u.children || '[]'),
            isDisabled: !!u.is_disabled
        }));

        const total = db.prepare('SELECT COUNT(*) as count FROM users').get().count;

        res.json({
            users,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        console.error('Admin route error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// PUT /api/admin/users/:login/parent — reassign agent to a different supervisor
router.put('/users/:login/parent', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const targetLogin = req.params.login.toUpperCase();
    const { newParent } = req.body;
    if (!newParent) return res.status(400).json({ error: 'newParent required' });

    try {
        db.exec('BEGIN');
        
        const agent = db.prepare('SELECT role, parent FROM users WHERE login = ?').get(targetLogin);
        if (!agent || agent.role !== 'agent') throw new Error('Target is not an agent');

        const supervisor = db.prepare('SELECT role, children FROM users WHERE login = ?').get(newParent.toUpperCase());
        if (!supervisor || supervisor.role !== 'supervisor') throw new Error('New parent is not a supervisor');

        // Remove from old parent
        if (agent.parent) {
            const oldParent = db.prepare('SELECT children FROM users WHERE login = ?').get(agent.parent);
            if (oldParent) {
                let children = JSON.parse(oldParent.children || '[]');
                children = children.filter(c => c !== targetLogin);
                db.prepare('UPDATE users SET children = ? WHERE login = ?').run(JSON.stringify(children), agent.parent);
            }
        }

        // Add to new parent
        let newChildren = JSON.parse(supervisor.children || '[]');
        if (!newChildren.includes(targetLogin)) newChildren.push(targetLogin);
        db.prepare('UPDATE users SET children = ? WHERE login = ?').run(JSON.stringify(newChildren), newParent.toUpperCase());

        // Update agent's parent
        db.prepare('UPDATE users SET parent = ? WHERE login = ?').run(newParent.toUpperCase(), targetLogin);

        db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
            req.user.login, 'reassign_agent', targetLogin, JSON.stringify({ oldParent: agent.parent, newParent })
        );
        
        db.exec('COMMIT');
        res.json({ login: targetLogin, parent: newParent });
    } catch (err) {
        db.exec('ROLLBACK');
        console.error(err);
        res.status(500).json({ error: err.message || 'Server error' });
    }
});

// POST /api/admin/users — create a new user
router.post('/users', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { login, name, role, parent, province, provinceName } = req.body;
    if (!login || !name || !role) return res.status(400).json({ error: 'Missing required fields' });
    
    const loginUpper = login.toUpperCase();
    const userService = require('../services/user.service');
    const password = userService.randomPassword(8);

    try {
        db.exec('BEGIN');
        db.prepare(`
            INSERT INTO users (login, password, role, name, parent, province, province_name, regions, children)
            VALUES (?, ?, ?, ?, ?, ?, ?, '[]', '[]')
        `).run(loginUpper, password, role, name, parent ? parent.toUpperCase() : null, province || '', provinceName || '');

        if (role === 'agent' && parent) {
            const parentUser = db.prepare('SELECT children FROM users WHERE login = ?').get(parent.toUpperCase());
            if (parentUser) {
                const children = JSON.parse(parentUser.children || '[]');
                if (!children.includes(loginUpper)) children.push(loginUpper);
                db.prepare('UPDATE users SET children = ? WHERE login = ?').run(JSON.stringify(children), parent.toUpperCase());
            }
        }

        db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
            req.user.login, 'create_user', loginUpper, JSON.stringify({ role, parent })
        );
        db.exec('COMMIT');
        res.json({ login: loginUpper, name, role, password }); // Return password once
    } catch (err) {
        db.exec('ROLLBACK');
        if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
            return res.status(409).json({ error: 'Login already exists' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/admin/users/:login/disable — soft disable a user
router.put('/users/:login/disable', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const targetLogin = req.params.login.toUpperCase();
    const { disabled } = req.body; // true/false

    try {
        // Need to add is_disabled column if it doesn't exist
        try {
            db.exec('ALTER TABLE users ADD COLUMN is_disabled INTEGER DEFAULT 0');
        } catch(e) { /* column exists */ }

        db.prepare('UPDATE users SET is_disabled = ? WHERE login = ?').run(disabled ? 1 : 0, targetLogin);
        db.prepare('INSERT INTO activity_log (login, action, target_id, details) VALUES (?, ?, ?, ?)').run(
            req.user.login, disabled ? 'disable_user' : 'enable_user', targetLogin, JSON.stringify({})
        );
        res.json({ login: targetLogin, disabled });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/admin/users/:login/habitations — get all habitations by a user
router.get('/users/:login/habitations', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const targetLogin = req.params.login.toUpperCase();
    try {
        const habitations = db.prepare('SELECT id, sd_code, form_data, status, created_at FROM habitations WHERE created_by = ? ORDER BY created_at DESC').all(targetLogin);
        res.json(habitations.map(h => ({
            ...h,
            formData: JSON.parse(h.form_data || '{}')
        })));
    } catch (err) {
        console.error('Admin route error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// GET /api/admin/users/:login/movements — get movement history for a user
router.get('/users/:login/movements', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const targetLogin = req.params.login.toUpperCase();
    try {
        const movements = db.prepare(`
            SELECT lat, lng, timestamp 
            FROM movements 
            WHERE login = ? 
            ORDER BY timestamp DESC 
            LIMIT 1000
        `).all(targetLogin);
        res.json(movements);
    } catch (err) {
        console.error('Admin movements error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// GET /api/admin/activity-log — get activity log (paginated)
router.get('/activity-log', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { page = 1, limit = 50 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        const logs = db.prepare(`
            SELECT * FROM activity_log 
            ORDER BY created_at DESC 
            LIMIT ? OFFSET ?
        `).all(parseInt(limit), offset);

        const total = db.prepare('SELECT COUNT(*) as count FROM activity_log').get().count;

        res.json({
            logs,
            total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        console.error('Admin activity-log error:', err);
        res.status(500).json({ error: 'Server error: ' + err.message });
    }
});

// GET /api/admin/locks — get all locked SDs
router.get('/locks', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
        const locks = db.prepare('SELECT * FROM sd_locks').all();
        res.json(locks);
    } catch (err) {
        console.error('Admin locks error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/locks — toggle lock on an SD
router.post('/locks', (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    const { sdCode, locked } = req.body;
    if (!sdCode) return res.status(400).json({ error: 'sdCode requis' });

    try {
        if (locked) {
            db.prepare('INSERT OR REPLACE INTO sd_locks (sd_code, locked_by) VALUES (?, ?)').run(sdCode, req.user.login);
            db.prepare('INSERT INTO activity_log (login, action, target_id) VALUES (?, ?, ?)').run(req.user.login, 'lock_sd', sdCode);
        } else {
            db.prepare('DELETE FROM sd_locks WHERE sd_code = ?').run(sdCode);
            db.prepare('INSERT INTO activity_log (login, action, target_id) VALUES (?, ?, ?)').run(req.user.login, 'unlock_sd', sdCode);
        }
        res.json({ sdCode, locked });
    } catch (err) {
        console.error('Toggle lock error:', err);
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
