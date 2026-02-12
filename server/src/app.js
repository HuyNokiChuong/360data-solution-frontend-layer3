// ============================================
// 360data Solutions - Backend Server
// Port: 3001
// ============================================
const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

// Load env from project root and server folder without requiring dotenv package.
const loadEnvFile = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, 'utf8').split('\n');
    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eqIndex = line.indexOf('=');
        if (eqIndex <= 0) continue;
        const key = line.slice(0, eqIndex).trim();
        let value = line.slice(eqIndex + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) {
            process.env[key] = value;
        }
    }
};

loadEnvFile(path.resolve(__dirname, '../../.env'));
loadEnvFile(path.resolve(__dirname, '../.env'));

const { pool } = require('./config/db');
const { auditLog } = require('./middleware/audit');
const { startGoogleSheetsScheduler } = require('./services/google-sheets-sync.service');

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;
const HOST = String(process.env.BACKEND_HOST || '').trim();

// ============================================
// Security & Middleware
// ============================================
app.use(helmet());
app.use(cors({
    origin: ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://0.0.0.0:8080'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Rate limiting DISABLED for dev
/*
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 5000, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Too many requests, please try again later' },
});
app.use('/api/', apiLimiter);
*/

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        if (req.path.startsWith('/api/')) {
            console.log(`${req.method} ${req.path} → ${res.statusCode} (${duration}ms)`);
        }
    });
    next();
});

// Audit logging for write operations
app.use(auditLog);

// ============================================
// Routes
// ============================================

// UUID validation for :id params — prevents PostgreSQL UUID parse errors
const { isValidUUID } = require('./config/db');
app.param('id', (req, res, next, value) => {
    // Only validate if the route expects a UUID (skip auth routes etc)
    if (req.path.includes('/auth/') || req.path.includes('/health')) return next();
    if (!isValidUUID(value)) {
        return res.status(400).json({ success: false, message: `Invalid ID format: ${value}. Expected UUID.` });
    }
    next();
});

app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/connections', require('./routes/connection.routes'));
app.use('/api/dashboards', require('./routes/dashboard.routes'));
app.use('/api/folders', require('./routes/folder.routes'));
app.use('/api/sessions', require('./routes/session.routes'));
app.use('/api/ai-settings', require('./routes/ai-settings.routes'));
app.use('/api/logs', require('./routes/audit.routes'));
app.use('/api/data-modeling', require('./routes/data-modeling.routes'));

// Health check
app.get('/api/health', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT NOW() as time, current_database() as db');
        res.json({
            success: true,
            status: 'healthy',
            server: '360data-backend',
            database: {
                connected: true,
                name: dbResult.rows[0].db,
                time: dbResult.rows[0].time,
            },
            uptime: process.uptime(),
        });
    } catch (err) {
        res.status(503).json({
            success: false,
            status: 'unhealthy',
            database: { connected: false, error: err.message },
        });
    }
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.path}` });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('❌ Unhandled error:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// ============================================
// Start Server
// ============================================
const startMessage = () => {
    const hostLabel = HOST || 'localhost';
    console.log('');
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   360data Solutions - Backend Server     ║');
    console.log(`║   Running on http://${hostLabel}:${PORT}         ║`);
    console.log('║   Frontend:   http://localhost:8080      ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // Optional background sync for Google Sheets interval mode.
    startGoogleSheetsScheduler();
};

if (HOST) {
    app.listen(PORT, HOST, startMessage);
} else {
    // No host binding => Node chooses dual-stack where available (works better with localhost on IPv4/IPv6)
    app.listen(PORT, startMessage);
}

module.exports = app;
