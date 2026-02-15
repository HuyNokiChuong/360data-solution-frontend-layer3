// ============================================
// User Routes - Profile, Invite, List, Status
// ============================================
const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All user routes require authentication
router.use(authenticate);

const normalizeTags = (value) => {
    if (!value) return [];
    const asArray = Array.isArray(value)
        ? value
        : (typeof value === 'string'
            ? value.split(',').map((item) => item.trim())
            : []);

    const deduped = [];
    const seen = new Set();
    asArray.forEach((item) => {
        const normalized = String(item || '').trim();
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        deduped.push(normalized.slice(0, 40));
    });
    return deduped.slice(0, 20);
};

const normalizeOptionalTags = (value) => {
    if (value === undefined) return null;
    return normalizeTags(value);
};

/**
 * GET /api/users - List workspace users
 */
router.get('/', async (req, res) => {
    try {
        const result = await query(
            `SELECT id, email, name, role, status, joined_at, job_title, phone_number, 
              company_size, level, department, industry, group_name, note, tags
       FROM users WHERE workspace_id = $1 ORDER BY joined_at DESC`,
            [req.user.workspace_id]
        );

        res.json({ success: true, data: result.rows.map(formatUser) });
    } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ success: false, message: 'Failed to list users' });
    }
});

/**
 * PUT /api/users/profile - Update own profile
 */
router.put('/profile', async (req, res) => {
    try {
        const { name, jobTitle, phoneNumber, companySize, level, department, industry, groupName, note, tags } = req.body;
        const normalizedTags = normalizeOptionalTags(tags);
        const normalizedGroupName = typeof groupName === 'string'
            ? groupName.trim().slice(0, 120)
            : undefined;

        const result = await query(
            `UPDATE users SET
         name = COALESCE($1, name),
         job_title = COALESCE($2, job_title),
         phone_number = COALESCE($3, phone_number),
         company_size = COALESCE($4, company_size),
         level = COALESCE($5, level),
         department = COALESCE($6, department),
         industry = COALESCE($7, industry),
         group_name = COALESCE($8, group_name),
         note = COALESCE($9, note),
         tags = COALESCE($10::jsonb, tags),
         status = 'Active'
       WHERE id = $11
       RETURNING id, email, name, role, status, joined_at, job_title, phone_number, company_size, level, department, industry, group_name, note, tags`,
            [name, jobTitle, phoneNumber, companySize, level, department, industry, normalizedGroupName, note || null, normalizedTags === null ? null : JSON.stringify(normalizedTags), req.user.id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, data: formatUser(result.rows[0]) });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

/**
 * POST /api/users/invite - Invite a new user (Admin only)
 */
router.post('/invite', requireAdmin, async (req, res) => {
    try {
        const { name, email, role, groupName, note, tags } = req.body;
        const normalizedTags = normalizeTags(tags);
        const normalizedGroupName = typeof groupName === 'string' && groupName.trim().length > 0
            ? groupName.trim().slice(0, 120)
            : null;

        if (!name || !email) {
            return res.status(400).json({ success: false, message: 'Name and email are required' });
        }

        // Verify same domain
        const inviteDomain = email.split('@')[1]?.toLowerCase();
        const userDomain = req.user.email.split('@')[1]?.toLowerCase();

        if (inviteDomain !== userDomain) {
            return res.status(400).json({
                success: false,
                message: `Can only invite users with @${userDomain} emails`,
            });
        }

        // Check if user exists
        const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ success: false, message: 'User already exists' });
        }

        // Create user with temporary password (they'll set it on first login)
        const tempPassword = Math.random().toString(36).substring(2, 10);
        const passwordHash = await bcrypt.hash(tempPassword, 12);

        const result = await query(
            `INSERT INTO users (workspace_id, email, password_hash, name, role, status, group_name, note, tags)
       VALUES ($1, $2, $3, $4, $5, 'Active', $6, $7, $8::jsonb)
       RETURNING id, email, name, role, status, joined_at, group_name, note, tags`,
            [req.user.workspace_id, email, passwordHash, name, role || 'Viewer', normalizedGroupName, note || null, JSON.stringify(normalizedTags)]
        );

        res.status(201).json({
            success: true,
            data: formatUser(result.rows[0]),
            message: `User invited successfully`,
        });
    } catch (err) {
        console.error('Invite user error:', err);
        res.status(500).json({ success: false, message: 'Failed to invite user' });
    }
});

/**
 * PUT /api/users/:id/status - Toggle user status (Admin only)
 */
router.put('/:id/status', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        // Can't disable yourself
        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot change your own status' });
        }

        const current = await query('SELECT status FROM users WHERE id = $1 AND workspace_id = $2', [id, req.user.workspace_id]);
        if (current.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const newStatus = current.rows[0].status === 'Active' ? 'Disabled' : 'Active';

        const result = await query(
            `UPDATE users SET status = $1 WHERE id = $2 AND workspace_id = $3
       RETURNING id, email, name, role, status, joined_at, job_title, phone_number, company_size, level, department, industry, group_name, note, tags`,
            [newStatus, id, req.user.workspace_id]
        );

        res.json({ success: true, data: formatUser(result.rows[0]) });
    } catch (err) {
        console.error('Toggle user status error:', err);
        res.status(500).json({ success: false, message: 'Failed to update user status' });
    }
});

/**
 * PUT /api/users/:id - Update a user (Admin only)
 */
router.put('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, groupName, note, tags } = req.body || {};
        const normalizedTags = normalizeOptionalTags(tags);
        const normalizedGroupName = typeof groupName === 'string'
            ? groupName.trim().slice(0, 120)
            : undefined;

        // Avoid self role escalation/demotion via admin endpoint.
        if (id === req.user.id && typeof role === 'string' && role.length > 0) {
            return res.status(400).json({ success: false, message: 'Cannot change your own role' });
        }

        const result = await query(
            `UPDATE users SET
         name = COALESCE($1, name),
         role = COALESCE($2, role),
         group_name = COALESCE($3, group_name),
         note = COALESCE($4, note),
         tags = COALESCE($5::jsonb, tags)
       WHERE id = $6 AND workspace_id = $7
       RETURNING id, email, name, role, status, joined_at, job_title, phone_number, company_size, level, department, industry, group_name, note, tags`,
            [name || null, role || null, normalizedGroupName, note || null, normalizedTags === null ? null : JSON.stringify(normalizedTags), id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, data: formatUser(result.rows[0]) });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ success: false, message: 'Failed to update user' });
    }
});

/**
 * DELETE /api/users/:id - Remove user (Admin only)
 */
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;

        if (id === req.user.id) {
            return res.status(400).json({ success: false, message: 'Cannot delete yourself' });
        }

        const result = await query(
            'DELETE FROM users WHERE id = $1 AND workspace_id = $2 RETURNING id',
            [id, req.user.workspace_id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({ success: true, message: 'User deleted' });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ success: false, message: 'Failed to delete user' });
    }
});

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
        groupName: row.group_name || undefined,
        note: row.note || undefined,
        tags: Array.isArray(row.tags) ? row.tags : [],
    };
}

module.exports = router;
