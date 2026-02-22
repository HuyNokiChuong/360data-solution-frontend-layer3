
const { query, getClient } = require('./src/config/db');

async function migrate() {
    const client = await getClient();
    try {
        console.log('Starting migration: Adding is_deleted column...');
        await client.query('BEGIN');

        // 1. connections
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'connections' AND column_name = 'is_deleted') THEN 
                    ALTER TABLE connections ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        // 2. synced_tables
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'synced_tables' AND column_name = 'is_deleted') THEN 
                    ALTER TABLE synced_tables ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        // 3. folders
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'folders' AND column_name = 'is_deleted') THEN 
                    ALTER TABLE folders ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        // 4. dashboards
        await client.query(`
            DO $$ 
            BEGIN 
                IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'dashboards' AND column_name = 'is_deleted') THEN 
                    ALTER TABLE dashboards ADD COLUMN is_deleted BOOLEAN DEFAULT FALSE; 
                END IF; 
            END $$;
        `);

        await client.query('COMMIT');
        console.log('Migration completed successfully.');
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Migration failed:', err);
    } finally {
        client.release();
        process.exit();
    }
}

migrate();
