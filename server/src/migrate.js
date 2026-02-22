// ============================================
// Migration Runner
// Runs SQL files from migrations/ directory
// ============================================
const fs = require('fs');
const path = require('path');
const { pool } = require('./config/db');

async function runMigrations() {
    const migrationsDir = path.join(__dirname, '..', 'migrations');

    if (!fs.existsSync(migrationsDir)) {
        console.error('❌ Migrations directory not found:', migrationsDir);
        process.exit(1);
    }

    const files = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql'))
        .sort();

    if (files.length === 0) {
        console.log('No migration files found.');
        process.exit(0);
    }

    const client = await pool.connect();

    try {
        for (const file of files) {
            const filePath = path.join(migrationsDir, file);
            const sql = fs.readFileSync(filePath, 'utf-8');

            console.log(`\n📦 Running migration: ${file}`);
            console.log('─'.repeat(50));

            await client.query(sql);

            console.log(`✅ Migration ${file} completed successfully`);
        }

        console.log('\n🎉 All migrations completed!');

        // Verify tables
        const tableResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);

        console.log('\n📋 Tables in database:');
        tableResult.rows.forEach(row => {
            console.log(`   ✓ ${row.table_name}`);
        });

    } catch (err) {
        console.error('\n❌ Migration failed:', err.message);
        console.error(err);
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

runMigrations();
