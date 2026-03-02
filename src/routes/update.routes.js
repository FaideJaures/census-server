const { Router } = require('express');
const { auth } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const router = Router();
const RELEASES_DIR = process.env.RELEASES_DIR || '/opt/census/releases';

// GET /api/update/check?currentVersion=X.Y.Z
router.get('/check', auth, (req, res) => {
    try {
        const manifestPath = path.join(RELEASES_DIR, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            return res.json({ updateAvailable: false, error: 'Manifest introuvable' });
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const { version, changelog, fileSize, filename } = manifest;

        const currentVersion = req.query.currentVersion || '0.0.0';

        // Very basic version comparison: X.Y.Z
        const isNewer = compareVersions(version, currentVersion) > 0;

        res.json({
            updateAvailable: isNewer,
            version,
            changelog,
            fileSize,
            filename
        });
    } catch (err) {
        console.error('[Update Check]', err);
        res.status(500).json({ updateAvailable: false, error: 'Erreur serveur' });
    }
});

// GET /api/update/download
router.get('/download', auth, (req, res) => {
    try {
        const manifestPath = path.join(RELEASES_DIR, 'manifest.json');
        if (!fs.existsSync(manifestPath)) {
            return res.status(404).json({ error: 'Mise à jour introuvable' });
        }

        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const apkPath = path.join(RELEASES_DIR, manifest.filename);

        if (!fs.existsSync(apkPath)) {
            return res.status(404).json({ error: 'Fichier APK introuvable' });
        }

        // Log the download activity if possible
        console.log(`[Update] User ${req.user.login} downloaded version ${manifest.version}`);

        res.download(apkPath, manifest.filename);
    } catch (err) {
        console.error('[Update Download]', err);
        res.status(500).json({ error: 'Erreur serveur' });
    }
});

function compareVersions(v1, v2) {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
        const p1 = parts1[i] || 0;
        const p2 = parts2[i] || 0;
        if (p1 > p2) return 1;
        if (p1 < p2) return -1;
    }
    return 0;
}

module.exports = router;
