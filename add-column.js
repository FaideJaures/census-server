const db = require('./src/db/connection');
try {
    db.exec('ALTER TABLE habitations ADD COLUMN updated_by TEXT');
    console.log('Column added successfully');
} catch (err) {
    if (err.message.includes('duplicate column name')) {
        console.log('Column already exists');
    } else {
        console.error('Error adding column:', err);
    }
}
