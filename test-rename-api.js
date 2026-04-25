const http = require('http');
const db = require('./src/db/connection');
const jwt = require('jsonwebtoken');
const config = require('./src/config');

// Get supervisor
const supervisor = db.prepare("SELECT * FROM users WHERE role = 'supervisor' LIMIT 1").get();
const agent = db.prepare("SELECT * FROM users WHERE role = 'agent' AND parent = ? LIMIT 1").get(supervisor.login);

console.log("Supervisor:", supervisor.login, "Agent:", agent.login);

const token = jwt.sign(
    { login: supervisor.login, role: supervisor.role, name: supervisor.name, parent: supervisor.parent, regions: supervisor.regions, children: supervisor.children },
    config.jwtSecret,
    { expiresIn: '24h' }
);

const payload = JSON.stringify({ name: 'Nouveau Nom Agent' });

const options = {
  hostname: 'localhost',
  port: 3000,
  path: `/api/users/${agent.login}/name`,
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Content-Length': Buffer.byteLength(payload)
  }
};

const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    console.log('Status code:', res.statusCode);
    console.log('Body:', data);
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(payload);
req.end();
