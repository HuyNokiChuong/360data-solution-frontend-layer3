const { encryptString, decryptString } = require('./crypto.service');

const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_SHEETS_SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets.readonly',
    'https://www.googleapis.com/auth/drive.readonly',
];

const createGoogleAuthError = (message, details) => {
    const err = new Error(message);
    err.code = 'GOOGLE_AUTH_ERROR';
    if (details) err.details = details;
    return err;
};

const getGoogleOAuthEnv = () => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || 'postmessage';

    if (!clientId) {
        throw createGoogleAuthError('Missing GOOGLE_OAUTH_CLIENT_ID (or GOOGLE_CLIENT_ID fallback)');
    }
    if (!clientSecret) {
        throw createGoogleAuthError('Missing GOOGLE_OAUTH_CLIENT_SECRET');
    }

    return { clientId, clientSecret, redirectUri };
};

const exchangeAuthCode = async (code) => {
    if (!code || typeof code !== 'string') {
        throw createGoogleAuthError('Authorization code is required');
    }

    const { clientId, clientSecret, redirectUri } = getGoogleOAuthEnv();

    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
        throw createGoogleAuthError('Failed to exchange authorization code', payload);
    }

    const expiresIn = Number(payload.expires_in || 3600);
    const expiresAt = Date.now() + expiresIn * 1000;

    return {
        accessToken: payload.access_token,
        expiresIn,
        expiresAt,
        refreshToken: payload.refresh_token || null,
        scope: payload.scope || GOOGLE_SHEETS_SCOPES.join(' '),
        tokenType: payload.token_type || 'Bearer',
    };
};

const refreshAccessToken = async (refreshTokenEncrypted) => {
    if (!refreshTokenEncrypted) {
        throw createGoogleAuthError('Missing encrypted refresh token');
    }

    const refreshToken = decryptString(refreshTokenEncrypted);
    if (!refreshToken) {
        throw createGoogleAuthError('Invalid refresh token');
    }

    const { clientId, clientSecret } = getGoogleOAuthEnv();
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
        }),
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.access_token) {
        throw createGoogleAuthError('Failed to refresh access token', payload);
    }

    const expiresIn = Number(payload.expires_in || 3600);
    const expiresAt = Date.now() + expiresIn * 1000;

    return {
        accessToken: payload.access_token,
        expiresIn,
        expiresAt,
        scope: payload.scope || GOOGLE_SHEETS_SCOPES.join(' '),
        tokenType: payload.token_type || 'Bearer',
    };
};

const buildOAuthConfig = ({ currentOAuth, exchangeResult }) => {
    const existingRefreshTokenEncrypted = currentOAuth?.refreshTokenEncrypted || null;
    const refreshTokenEncrypted = exchangeResult.refreshToken
        ? encryptString(exchangeResult.refreshToken)
        : existingRefreshTokenEncrypted;

    return {
        provider: 'google',
        accessToken: exchangeResult.accessToken,
        tokenType: exchangeResult.tokenType || 'Bearer',
        scope: exchangeResult.scope || GOOGLE_SHEETS_SCOPES.join(' '),
        expiresAt: exchangeResult.expiresAt,
        refreshTokenEncrypted,
        updatedAt: new Date().toISOString(),
    };
};

const ensureAccessToken = async (oauthConfig) => {
    if (!oauthConfig || typeof oauthConfig !== 'object') {
        throw createGoogleAuthError('Google OAuth is not configured for this connection');
    }

    const now = Date.now();
    const expiry = Number(oauthConfig.expiresAt || 0);
    const hasAccessToken = typeof oauthConfig.accessToken === 'string' && oauthConfig.accessToken.length > 0;
    const isStillValid = hasAccessToken && expiry > now + 60 * 1000;

    if (isStillValid) {
        return {
            accessToken: oauthConfig.accessToken,
            oauthConfig: { ...oauthConfig },
            refreshed: false,
        };
    }

    if (!oauthConfig.refreshTokenEncrypted) {
        throw createGoogleAuthError('Google token expired and refresh token is unavailable');
    }

    const refreshed = await refreshAccessToken(oauthConfig.refreshTokenEncrypted);
    const nextOAuth = {
        ...oauthConfig,
        accessToken: refreshed.accessToken,
        tokenType: refreshed.tokenType || oauthConfig.tokenType || 'Bearer',
        scope: refreshed.scope || oauthConfig.scope || GOOGLE_SHEETS_SCOPES.join(' '),
        expiresAt: refreshed.expiresAt,
        updatedAt: new Date().toISOString(),
    };

    return {
        accessToken: refreshed.accessToken,
        oauthConfig: nextOAuth,
        refreshed: true,
    };
};

module.exports = {
    GOOGLE_SHEETS_SCOPES,
    createGoogleAuthError,
    exchangeAuthCode,
    refreshAccessToken,
    ensureAccessToken,
    buildOAuthConfig,
};

