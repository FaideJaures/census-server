const db = require('./src/db/connection');
const syncService = require('./src/services/sync.service');

const user = db.prepare('SELECT * FROM users LIMIT 1').get() || {
    login: '8AF',
    role: 'superviseur',
    children: '[]',
    regions: '[]'
};

try {
    const data = {
        habitations: [{
            id: 'test1',
            sdCode: '0101305112',
            status: 'synced',
            formData: { test: '1' },
            coordinates: { lat: 0, lng: 0 }
        }],
        assignments: [{
            sdCode: '0101305112',
            operatorLogin: '8AF'
        }]
    };
    
    console.log('Testing push...');
    const result = syncService.push(user, data);
    console.log('Success:', result);
} catch (err) {
    console.error('Error:', err);
}
