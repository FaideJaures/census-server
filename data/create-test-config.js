const fs = require('fs');
const path = require('path');

const geojsonDir = path.join(__dirname, 'geojson');
const level4Dir = path.join(geojsonDir, '4');

if (!fs.existsSync(level4Dir)) {
    console.error("GeoJSON level 4 not found. Please ensure census-server/data/geojson/4 exists.");
    process.exit(1);
}

// 1. Collect all SD codes
const sdCodes = [];
for (const file of fs.readdirSync(level4Dir)) {
    if (file.endsWith('.geojson') || file.endsWith('.json')) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(level4Dir, file), 'utf8'));
            for (const feat of data.features || []) {
                const code = (feat.properties?.Polycode || feat.properties?.PolyCode || feat.properties?.LCXID1 || '').trim();
                if (code) sdCodes.push(code);
            }
        } catch { }
    }
}

// 2. Extract unique 4-digit departments (level 2)
// Code format: 2 digits province, 2 digits dept (e.g. 0101)
const deptByProv = {};
for (const code of sdCodes) {
    if (code.length >= 4) {
        const prov = code.substring(0, 2);
        const dept = code.substring(0, 4);
        if (!deptByProv[prov]) deptByProv[prov] = new Set();
        deptByProv[prov].add(dept);
    }
}

// 3. Pick 2 from Estuaire (01)
const prov01Depts = Array.from(deptByProv['01'] || []);
prov01Depts.sort(() => 0.5 - Math.random());
const selected01 = prov01Depts.slice(0, 2);

// Pick 3 from other provinces
let otherDepts = [];
for (const [prov, depts] of Object.entries(deptByProv)) {
    if (prov !== '01') {
        otherDepts.push(...Array.from(depts));
    }
}
otherDepts.sort(() => 0.5 - Math.random());
const selectedOther = otherDepts.slice(0, 3);

// 4. Create config.json
const config = {
    "masterPassword": "MASTER2024",
    "admin": {
        "login": "8A",
        "password": "Admin2024",
        "name": "Administrateur National"
    },
    "agentsPerChief": 20,
    "provinces": {
        "01": "Estuaire",
        "02": "Haut-Ogooue",
        "03": "Moyen-Ogooue",
        "04": "Ngounie",
        "05": "Nyanga",
        "06": "Ogooue-Ivindo",
        "07": "Ogooue-Lolo",
        "08": "Ogooue-Maritime",
        "09": "Woleu-Ntem"
    },
    "brigades": []
};

// Add Estuaire chiefs
const letters = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';
let chiefIdx = 0;
for (const dept of selected01) {
    const chiefCode = '8A' + letters[chiefIdx++];
    config.brigades.push({
        "chief": chiefCode,
        "chiefName": `Superviseur Estuaire (${dept})`,
        "province": "01",
        "subregions": [dept]
    });
}

// Add Other chiefs
for (const dept of selectedOther) {
    const provCode = dept.substring(0, 2);
    const chiefCode = '8A' + letters[chiefIdx++];
    config.brigades.push({
        "chief": chiefCode,
        "chiefName": `Superviseur Province ${provCode} (${dept})`,
        "province": provCode,
        "subregions": [dept]
    });
}

fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(config, null, 2));
console.log("Successfully created test config.json with 5 supervisor brigades:");
for (const b of config.brigades) {
    console.log(`  - ${b.chiefName} [${b.subregions.join(', ')}]`);
}
