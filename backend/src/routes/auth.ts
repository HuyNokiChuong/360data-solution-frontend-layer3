import { Router, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import { AuthRequest } from '../middleware/auth.js';
import { emailService } from '../services/email.js';


const PUBLIC_DOMAINS = [
    'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com', 'me.com', 'msn.com', 'live.com', 'aol.com', 'mail.com', 'protonmail.com', 'yandex.com', 'zoho.com', 'gmx.com', 'fastmail.com', 'inbox.com', 'rocketmail.com', 'rediffmail.com', 'aim.com'
];

function isCorporateDomain(email: string): boolean {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    return !PUBLIC_DOMAINS.includes(domain);
}


export const authRouter = Router();

// Validation schemas
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    name: z.string().min(1),
    phoneNumber: z.string().optional(),
    jobTitle: z.string().optional(),
    level: z.string().optional(),
    department: z.string().optional(),
    industry: z.string().optional(),
    companySize: z.string().optional()
});

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string()
});

// Extract domain from email
function getDomain(email: string): string {
    return email.split('@')[1].toLowerCase();
}

// Generate JWT token
function generateToken(payload: object): string {
    const secret = process.env.JWT_SECRET || 'fallback_secret';
    const expiresIn = process.env.JWT_EXPIRES_IN || '7d';
    return jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
}

// POST /api/auth/register
// POST /api/auth/register
authRouter.post('/register', async (req, res: Response, next: NextFunction) => {
    try {
        const data = registerSchema.parse(req.body);
        const domain = getDomain(data.email);

        // 1. Strictly enforce Corporate Domain Policy
        if (!isCorporateDomain(data.email)) {
            throw new ApiError('Registration limited to corporate accounts only', 403, 'DOMAIN_RESTRICTED');
        }

        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() }
        });

        if (existingUser) {
            // Idempotency: If pending, resend code? For now, just error or standard flow
            if (existingUser.status === 'Pending') {
                // Ideally trigger resend code here
                throw new ApiError('Account pending verification. Please check your email.', 400, 'USER_PENDING');
            }
            throw new ApiError('User already exists', 400, 'USER_EXISTS');
        }

        // Get or create workspace
        let workspace = await prisma.workspace.findUnique({
            where: { domain }
        });

        const isFirstUser = !workspace;

        if (!workspace) {
            workspace = await prisma.workspace.create({
                data: {
                    domain,
                    name: domain.split('.')[0].toUpperCase()
                }
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(data.password, 12);

        // Generate Verification Code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        // Create user as PENDING
        const user = await prisma.user.create({
            data: {
                workspaceId: workspace.id,
                email: data.email.toLowerCase(),
                passwordHash,
                name: data.name,
                role: isFirstUser ? 'Admin' : 'Viewer',
                status: 'Pending', // Enforce Pending status
                phoneNumber: data.phoneNumber,
                jobTitle: data.jobTitle,
                level: data.level,
                department: data.department,
                industry: data.industry,
                companySize: data.companySize,
                verificationCode,
                verificationExpiresAt
            }
        });

        // Send Email
        await emailService.sendVerificationCode(user.email, verificationCode, user.name || 'User');

        res.status(201).json({
            success: true,
            message: 'Verification code sent',
            data: {
                email: user.email,
                status: 'Pending'
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

// POST /api/auth/verify
authRouter.post('/verify', async (req, res: Response, next: NextFunction) => {
    try {
        const { email, code } = req.body;
        if (!email || !code) throw new ApiError('Email and code required', 400);

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() },
            include: { workspace: true }
        });

        if (!user) throw new ApiError('User not found', 404);

        if (user.status !== 'Pending') {
            // Already active, just login? Or error?
            // Let's allow if they are just verifying again (idempotent-ish) or throw
            // For safety, if already active, we shouldn't use verify endpoint for login
            if (user.status === 'Active') throw new ApiError('User already verified. Please login.', 400);
        }

        if (user.verificationCode !== code) {
            throw new ApiError('Invalid verification code', 400, 'INVALID_CODE');
        }

        if (user.verificationExpiresAt && user.verificationExpiresAt < new Date()) {
            throw new ApiError('Verification code expired', 400, 'CODE_EXPIRED');
        }

        // Activate User
        const updatedUser = await prisma.user.update({
            where: { id: user.id },
            data: {
                status: 'Active',
                verificationCode: null,
                verificationExpiresAt: null,
                joinedAt: new Date()
            },
            include: { workspace: true }
        });

        // Create session
        const token = generateToken({
            userId: updatedUser.id,
            email: updatedUser.email,
            workspaceId: updatedUser.workspaceId,
            role: updatedUser.role
        });

        await prisma.session.create({
            data: {
                userId: updatedUser.id,
                token,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                deviceInfo: {
                    userAgent: req.headers['user-agent'],
                    platform: req.headers['sec-ch-ua-platform'] as string
                },
                ipAddress: req.ip
            }
        });

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    role: updatedUser.role,
                    status: updatedUser.status,
                    workspaceId: updatedUser.workspaceId,
                    workspaceDomain: updatedUser.workspace.domain,
                    joinedAt: updatedUser.joinedAt,
                    jobTitle: updatedUser.jobTitle,
                    phoneNumber: updatedUser.phoneNumber
                }
            }
        });

    } catch (error) {
        next(error);
    }
});

// POST /api/auth/resend-code
authRouter.post('/resend-code', async (req, res: Response, next: NextFunction) => {
    try {
        const { email } = req.body;
        if (!email) throw new ApiError('Email is required', 400);

        const user = await prisma.user.findUnique({
            where: { email: email.toLowerCase() }
        });

        if (!user) throw new ApiError('User not found', 404);

        if (user.status !== 'Pending') {
            throw new ApiError('User is already verified', 400);
        }

        // Generate New Verification Code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const verificationExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins

        await prisma.user.update({
            where: { id: user.id },
            data: {
                verificationCode,
                verificationExpiresAt
            }
        });

        // Send Email
        await emailService.sendVerificationCode(user.email, verificationCode, user.name || 'User');

        res.json({
            success: true,
            message: 'New verification code sent'
        });
    } catch (error) {
        next(error);
    }
});

// POST /api/auth/login
authRouter.post('/login', async (req, res: Response, next: NextFunction) => {
    try {
        const data = loginSchema.parse(req.body);

        // Find user
        const user = await prisma.user.findUnique({
            where: { email: data.email.toLowerCase() },
            include: { workspace: true }
        });

        if (!user || !user.passwordHash) {
            throw new ApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        // Verify password
        const validPassword = await bcrypt.compare(data.password, user.passwordHash);
        if (!validPassword) {
            throw new ApiError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
        }

        if (user.status === 'Disabled') {
            throw new ApiError('Account is disabled', 403, 'ACCOUNT_DISABLED');
        }

        // Create session
        const token = generateToken({
            userId: user.id,
            email: user.email,
            workspaceId: user.workspaceId,
            role: user.role
        });

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 7);

        await prisma.session.create({
            data: {
                userId: user.id,
                token,
                expiresAt,
                deviceInfo: {
                    userAgent: req.headers['user-agent'],
                    platform: req.headers['sec-ch-ua-platform']
                },
                ipAddress: req.ip
            }
        });

        // Update last login
        await prisma.user.update({
            where: { id: user.id },
            data: { lastLogin: new Date() }
        });

        res.json({
            success: true,
            data: {
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    role: user.role,
                    status: user.status,
                    workspaceId: user.workspaceId,
                    workspaceDomain: user.workspace.domain,
                    joinedAt: user.joinedAt,
                    jobTitle: user.jobTitle,
                    level: user.level,
                    department: user.department,
                    industry: user.industry,
                    companySize: user.companySize,
                    phoneNumber: user.phoneNumber
                }
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

// POST /api/auth/logout
authRouter.post('/logout', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader?.startsWith('Bearer ')) {
            const token = authHeader.substring(7);
            await prisma.session.deleteMany({ where: { token } });
        }

        res.json({ success: true, message: 'Logged out successfully' });
    } catch (error) {
        next(error);
    }
});

// GET /api/auth/me
authRouter.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            throw new ApiError('No token provided', 401);
        }

        const token = authHeader.substring(7);
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string };

        const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            include: { workspace: true }
        });

        if (!user) {
            throw new ApiError('User not found', 404);
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                name: user.name,
                role: user.role,
                status: user.status,
                workspaceId: user.workspaceId,
                workspaceDomain: user.workspace.domain,
                joinedAt: user.joinedAt,
                jobTitle: user.jobTitle,
                level: user.level,
                department: user.department,
                industry: user.industry,
                companySize: user.companySize,
                phoneNumber: user.phoneNumber
            }
        });
    } catch (error) {
        next(error);
    }
});
