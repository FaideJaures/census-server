const db = require('./src/db/connection');
const supervisor = db.prepare(\"SELECT * FROM users WHERE role = 'supervisor' LIMIT 1\").get();
if (supervisor) {
    console.log('Supervisor:', supervisor.login);
    const agent = db.prepare(\"SELECT * FROM users WHERE role = 'agent' AND parent = ? LIMIT 1\").get(supervisor.login);
    console.log('Agent:', agent ? agent.login : 'None', 'Parent:', agent ? agent.parent : 'N/A');
} else {
    console.log('No supervisor found');
}
