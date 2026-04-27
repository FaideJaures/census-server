const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const config = { dbPath: process.env.DB_PATH || './data/census.db' };
const dbPath = path.resolve(__dirname, '..', config.dbPath);
const db = new DatabaseSync(dbPath);

const targetId = process.argv[2];

if (!targetId) {
    console.error("Erreur : Vous devez fournir l'ID de l'habitation.");
    process.exit(1);
}

try {
    const check = db.prepare('SELECT id FROM habitations WHERE id = ?').get(targetId);
    if (!check) {
        console.log(`L'habitation avec l'ID "${targetId}" n'existe pas.`);
    } else {
        db.prepare('DELETE FROM habitations WHERE id = ?').run(targetId);
        console.log(`Habitation "${targetId}" supprimée avec succès.`);
    }
} catch (err) {
    console.error('Erreur :', err);
}
