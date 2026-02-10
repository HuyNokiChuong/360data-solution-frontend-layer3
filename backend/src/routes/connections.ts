import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';

export const connectionsRouter = Router();

const connectionSchema = z.object({
    name: z.string().min(1),
    type: z.string(),
    authType: z.string().optional(),
    email: z.string().email().optional(),
    projectId: z.string().optional(),
    serviceAccountKey: z.string().optional()
});

// GET /api/connections
connectionsRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const connections = await prisma.connection.findMany({
            where: { workspaceId: req.user!.workspaceId },
            include: {
                _count: { select: { syncedTables: true } }
            },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            success: true,
            data: connections.map(c => ({
                id: c.id,
                name: c.name,
                type: c.type,
                authType: c.authType,
                email: c.email,
                status: c.status,
                projectId: c.projectId,
                tableCount: c._count.syncedTables,
                createdAt: c.createdAt
            }))
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/connections
connectionsRouter.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const data = connectionSchema.parse(req.body);

        const connection = await prisma.connection.create({
            data: {
                workspaceId: req.user!.workspaceId,
                createdById: req.user!.id,
                name: data.name,
                type: data.type,
                authType: data.authType,
                email: data.email,
                projectId: data.projectId,
                serviceAccountKey: data.serviceAccountKey,
                status: 'Connected'
            }
        });

        res.status(201).json({
            success: true,
            data: {
                id: connection.id,
                name: connection.name,
                type: connection.type,
                authType: connection.authType,
                email: connection.email,
                status: connection.status,
                projectId: connection.projectId,
                tableCount: 0,
                createdAt: connection.createdAt
            }
        });
    } catch (error) {
        if (error instanceof z.ZodError) {
            next(new ApiError(error.errors[0].message, 400, 'VALIDATION_ERROR'));
        } else {
            next(error);
        }
    }
});

// PUT /api/connections/:id
connectionsRouter.put('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, status, projectId, serviceAccountKey } = req.body;

        const connection = await prisma.connection.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!connection) {
            throw new ApiError('Connection not found', 404);
        }

        const updated = await prisma.connection.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(status && { status }),
                ...(projectId && { projectId }),
                ...(serviceAccountKey && { serviceAccountKey })
            }
        });

        res.json({ success: true, data: updated });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/connections/:id
connectionsRouter.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const connection = await prisma.connection.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!connection) {
            throw new ApiError('Connection not found', 404);
        }

        await prisma.connection.delete({ where: { id } });

        res.json({ success: true, message: 'Connection deleted' });
    } catch (error) {
        next(error);
    }
});

// GET /api/connections/:id/tables
connectionsRouter.get('/:id/tables', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        const connection = await prisma.connection.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!connection) {
            throw new ApiError('Connection not found', 404);
        }

        const tables = await prisma.syncedTable.findMany({
            where: { connectionId: id },
            orderBy: { tableName: 'asc' }
        });

        res.json({ success: true, data: tables });
    } catch (error) {
        next(error);
    }
});

// POST /api/connections/:id/tables
connectionsRouter.post('/:id/tables', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { tables } = req.body;

        const connection = await prisma.connection.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!connection) {
            throw new ApiError('Connection not found', 404);
        }

        // Upsert tables
        const results = await Promise.all(
            tables.map((t: any) =>
                prisma.syncedTable.upsert({
                    where: {
                        connectionId_datasetName_tableName: {
                            connectionId: id,
                            datasetName: t.datasetName || '',
                            tableName: t.tableName
                        }
                    },
                    update: {
                        rowCount: t.rowCount || 0,
                        schema: t.schema,
                        status: t.status || 'Active',
                        lastSync: new Date()
                    },
                    create: {
                        connectionId: id,
                        workspaceId: req.user!.workspaceId,
                        tableName: t.tableName,
                        datasetName: t.datasetName,
                        rowCount: t.rowCount || 0,
                        schema: t.schema,
                        status: 'Active'
                    }
                })
            )
        );

        res.json({ success: true, data: results });
    } catch (error) {
        next(error);
    }
});
