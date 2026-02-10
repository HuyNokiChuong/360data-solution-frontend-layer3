
import { prisma } from '../lib/prisma.js';

export const logAction = async (
    workspaceId: string,
    logType: string,
    message: string,
    target?: string
) => {
    try {
        await prisma.systemLog.create({
            data: {
                workspaceId,
                logType,
                message,
                target,
            },
        });
    } catch (error) {
        console.error('Failed to write system log:', error);
    }
};
