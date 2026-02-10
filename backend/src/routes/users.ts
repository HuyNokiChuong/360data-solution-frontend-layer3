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
// PUT /api/users/profile - Update own profile
usersRouter.put('/profile', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const { name, jobTitle, level, department, phoneNumber, industry, companySize } = req.body;

        const user = await prisma.user.update({
            where: { id: req.user!.id },
            data: {
                ...(name && { name }),
                ...(jobTitle && { jobTitle }),
                ...(level && { level }),
                ...(department && { department }),
                ...(phoneNumber && { phoneNumber }),
                ...(industry && { industry }),
                ...(companySize && { companySize })
            }
        });

        res.json({ success: true, data: user });
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
