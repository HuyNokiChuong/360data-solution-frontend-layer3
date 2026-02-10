import { Router, Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const foldersRouter = Router();

// GET /api/folders
foldersRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const folders = await prisma.bIFolder.findMany({
            where: { workspaceId: req.user!.workspaceId },
            include: {
                _count: { select: { dashboards: true, children: true } }
            },
            orderBy: { createdAt: 'asc' }
        });

        res.json({
            success: true,
            data: folders.map(f => ({
                id: f.id,
                name: f.name,
                parentId: f.parentId,
                icon: f.icon,
                color: f.color,
                createdAt: f.createdAt,
                dashboardCount: f._count.dashboards,
                childCount: f._count.children
            }))
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/folders
foldersRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { name, parentId, icon, color } = req.body;

        const folder = await prisma.bIFolder.create({
            data: {
                workspaceId: req.user!.workspaceId,
                createdById: req.user!.id,
                name: name || 'New Folder',
                parentId,
                icon,
                color
            }
        });

        res.status(201).json({ success: true, data: folder });
    } catch (error) {
        next(error);
    }
});

// PUT /api/folders/:id
foldersRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, parentId, icon, color } = req.body;

        const existing = await prisma.bIFolder.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!existing) {
            throw new ApiError('Folder not found', 404);
        }

        const folder = await prisma.bIFolder.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(parentId !== undefined && { parentId }),
                ...(icon !== undefined && { icon }),
                ...(color !== undefined && { color })
            }
        });

        res.json({ success: true, data: folder });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/folders/:id
foldersRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const existing = await prisma.bIFolder.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!existing) {
            throw new ApiError('Folder not found', 404);
        }

        // This will cascade delete child folders and set null on dashboards
        await prisma.bIFolder.delete({ where: { id } });

        res.json({ success: true, message: 'Folder deleted' });
    } catch (error) {
        next(error);
    }
});
