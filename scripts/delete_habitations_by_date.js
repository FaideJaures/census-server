const { DatabaseSync } = require('node:sqlite');
const path = require('path');

// Basic config loader to find DB path
const config = {
    dbPath: process.env.DB_PATH || './data/census.db'
};

const dbPath = path.resolve(__dirname, '..', config.dbPath);
const db = new DatabaseSync(dbPath);

// Get date from argument or use default
const targetDate = process.argv[2] || '2026-07-26'; 

console.log(`[Maintenance] Cible : ${targetDate}`);

try {
    const check = db.prepare('SELECT COUNT(*) as count FROM habitations WHERE created_at LIKE ? OR updated_at LIKE ?');
    const row = check.get(targetDate + '%', targetDate + '%');
    
    if (row.count === 0) {
        console.log(`Aucune habitation trouvée pour la date ${targetDate}.`);
    } else {
        console.log(`Suppression de ${row.count} habitations...`);
        const del = db.prepare('DELETE FROM habitations WHERE created_at LIKE ? OR updated_at LIKE ?');
        del.run(targetDate + '%', targetDate + '%');
        console.log('Opération terminée avec succès.');
    }
} catch (err) {
    console.error('Erreur lors de l\'exécution du script :', err);
}
