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

        // Total counts
        const habCount = db.prepare('SELECT COUNT(*) as count FROM habitations').get();
        const assignCount = db.prepare('SELECT COUNT(*) as count FROM assignments').get();

        res.json({
            timestamp: new Date().toISOString(),
            sessions,
            syncActivity,
            users,
            assignmentSummary,
            activityLog,
            totals: {
                users: users.length,
                habitations: habCount.count,
                assignments: assignCount.count,
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

module.exports = router;
