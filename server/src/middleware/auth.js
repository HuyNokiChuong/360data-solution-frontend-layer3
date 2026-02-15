// ============================================
// JWT Authentication Middleware
// ============================================
const jwt = require('jsonwebtoken');
const { query } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET || '360data-secret-key-change-in-production';
const JWT_EXPIRES_IN = '7d';

/**
 * Generate JWT token for a user
 */
const generateToken = (user) => {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            role: user.role,
            workspace_id: user.workspace_id,
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
};

/**
 * Middleware: Verify JWT and attach user to req
 */
const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);

        // Verify user still exists and is active
        const result = await query(
            'SELECT id, email, name, role, status, workspace_id, group_name FROM users WHERE id = $1',
            [decoded.id]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ success: false, message: 'User not found' });
        }

        const user = result.rows[0];
        if (user.status === 'Disabled') {
            return res.status(403).json({ success: false, message: 'Account disabled' });
        }

        req.user = user;
        next();
    } catch (err) {
        if (err.name === 'TokenExpiredError') {
            return res.status(401).json({ success: false, message: 'Token expired' });
        }
        if (err.name === 'JsonWebTokenError') {
            return res.status(401).json({ success: false, message: 'Invalid token' });
        }
        console.error('Auth middleware error:', err);
        return res.status(500).json({ success: false, message: 'Authentication error' });
    }
};

/**
 * Middleware: Require Admin role
 */
const requireAdmin = (req, res, next) => {
    if (req.user.role !== 'Admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }
    next();
};

module.exports = { authenticate, requireAdmin, generateToken, JWT_SECRET };
