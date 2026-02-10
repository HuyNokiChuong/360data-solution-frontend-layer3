import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest, requireRole } from '../middleware/auth.js';

export const usersRouter = Router();

// GET /api/users - List workspace users
usersRouter.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const users = await prisma.user.findMany({
            where: { workspaceId: req.user!.workspaceId },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                joinedAt: true,
                lastLogin: true,
                jobTitle: true,
                level: true,
                department: true,
                phoneNumber: true,
                industry: true,
                companySize: true
            },
            orderBy: { joinedAt: 'desc' }
        });

        res.json({ success: true, data: users });
    } catch (error) {
        next(error);
    }
});

// PUT /api/users/:id - Update user (Admin only)
usersRouter.put('/:id', requireRole('Admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;
        const { name, role, status, jobTitle, level, department, phoneNumber } = req.body;

        // Verify user belongs to same workspace
        const targetUser = await prisma.user.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!targetUser) {
            throw new ApiError('User not found', 404);
        }

        const user = await prisma.user.update({
            where: { id },
            data: {
                ...(name && { name }),
                ...(role && { role }),
                ...(status && { status }),
                ...(jobTitle && { jobTitle }),
                ...(level && { level }),
                ...(department && { department }),
                ...(phoneNumber && { phoneNumber })
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                joinedAt: true,
                jobTitle: true,
                level: true,
                department: true,
                phoneNumber: true
            }
        });

        res.json({ success: true, data: user });
    } catch (error) {
        next(error);
    }
});

// DELETE /api/users/:id - Remove user (Admin only)
usersRouter.delete('/:id', requireRole('Admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { id } = req.params;

        // Prevent self-deletion
        if (id === req.user!.id) {
            throw new ApiError('Cannot delete yourself', 400, 'SELF_DELETE');
        }

        // Verify user belongs to same workspace
        const targetUser = await prisma.user.findFirst({
            where: { id, workspaceId: req.user!.workspaceId }
        });

        if (!targetUser) {
            throw new ApiError('User not found', 404);
        }

        await prisma.user.delete({ where: { id } });

        res.json({ success: true, message: 'User deleted' });
    } catch (error) {
        next(error);
    }
});

// POST /api/users/invite - Invite a user to workspace (Admin only)
usersRouter.post('/invite', requireRole('Admin'), async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { email, name, role } = req.body;

        if (!email || !name) {
            throw new ApiError('Email and name are required', 400);
        }

        // Check if user already exists in this workspace
        const existing = await prisma.user.findFirst({
            where: { email: email.toLowerCase(), workspaceId: req.user!.workspaceId }
        });

        if (existing) {
            throw new ApiError('User already exists in this workspace', 409);
        }

        const user = await prisma.user.create({
            data: {
                email: email.toLowerCase(),
                name,
                role: role || 'Viewer',
                status: 'Pending',
                passwordHash: '', // Invited users set password on first login
                workspaceId: req.user!.workspaceId
            },
            select: {
                id: true,
                email: true,
                name: true,
                role: true,
                status: true,
                joinedAt: true
            }
        });

        res.status(201).json({ success: true, data: user, message: 'User invited successfully' });
    } catch (error) {
        next(error);
    }
});
