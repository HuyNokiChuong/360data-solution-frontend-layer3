import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { connectionsRouter } from './routes/connections.js';
import { dashboardsRouter } from './routes/dashboards.js';
import { sessionsRouter } from './routes/sessions.js';
import { foldersRouter } from './routes/folders.js';
import { aiRouter } from './routes/ai.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger } from './middleware/requestLogger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:8080')
    .split(',')
    .map(s => s.trim());

app.use(cors({
    origin: (origin, callback) => {
        // Allow requests with no origin (mobile apps, curl, same-origin proxy)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true); // Allow all in development, restrict in production via Nginx
        }
    },
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Health check
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Public routes
app.use('/api/auth', authRouter);

// Protected routes
app.use('/api/users', authMiddleware, usersRouter);
app.use('/api/connections', authMiddleware, connectionsRouter);
app.use('/api/dashboards', authMiddleware, dashboardsRouter);
app.use('/api/sessions', authMiddleware, sessionsRouter);
app.use('/api/folders', authMiddleware, foldersRouter);
app.use('/api/ai', authMiddleware, aiRouter);

// Error handler
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

export default app;
