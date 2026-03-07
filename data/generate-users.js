/**
 * Generate users.json from config.json + GeoJSON manifest
 * 
 * Usage:  node data/generate-users.js [--geojson-dir path/to/geojson]
 * 
 * This script:
 * 1. Reads config.json for brigade definitions
 * 2. Scans GeoJSON folders to find all SD codes matching each brigade's subregions
 * 3. Generates random passwords for each user
 * 4. Outputs a full users.json compatible with the seed script
 */

const fs = require('fs');
const path = require('path');

// Parse args
const args = process.argv.slice(2);
let geojsonDir = null;
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--geojson-dir' && args[i + 1]) {
        geojsonDir = args[i + 1];
    }
}

// Default geojson dir: look in census-server/data/geojson
if (!geojsonDir) {
    geojsonDir = path.join(__dirname, 'geojson');
    if (!fs.existsSync(geojsonDir)) {
        geojsonDir = null;
    }
}

const configPath = path.join(__dirname, 'config.json');
const outputPath = path.join(__dirname, 'users.json');

if (!fs.existsSync(configPath)) {
    console.error('Error: data/config.json not found');
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

function randomPassword(len = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let pw = '';
    for (let i = 0; i < len; i++) {
        pw += chars[Math.floor(Math.random() * chars.length)];
    }
    return pw;
}

function agentLogin(chiefLogin, index) {
    // chief "8AA" → agents "8AAA", "8AAB", ..., "8AAT", "8AAU", etc.
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (index < 26) {
        return chiefLogin + letters[index];
    }
    // For >26 agents: "8AA_27", "8AA_28", etc.
    return chiefLogin + '_' + (index + 1);
}

// Collect all SD codes per subregion prefix from GeoJSON level 4 files
function collectRegionCodes(geojsonBasePath) {
    const codes = [];
    const level4Dir = path.join(geojsonBasePath, '4');
    if (!fs.existsSync(level4Dir)) {
        console.warn(`Warning: GeoJSON level 4 directory not found at ${level4Dir}`);
        return codes;
    }

    const files = fs.readdirSync(level4Dir).filter(f => f.endsWith('.geojson') || f.endsWith('.json'));
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(level4Dir, file), 'utf-8'));
            const features = data.features || [];
            for (const feat of features) {
                const code = (feat.properties?.Polycode || feat.properties?.PolyCode || feat.properties?.LCXID1 || '').trim();
                if (code) codes.push(code);
            }
        } catch { /* skip bad files */ }
    }
    return codes;
}

// Build regions list for a brigade based on its subregion prefixes
function getRegionsForBrigade(brigade, allCodes) {
    const regions = [];
    for (const prefix of brigade.subregions) {
        for (const code of allCodes) {
            if (code.startsWith(prefix)) {
                regions.push(code);
            }
        }
    }

    // If no GeoJSON was available, just store the prefixes as-is
    if (regions.length === 0) {
        return brigade.subregions;
    }
    return [...new Set(regions)].sort();
}

// ─── Main ─────────────────────────────────────
let allSdCodes = [];
if (geojsonDir) {
    console.log(`Loading GeoJSON from: ${geojsonDir}`);
    allSdCodes = collectRegionCodes(geojsonDir);
    console.log(`Found ${allSdCodes.length} SD codes in GeoJSON level 4`);
} else {
    console.warn('No GeoJSON directory found. Subregion prefixes will be used as-is.');
}

const users = {};

// Admin
if (config.admin) {
    users[config.admin.login] = {
        password: config.admin.password || randomPassword(),
        role: 'admin',
        name: config.admin.name || 'Admin',
        province: '',
        provinceName: '',
        regions: [],
    };
}

// Process each brigade (A to Z)
const agentsPerChief = 26; // A-Z
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

for (let b = 0; b < 26; b++) {
    const chiefLogin = `8A${letters[b]}`;

    // Create agent logins
    const childrenLogins = [];
    for (let i = 0; i < agentsPerChief; i++) {
        const login = agentLogin(chiefLogin, i);
        childrenLogins.push(login);

        users[login] = {
            password: randomPassword(),
            role: 'agent',
            name: `Agent ${login}`,
            parent: chiefLogin,
            province: '',
            provinceName: '',
            regions: [],
        };
    }

    // Create chief (supervisor) — starts with empty regions and empty children; 8A assigns at runtime
    // Agents will be auto-created by the server upon first region assignment
    users[chiefLogin] = {
        password: randomPassword(),
        role: 'supervisor',
        name: `Superviseur ${chiefLogin}`,
        children: [],
        province: '',
        provinceName: '',
        regions: [],
    };
}

const output = {
    masterPassword: config.masterPassword || 'MASTER2024',
    users,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf-8');

const chiefCount = 26;
const totalUsers = Object.keys(users).length;
console.log(`\nGenerated users.json:`);
console.log(`  - ${config.admin ? 1 : 0} admin`);
console.log(`  - ${chiefCount} supervisors`);
console.log(`  - ${totalUsers} total users (Agents will be created dynamically when assigned regions)`);
console.log(`\nOutput: ${outputPath}`);
