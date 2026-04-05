#!/usr/bin/env node
/**
 * Migration: Assign supervisor regions based on their agents' existing assignments
 *
 * For each supervisor, finds the common prefix of their agents' SD codes
 * to determine the supervisor's region, then inserts it into the assignments table.
 *
 * Also reads config.json as fallback for supervisors with no agent assignments.
 *
 * Run from census-server/:
 *   node scripts/migrate-regions-to-assignments.js
 */

const fs = require('fs');
const path = require('path');
const db = require('../src/db/connection');

// Read config.json for fallback brigade definitions
let configBrigades = [];
try {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/config.json'), 'utf-8'));
  configBrigades = config.brigades || [];
} catch { /* no config */ }

const supervisors = db.prepare(`SELECT login, children, regions FROM users WHERE role = 'supervisor'`).all();

console.log(`Found ${supervisors.length} supervisors.\n`);

function longestCommonPrefix(strings) {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (const s of strings) {
    while (!s.startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return '';
    }
  }
  return prefix;
}

// Map prefix lengths to admin levels: 2=province, 4=dept, 7=canton, 10=SD
function snapToLevel(prefix) {
  const len = prefix.length;
  if (len >= 10) return prefix.slice(0, 10); // SD
  if (len >= 7) return prefix.slice(0, 7);   // Canton
  if (len >= 4) return prefix.slice(0, 4);   // Department
  if (len >= 2) return prefix.slice(0, 2);   // Province
  return prefix;
}

const stmt = db.prepare(`
  INSERT OR IGNORE INTO assignments (sd_code, operator_login, assigned_by, assigned_at)
  VALUES (?, ?, '8A', datetime('now'))
`);

let total = 0;
const results = [];

db.exec('BEGIN');
try {
  for (const sup of supervisors) {
    // Check if supervisor already has an assignment in the table
    const existing = db.prepare('SELECT sd_code FROM assignments WHERE operator_login = ?').all(sup.login);
    if (existing.length > 0) {
      console.log(`  ${sup.login}: already has ${existing.length} assignment(s) → skip`);
      continue;
    }

    // Get agents' assignments
    const children = JSON.parse(sup.children || '[]');
    if (children.length === 0) {
      // Check config fallback
      const brigade = configBrigades.find(b => b.chief === sup.login);
      if (brigade && brigade.subregions && brigade.subregions.length > 0) {
        console.log(`  ${sup.login}: no agents, using config → ${brigade.subregions.join(', ')}`);
        for (const code of brigade.subregions) {
          const r = stmt.run(code, sup.login);
          if (r.changes > 0) total++;
        }
        results.push({ login: sup.login, source: 'config', codes: brigade.subregions });
      } else {
        console.log(`  ${sup.login}: no agents, no config → skip`);
      }
      continue;
    }

    // Get all SD codes assigned to this supervisor's agents
    const placeholders = children.map(() => '?').join(',');
    const agentSds = db.prepare(
      `SELECT DISTINCT sd_code FROM assignments WHERE operator_login IN (${placeholders})`
    ).all(...children).map(r => r.sd_code);

    if (agentSds.length === 0) {
      // Check config fallback
      const brigade = configBrigades.find(b => b.chief === sup.login);
      if (brigade && brigade.subregions && brigade.subregions.length > 0) {
        console.log(`  ${sup.login}: agents have no assignments, using config → ${brigade.subregions.join(', ')}`);
        for (const code of brigade.subregions) {
          const r = stmt.run(code, sup.login);
          if (r.changes > 0) total++;
        }
        results.push({ login: sup.login, source: 'config', codes: brigade.subregions });
      } else {
        console.log(`  ${sup.login}: agents have no assignments, no config → skip`);
      }
      continue;
    }

    // Find common prefix and snap to admin level
    const prefix = longestCommonPrefix(agentSds);
    const regionCode = snapToLevel(prefix);

    if (regionCode.length >= 2) {
      console.log(`  ${sup.login}: ${agentSds.length} agent SDs, common prefix → ${regionCode}`);
      const r = stmt.run(regionCode, sup.login);
      if (r.changes > 0) total++;
      results.push({ login: sup.login, source: 'derived', codes: [regionCode], agentSds: agentSds.length });
    } else {
      console.log(`  ${sup.login}: ${agentSds.length} agent SDs but no meaningful common prefix → skip`);
    }
  }

  db.exec('COMMIT');
  console.log(`\nDone. Inserted ${total} new assignment(s).`);

  if (results.length > 0) {
    console.log('\nSummary:');
    for (const r of results) {
      console.log(`  ${r.login}: ${r.codes.join(', ')} (${r.source})`);
    }
  }
} catch (err) {
  db.exec('ROLLBACK');
  console.error('Migration failed:', err);
  process.exit(1);
}

// Show final state
console.log('\nAll supervisor assignments:');
const supAssignments = db.prepare(`
  SELECT a.sd_code, a.operator_login, u.name
  FROM assignments a
  JOIN users u ON a.operator_login = u.login
  WHERE u.role = 'supervisor'
  ORDER BY a.operator_login
`).all();
for (const a of supAssignments) {
  console.log(`  ${a.operator_login} (${a.name}): ${a.sd_code}`);
}
if (supAssignments.length === 0) {
  console.log('  (none)');
}
