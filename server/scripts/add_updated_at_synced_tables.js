const { pool } = require('../src/config/db');

async function migrate() {
    try {
        console.log('Adding updated_at to synced_tables...');
        await pool.query(`ALTER TABLE synced_tables ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
        console.log('Migration successful.');
    } catch (err) {
        console.error('Migration failed:', err);
    } finally {
        await pool.end();
    }
}

migrate();
