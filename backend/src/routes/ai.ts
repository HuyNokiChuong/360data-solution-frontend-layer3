import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const aiRouter = Router();

const aiSettingSchema = z.object({
    provider: z.enum(['OpenAI', 'Gemini', 'Anthropic']),
    apiKey: z.string().min(1),
    settings: z.any().optional()
});

// GET /api/ai/settings
aiRouter.get('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const settings = await prisma.aISetting.findMany({
            where: { workspaceId: req.user!.workspaceId }
        });

        res.json({
            success: true,
            data: settings.map(s => ({
                provider: s.provider,
                apiKey: s.apiKey, // In a real production app, we might mask this or only return it on specific request
                settings: s.settings
            }))
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/ai/settings
aiRouter.post('/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { provider, apiKey, settings } = aiSettingSchema.parse(req.body);

        const aiSetting = await prisma.aISetting.upsert({
            where: {
                workspaceId_provider: {
                    workspaceId: req.user!.workspaceId,
                    provider
                }
            },
            update: {
                apiKey,
                settings: settings || {}
            },
            create: {
                workspaceId: req.user!.workspaceId,
                provider,
                apiKey,
                settings: settings || {}
            }
        });

        res.json({
            success: true,
            data: aiSetting
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            next(new ApiError(error.errors[0].message, 400, 'VALIDATION_ERROR'));
        } else {
            next(error);
        }
    }
});
