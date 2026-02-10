import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { ApiError } from './errorHandler.js';

export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        workspaceId: string;
        role: string;
    };
}

interface JwtPayload {
    userId: string;
    email: string;
    workspaceId: string;
    role: string;
}

export async function authMiddleware(
    req: AuthRequest,
    _res: Response,
    next: NextFunction
) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            throw new ApiError('No token provided', 401, 'NO_TOKEN');
        }

        const token = authHeader.substring(7);
        const jwtSecret = process.env.JWT_SECRET;

        if (!jwtSecret) {
            throw new ApiError('JWT secret not configured', 500, 'CONFIG_ERROR');
        }

        const decoded = jwt.verify(token, jwtSecret) as JwtPayload;

        // Verify session still exists
        const session = await prisma.session.findFirst({
            where: {
                token,
                userId: decoded.userId,
                expiresAt: { gt: new Date() }
            }
        });

        if (!session) {
            throw new ApiError('Session expired or invalid', 401, 'INVALID_SESSION');
        }

        // Update last active
        await prisma.session.update({
            where: { id: session.id },
            data: { lastActive: new Date() }
        });

        req.user = {
            id: decoded.userId,
            email: decoded.email,
            workspaceId: decoded.workspaceId,
            role: decoded.role
        };

        next();
    } catch (error) {
        if (error instanceof jwt.JsonWebTokenError) {
            next(new ApiError('Invalid token', 401, 'INVALID_TOKEN'));
        } else {
            next(error);
        }
    }
}

export function requireRole(...roles: string[]) {
    return (req: AuthRequest, _res: Response, next: NextFunction) => {
        if (!req.user) {
            return next(new ApiError('Not authenticated', 401));
        }

        if (!roles.includes(req.user.role)) {
            return next(new ApiError('Insufficient permissions', 403, 'FORBIDDEN'));
        }

        next();
    };
}
