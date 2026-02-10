import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const sharesRouter = Router();

// POST /api/shares
sharesRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { resourceType, resourceId, userId, permission } = req.body;

        if (!['dashboard', 'folder'].includes(resourceType)) {
            throw new ApiError('Invalid resource type', 400);
        }

        const share = await prisma.sharePermission.upsert({
            where: {
                resourceType_resourceId_userId: {
                    resourceType,
                    resourceId,
                    userId
                }
            },
            update: { permission: permission || 'view' },
            create: {
                resourceType,
                resourceId,
                userId,
                permission: permission || 'view'
            }
        });

        res.status(201).json({ success: true, data: share });
    } catch (error) {
        next(error);
    }
});

// GET /api/shares/:resourceType/:resourceId
sharesRouter.get('/:resourceType/:resourceId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { resourceType, resourceId } = req.params;

        const shares = await prisma.sharePermission.findMany({
            where: { resourceType, resourceId },
            include: {
                user: { select: { id: true, email: true, name: true } }
            }
        });

        res.json({ success: true, data: shares });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/shares/:id
sharesRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        await prisma.sharePermission.delete({ where: { id } });
        res.json({ success: true, message: 'Permission removed' });
    } catch (error) {
        next(error);
    }
});
