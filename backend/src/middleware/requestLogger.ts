
import { Request, Response, NextFunction } from 'express';
import { logAction } from '../services/logger.js';

// Extend Request to include user property
interface AuthenticatedRequest extends Request {
    user?: {
        workspaceId: string;
        email: string;
        id: string;
    };
}

export const requestLogger = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Capture the original end function
    const originalEnd = res.end;

    // Override end function to potential log after response is sent
    // Using 'any' for chunk/encoding as express signatures can vary slightly
    res.end = function (chunk?: any, encoding?: any, cb?: any) {
        // Restore original end
        res.end = originalEnd;
        const result = res.end(chunk, encoding, cb);

        // Only log if we have a user context (authenticated requests)
        // And for methods that change state (POST, PUT, DELETE)
        if (req.user && ['POST', 'PUT', 'DELETE'].includes(req.method)) {
            const logType = 'API_REQUEST';
            const message = `${req.method} ${req.path} - User: ${req.user.email}`;
            const target = req.path;

            // specific detail extraction
            let details = '';
            if (req.body && Object.keys(req.body).length > 0) {
                // Be careful not to log sensitive data like passwords
                const cleanBody = { ...req.body };
                delete cleanBody.password;
                delete cleanBody.token;
                details = JSON.stringify(cleanBody).substring(0, 200); // Truncate
            }

            logAction(req.user.workspaceId, logType, `${message} ${details ? `Details: ${details}` : ''}`, target)
                .catch(err => console.error('Error in request logger:', err));
        }

        return result;
    } as any;

    next();
};
