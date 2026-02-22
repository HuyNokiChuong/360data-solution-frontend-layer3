const { pool } = require('../src/config/db');

async function migrate() {
    try {
        console.log('Running soft delete migration...');
        const tables = ['connections', 'synced_tables', 'folders', 'dashboards'];

        for (const table of tables) {
            console.log(`Adding is_deleted to ${table}...`);
            await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT FALSE`);
        }
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
