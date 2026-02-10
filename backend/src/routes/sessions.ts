import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const sessionsRouter = Router();

// GET /api/sessions - List report/chat sessions
sessionsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const sessions = await prisma.reportSession.findMany({
            where: { workspaceId: req.user!.workspaceId },
            include: {
                _count: { select: { messages: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            data: sessions.map(s => ({
                id: s.id,
                title: s.title,
                createdAt: s.createdAt,
                messageCount: s._count.messages
            }))
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/sessions
sessionsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { title } = req.body;

        const session = await prisma.reportSession.create({
            data: {
                workspaceId: req.user!.workspaceId,
                userId: req.user!.id,
                title: title || 'New Session'
            }
        });

        res.status(201).json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
});

// GET /api/sessions/:id
sessionsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const session = await prisma.reportSession.findFirst({
            where: { id, workspaceId: req.user!.workspaceId },
            include: {
                messages: { orderBy: { createdAt: 'asc' } }
            }
        });

        if (!session) {
            throw new ApiError('Session not found', 404);
        }

        res.json({ success: true, data: session });
    } catch (error) {
        next(error);
    }
});

// PUT /api/sessions/:id
sessionsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { title } = req.body;

        const session = await prisma.reportSession.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!session) {
            throw new ApiError('Session not found', 404);
        }

        const updated = await prisma.reportSession.update({
            where: { id },
            data: { title }
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/sessions/:id
sessionsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const session = await prisma.reportSession.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!session) {
            throw new ApiError('Session not found', 404);
        }

        await prisma.reportSession.delete({ where: { id } });

        res.json({ success: true, message: 'Session deleted' });
    } catch (error) {
        next(error);
    }
});

// GET /api/sessions/:id/messages
sessionsRouter.get('/:id/messages', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const session = await prisma.reportSession.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!session) {
            throw new ApiError('Session not found', 404);
        }

        const messages = await prisma.chatMessage.findMany({
            where: { sessionId: id },
            orderBy: { createdAt: 'asc' }
        });

        res.json({ success: true, data: messages });
    } catch (error) {
        next(error);
    }
});

// POST /api/sessions/:id/messages
sessionsRouter.post('/:id/messages', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { role, content, visualData, sqlTrace, executionTime } = req.body;

        const session = await prisma.reportSession.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!session) {
            throw new ApiError('Session not found', 404);
        }

        const message = await prisma.chatMessage.create({
            data: {
                sessionId: id,
                role,
                content,
                visualData,
                sqlTrace,
                executionTime
            }
        });

        res.status(201).json({ success: true, data: message });
    } catch (error) {
        next(error);
    }
});
