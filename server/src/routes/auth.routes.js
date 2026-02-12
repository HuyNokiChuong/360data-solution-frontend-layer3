// ============================================
// Auth Routes - Register, Login, Me
// ============================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { query, getClient } = require('../config/db');
const { authenticate, generateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /api/auth/register
 * Creates workspace (if new domain) + user
 */
router.post('/register', async (req, res) => {
    const client = await getClient();
    try {
        const { email, password, name, phoneNumber, level, department, industry, companySize } = req.body;

        if (!email || !password || !name) {
            return res.status(400).json({ success: false, message: 'Email, password, and name are required' });
        }

        // Check if user already exists
        const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'User already exists' });
        }

        await client.query('BEGIN');

        // Get or create workspace based on email domain
        const domain = email.split('@')[1].toLowerCase();
        let workspaceResult = await client.query('SELECT id FROM workspaces WHERE domain = $1', [domain]);

        let workspaceId;
        if (workspaceResult.rows.length === 0) {
            // First user in this domain = create workspace + Admin
            const wsInsert = await client.query(
                'INSERT INTO workspaces (domain, name) VALUES ($1, $2) RETURNING id',
                [domain, domain]
            );
            workspaceId = wsInsert.rows[0].id;
        } else {
            workspaceId = workspaceResult.rows[0].id;
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Determine role: first user in workspace = Admin
        const userCount = await client.query('SELECT COUNT(*) FROM users WHERE workspace_id = $1', [workspaceId]);
        const role = parseInt(userCount.rows[0].count) === 0 ? 'Admin' : 'Viewer';

        // Insert user
        const userResult = await client.query(
            `INSERT INTO users (workspace_id, email, password_hash, name, role, status, phone_number, level, department, industry, company_size)
       VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7, $8, $9, $10)
       RETURNING id, email, name, role, status, joined_at, phone_number, level, department, industry, company_size`,
            [workspaceId, email, passwordHash, name, role, phoneNumber, level, department, industry, companySize]
        );

        await client.query('COMMIT');

        const user = formatUser(userResult.rows[0]);
        const token = generateToken({ ...user, workspace_id: workspaceId });

        res.status(201).json({
            success: true,
            data: { user, token },
            message: 'Registration successful',
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Registration error:', err);
        res.status(500).json({ success: false, message: 'Registration failed: ' + err.message });
    } finally {
        client.release();
    }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const devBypassAuth = String(process.env.DEV_AUTH_BYPASS || '').toLowerCase() === 'true';

        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'Email and password are required' });
        }

        const result = await query(
            `SELECT u.*, w.domain FROM users u
       JOIN workspaces w ON u.workspace_id = w.id
       WHERE u.email = $1`,
            [email]
        );

        let dbUser = result.rows[0];

        // Dev-only convenience: allow login without knowing the stored password.
        // This is intentionally opt-in and should never be enabled in production.
        if (!dbUser && devBypassAuth) {
            const client = await getClient();
            try {
                await client.query('BEGIN');
                const domain = String(email.split('@')[1] || '').toLowerCase();
                let workspaceResult = await client.query('SELECT id FROM workspaces WHERE domain = $1', [domain]);
                let workspaceId;
                if (workspaceResult.rows.length === 0) {
                    const wsInsert = await client.query(
                        'INSERT INTO workspaces (domain, name) VALUES ($1, $2) RETURNING id',
                        [domain, domain]
                    );
                    workspaceId = wsInsert.rows[0].id;
                } else {
                    workspaceId = workspaceResult.rows[0].id;
                }

                const nameGuess = String(email.split('@')[0] || 'User');
                const passwordHash = await bcrypt.hash(password, 12);
                const userCount = await client.query('SELECT COUNT(*) FROM users WHERE workspace_id = $1', [workspaceId]);
                const role = parseInt(userCount.rows[0].count) === 0 ? 'Admin' : 'Viewer';

                const userResult = await client.query(
                    `INSERT INTO users (workspace_id, email, password_hash, name, role, status)
                     VALUES ($1, $2, $3, $4, $5, 'Active')
                     RETURNING *, $6::text as domain`,
                    [workspaceId, email, passwordHash, nameGuess, role, domain]
                );

                await client.query('COMMIT');
                dbUser = userResult.rows[0];
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        }

        if (!dbUser) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (dbUser.status === 'Disabled') {
            return res.status(403).json({ success: false, message: 'Account is disabled' });
        }

        const validPassword = await bcrypt.compare(password, dbUser.password_hash);
        if (!validPassword && !devBypassAuth) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = formatUser(dbUser);
        const token = generateToken({ ...user, workspace_id: dbUser.workspace_id });

        res.json({
            success: true,
            data: { user, token },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ success: false, message: 'Login failed' });
    }
});

/**
 * GET /api/auth/me - Verify session
 */
router.get('/me', authenticate, async (req, res) => {
    try {
        const result = await query(
            `SELECT u.*, w.domain FROM users u
       JOIN workspaces w ON u.workspace_id = w.id
       WHERE u.id = $1`,
            [req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, data: formatUser(result.rows[0]) });
    } catch (err) {
        console.error('Me error:', err);
        res.status(500).json({ success: false, message: 'Failed to verify session' });
    }
});

/**
 * Format DB user row to frontend User shape
 */
function formatUser(row) {
    return {
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        status: row.status,
        joinedAt: row.joined_at,
        jobTitle: row.job_title || undefined,
        phoneNumber: row.phone_number || undefined,
        companySize: row.company_size || undefined,
        level: row.level || undefined,
        department: row.department || undefined,
        industry: row.industry || undefined,
        note: row.note || undefined,
        tags: Array.isArray(row.tags) ? row.tags : [],
    };
}

module.exports = router;
