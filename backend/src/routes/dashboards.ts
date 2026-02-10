import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const dashboardsRouter = Router();

// GET /api/dashboards
dashboardsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const dashboards = await prisma.bIDashboard.findMany({
            where: { workspaceId: req.user!.workspaceId },
            include: {
                folder: { select: { id: true, name: true } },
                pages: { select: { id: true, title: true, position: true } }
            },
            orderBy: { updatedAt: 'desc' }
        });

        res.json({ success: true, data: dashboards });
    } catch (error) {
        next(error);
    }
});

// GET /api/dashboards/:id
dashboardsRouter.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId },
            include: {
                folder: true,
                pages: {
                    include: { widgets: true },
                    orderBy: { position: 'asc' }
                },
                globalFilters: true
            }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        res.json({ success: true, data: dashboard });
    } catch (error) {
        next(error);
    }
});

// POST /api/dashboards
dashboardsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { title, description, folderId, dataSourceId, dataSourceName } = req.body;

        const dashboard = await prisma.bIDashboard.create({
            data: {
                workspaceId: req.user!.workspaceId,
                createdById: req.user!.id,
                title: title || 'Untitled Dashboard',
                description,
                folderId,
                dataSourceId,
                dataSourceName,
                pages: {
                    create: {
                        title: 'Page 1',
                        position: 0
                    }
                }
            },
            include: { pages: true }
        });

        // Set active page ID
        await prisma.bIDashboard.update({
            where: { id: dashboard.id },
            data: { activePageId: dashboard.pages[0].id }
        });

        res.status(201).json({ success: true, data: dashboard });
    } catch (error) {
        next(error);
    }
});

// PUT /api/dashboards/:id
dashboardsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const updates = req.body;

        const existing = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!existing) {
            throw new ApiError('Dashboard not found', 404);
        }

        const dashboard = await prisma.bIDashboard.update({
            where: { id },
            data: {
                ...(updates.title && { title: updates.title }),
                ...(updates.description !== undefined && { description: updates.description }),
                ...(updates.folderId !== undefined && { folderId: updates.folderId }),
                ...(updates.dataSourceId !== undefined && { dataSourceId: updates.dataSourceId }),
                ...(updates.dataSourceName !== undefined && { dataSourceName: updates.dataSourceName }),
                ...(updates.enableCrossFilter !== undefined && { enableCrossFilter: updates.enableCrossFilter }),
                ...(updates.activePageId && { activePageId: updates.activePageId }),
                ...(updates.layout && { layout: updates.layout }),
                ...(updates.theme && { theme: updates.theme }),
                ...(updates.calculatedFields && { calculatedFields: updates.calculatedFields }),
                ...(updates.quickMeasures && { quickMeasures: updates.quickMeasures }),
                updatedAt: new Date()
            }
        });

        res.json({ success: true, data: dashboard });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/dashboards/:id
dashboardsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const existing = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!existing) {
            throw new ApiError('Dashboard not found', 404);
        }

        await prisma.bIDashboard.delete({ where: { id } });

        res.json({ success: true, message: 'Dashboard deleted' });
    } catch (error) {
        next(error);
    }
});

// POST /api/dashboards/:id/pages
dashboardsRouter.post('/:id/pages', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { title, dataSourceId, dataSourceName } = req.body;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId },
            include: { pages: true }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        const page = await prisma.dashboardPage.create({
            data: {
                dashboardId: id,
                title: title || `Page ${dashboard.pages.length + 1}`,
                position: dashboard.pages.length,
                dataSourceId,
                dataSourceName
            }
        });

        res.status(201).json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
});

// PUT /api/dashboards/:id/pages/:pageId
dashboardsRouter.put('/:id/pages/:pageId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, pageId } = req.params;
        const { title, position, dataSourceId, dataSourceName } = req.body;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        const page = await prisma.dashboardPage.update({
            where: { id: pageId },
            data: {
                ...(title && { title }),
                ...(position !== undefined && { position }),
                ...(dataSourceId !== undefined && { dataSourceId }),
                ...(dataSourceName !== undefined && { dataSourceName })
            }
        });

        res.json({ success: true, data: page });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/dashboards/:id/pages/:pageId
dashboardsRouter.delete('/:id/pages/:pageId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id, pageId } = req.params;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId },
            include: { pages: true }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        if (dashboard.pages.length <= 1) {
            throw new ApiError('Cannot delete the last page', 400);
        }

        await prisma.dashboardPage.delete({ where: { id: pageId } });

        // Update active page if deleted
        if (dashboard.activePageId === pageId) {
            const remainingPage = dashboard.pages.find(p => p.id !== pageId);
            await prisma.bIDashboard.update({
                where: { id },
                data: { activePageId: remainingPage?.id }
            });
        }

        res.json({ success: true, message: 'Page deleted' });
    } catch (error) {
        next(error);
    }
});

// POST /api/dashboards/:id/widgets
dashboardsRouter.post('/:id/widgets', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { pageId, type, title, chartType, x, y, w, h, config } = req.body;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        const widget = await prisma.bIWidget.create({
            data: {
                pageId: pageId || dashboard.activePageId!,
                type,
                title,
                chartType,
                x: x || 0,
                y: y || 0,
                w: w || 4,
                h: h || 4,
                config: config || {}
            }
        });

        res.status(201).json({ success: true, data: widget });
    } catch (error) {
        next(error);
    }
});

// PUT /api/dashboards/:id/widgets/:widgetId
dashboardsRouter.put('/:id/widgets/:widgetId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { widgetId } = req.params;
        const updates = req.body;

        const widget = await prisma.bIWidget.update({
            where: { id: widgetId },
            data: {
                ...(updates.type && { type: updates.type }),
                ...(updates.title !== undefined && { title: updates.title }),
                ...(updates.chartType !== undefined && { chartType: updates.chartType }),
                ...(updates.x !== undefined && { x: updates.x }),
                ...(updates.y !== undefined && { y: updates.y }),
                ...(updates.w !== undefined && { w: updates.w }),
                ...(updates.h !== undefined && { h: updates.h }),
                ...(updates.config && { config: updates.config })
            }
        });

        res.json({ success: true, data: widget });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/dashboards/:id/widgets/:widgetId
dashboardsRouter.delete('/:id/widgets/:widgetId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { widgetId } = req.params;

        await prisma.bIWidget.delete({ where: { id: widgetId } });

        res.json({ success: true, message: 'Widget deleted' });
    } catch (error) {
        next(error);
    }
});

// POST /api/dashboards/:id/global-filters
dashboardsRouter.post('/:id/global-filters', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, field, operator, value, appliedToWidgets } = req.body;

        const dashboard = await prisma.bIDashboard.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!dashboard) {
            throw new ApiError('Dashboard not found', 404);
        }

        const filter = await prisma.globalFilter.create({
            data: {
                dashboardId: id,
                name,
                field,
                operator,
                value,
                appliedToWidgets: appliedToWidgets || []
            }
        });

        res.status(201).json({ success: true, data: filter });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/dashboards/:id/global-filters/:filterId
dashboardsRouter.delete('/:id/global-filters/:filterId', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { filterId } = req.params;

        await prisma.globalFilter.delete({ where: { id: filterId } });

        res.json({ success: true, message: 'Filter deleted' });
    } catch (error) {
        next(error);
    }
});
