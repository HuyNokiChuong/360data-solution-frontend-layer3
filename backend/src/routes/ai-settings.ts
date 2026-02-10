import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const aiSettingsRouter = Router();

const aiSettingSchema = z.object({
    provider: z.string().min(1),
    apiKey: z.string().min(1),
    settings: z.record(z.any()).optional()
});

// GET /api/ai-settings
aiSettingsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const settings = await prisma.aiSetting.findMany({
            where: { workspaceId: req.user!.workspaceId }
        });

        res.json({
            success: true,
            data: settings.map((s: any) => ({
                id: s.id,
                provider: s.provider,
                apiKey: s.apiKey,
                settings: s.settings,
                updatedAt: s.updatedAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/ai-settings
aiSettingsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = aiSettingSchema.parse(req.body);

        const setting = await prisma.aiSetting.upsert({
            where: {
                workspaceId_provider: {
                    workspaceId: req.user!.workspaceId,
                    provider: data.provider
                }
            },
            update: {
                apiKey: data.apiKey,
                settings: data.settings || {}
            },
            create: {
                workspaceId: req.user!.workspaceId,
                provider: data.provider,
                apiKey: data.apiKey,
                settings: data.settings || {}
            }
        });

        res.json({ success: true, data: setting });
    } catch (error) {
        if (error instanceof z.ZodError) {
            next(new ApiError(error.errors[0].message, 400, 'VALIDATION_ERROR'));
        } else {
            next(error);
        }
    }
});

// DELETE /api/ai-settings/:id
aiSettingsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        await prisma.aiSetting.delete({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        res.json({ success: true, message: 'Settings deleted' });
    } catch (error) {
        next(error);
    }
});
