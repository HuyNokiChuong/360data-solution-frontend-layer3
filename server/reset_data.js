
const { query, getClient } = require('./src/config/db');

async function resetDatabase() {
    const client = await getClient();
    try {
        console.log('Starting Clean Reset...');
        await client.query('BEGIN');

        // 1. Truncate all data tables (except users)
        console.log('Clearing data tables...');
        await client.query('TRUNCATE TABLE audit_logs, ai_messages, ai_sessions, ai_settings, dashboard_shares, dashboards, folder_shares, folders, synced_tables, connections CASCADE');

        // 2. Ensure baseline users exist with known credentials
        console.log('Verifying baseline users...');
        const adminEmail = 'admin@360data-solutions.ai';
        const testEmail = 'test@360data-solutions.ai';
        const bcrypt = require('bcryptjs');
        // Check if admin exists
        const res = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);

        let wsId;
        const wsRes = await client.query("SELECT id FROM workspaces WHERE domain = '360data-solutions.ai'");
        if (wsRes.rows.length > 0) {
            wsId = wsRes.rows[0].id;
        } else {
            const wsInsert = await client.query("INSERT INTO workspaces (name, domain) VALUES ('360data-solutions', '360data-solutions.ai') RETURNING id");
            wsId = wsInsert.rows[0].id;
        }

        if (res.rows.length === 0) {
            console.log('Re-creating Super Admin...');
            const hash = await bcrypt.hash('admin123', 10);

            await client.query(`
                INSERT INTO users (workspace_id, email, password_hash, full_name, role, status)
                VALUES ($1, $2, $3, 'Super Admin', 'Admin', 'Active')
            `, [wsId, adminEmail, hash]);

            console.log('Super Admin created (admin@360data-solutions.ai / admin123)');
        } else {
            console.log('Super Admin found. Preserving...');
        }

        // Ensure test user exists with known default password.
        const testHash = await bcrypt.hash('123456', 10);
        const testRes = await client.query('SELECT id FROM users WHERE email = $1', [testEmail]);
        if (testRes.rows.length === 0) {
            await client.query(`
                INSERT INTO users (workspace_id, email, password_hash, full_name, role, status)
                VALUES ($1, $2, $3, 'Test User', 'Viewer', 'Active')
            `, [wsId, testEmail, testHash]);
            console.log('Test user created (test@360data-solutions.ai / 123456)');
        } else {
            await client.query(
                `UPDATE users
                 SET password_hash = $1, workspace_id = $2, status = 'Active'
                 WHERE email = $3`,
                [testHash, wsId, testEmail]
            );
            console.log('Test user password reset (test@360data-solutions.ai / 123456)');
        }

        // 3. Delete other users
        console.log('Removing non-baseline users...');
        await client.query("DELETE FROM users WHERE email NOT IN ('admin@360data-solutions.ai', 'test@360data-solutions.ai')");

        // 4. Force reset sequences logic if needed (usually handled by SERIAL/UUID)

        await client.query('COMMIT');
        console.log('Database Reset Complete. Baseline users preserved.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Reset failed:', err);
    } finally {
        client.release();
        process.exit();
    }
}

resetDatabase();
