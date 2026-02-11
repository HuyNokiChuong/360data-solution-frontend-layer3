
const { query, getClient } = require('./src/config/db');

async function resetDatabase() {
    const client = await getClient();
    try {
        console.log('Starting Clean Reset...');
        await client.query('BEGIN');

        // 1. Truncate all data tables (except users)
        console.log('Clearing data tables...');
        await client.query('TRUNCATE TABLE audit_logs, ai_messages, ai_sessions, ai_settings, dashboard_shares, dashboards, folder_shares, folders, synced_tables, connections CASCADE');

        // 2. Ensure Super Admin exists
        console.log('Verifying Super Admin...');
        const adminEmail = 'admin@360data-solutions.ai';
        // Check if admin exists
        const res = await client.query('SELECT id FROM users WHERE email = $1', [adminEmail]);

        if (res.rows.length === 0) {
            console.log('Re-creating Super Admin...');

            // Create workspace if not exists (or fetch if exists, but we are resetting so maybe create)
            // But if we truncated tables, workspace might be gone if it was in 'workspaces'? 
            // Wait, TRUNCATE list in line 12 does NOT include 'workspaces'.
            // I should check schema. 'workspaces' is top level.
            // If I truncate 'connections', 'folders', 'dashboards', 'workspaces' is safe?
            // If 'workspaces' table exists and has data, we should reuse it or ensure unique constraint.
            // Let's assume we reuse or create.

            let wsId;
            const wsRes = await client.query("SELECT id FROM workspaces WHERE domain = '360data-solutions.ai'");
            if (wsRes.rows.length > 0) {
                wsId = wsRes.rows[0].id;
            } else {
                const wsInsert = await client.query("INSERT INTO workspaces (name, domain) VALUES ('360data-solutions', '360data-solutions.ai') RETURNING id");
                wsId = wsInsert.rows[0].id;
            }

            // Create user
            const bcrypt = require('bcryptjs');
            const salt = await bcrypt.genSalt(10);
            const hash = await bcrypt.hash('admin123', salt);

            await client.query(`
                INSERT INTO users (workspace_id, email, password_hash, full_name, role, status)
                VALUES ($1, $2, $3, 'Super Admin', 'Admin', 'Active')
            `, [wsId, adminEmail, hash]);

            console.log('Super Admin created (admin@360data-solutions.ai / admin123)');
        } else {
            console.log('Super Admin found. Preserving...');
        }

        // 3. Delete other users
        console.log('Removing non-admin users...');
        await client.query("DELETE FROM users WHERE email != 'admin@360data-solutions.ai'");

        // 4. Force reset sequences logic if needed (usually handled by SERIAL/UUID)

        await client.query('COMMIT');
        console.log('Database Reset Complete. Super Admin Preserved.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Reset failed:', err);
    } finally {
        client.release();
        process.exit();
    }
}

resetDatabase();
