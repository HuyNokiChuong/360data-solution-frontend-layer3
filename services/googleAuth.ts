
// Storage key helpers with domain scoping
const getScopedKey = (key: string) => {
    const savedUser = localStorage.getItem('auth_user');
    if (savedUser) {
        const u = JSON.parse(savedUser);
        const d = u.email.split('@')[1];
        return `${d}_${key}`;
    }
    return key;
};

export const initGoogleAuth = (clientId: string) => {
    return new Promise<void>((resolve, reject) => {
        if ((window as any).google) {
            resolve();
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => resolve();
        script.onerror = (err) => reject(err);
        document.head.appendChild(script);
    });
};

// Storage keys
const ACCESS_TOKEN_KEY = 'googleToken'; // Matches App.tsx domain_googleToken
const TOKEN_EXPIRY_KEY = 'googleTokenExpiry';

// Save tokens to localStorage
export const saveTokens = (accessToken: string, expiresIn: number) => {
    const scopedTokenKey = getScopedKey(ACCESS_TOKEN_KEY);
    const scopedExpiryKey = getScopedKey(TOKEN_EXPIRY_KEY);

    localStorage.setItem(scopedTokenKey, accessToken);
    const expiryTime = Date.now() + (expiresIn * 1000);
    localStorage.setItem(scopedExpiryKey, expiryTime.toString());
    console.log(`💾 Token saved to ${scopedTokenKey}, expires at ${new Date(expiryTime).toLocaleTimeString()}`);
};

// Get stored access token if still valid
export const getStoredToken = (): string | null => {
    const scopedTokenKey = getScopedKey(ACCESS_TOKEN_KEY);
    const scopedExpiryKey = getScopedKey(TOKEN_EXPIRY_KEY);

    const token = localStorage.getItem(scopedTokenKey);
    const expiry = localStorage.getItem(scopedExpiryKey);

    if (!token) return null;
    if (!expiry) return token;

    // Check if token is expired (proactive refresh with 5 min buffer)
    const buffer = 5 * 60 * 1000;
    const isNearExpiry = Date.now() > (parseInt(expiry) - buffer);

    if (isNearExpiry) {
        console.log(`⏰ Token nearly expired (expires in < 5 mins).`);
        return null;
    }

    return token;
};

// Refresh access token using silent refresh
export const refreshAccessToken = async (clientId: string): Promise<string | null> => {
    if (!clientId) return null;

    if (!(window as any).google) {
        await initGoogleAuth(clientId);
    }

    // DEBUG: Deployment Verification
    console.log(`[Auth] Client ID: ${clientId}`);
    console.log(`[Auth] Origin: ${window.location.origin} (Verify in Google Console)`);

    try {
        console.log('🔄 Triggering pro-active silent token refresh...');
        return new Promise((resolve) => {
            const client = (window as any).google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
                prompt: '',
                callback: (tokenResponse: any) => {
                    if (tokenResponse.access_token) {
                        saveTokens(tokenResponse.access_token, tokenResponse.expires_in || 3600);
                        console.log('✅ Token refreshed successfully via background channel');
                        resolve(tokenResponse.access_token);
                    } else {
                        console.warn('⚠️ Silent background refresh rejected by Google', tokenResponse);
                        resolve(null);
                    }
                },
                error_callback: (err: any) => {
                    console.error('❌ GIS Error during background refresh:', err);
                    resolve(null);
                }
            });

            client.requestAccessToken({ prompt: '' });

            // Timeout if Google doesn't respond in 10s
            setTimeout(() => resolve(null), 10000);
        });
    } catch (e) {
        console.error('❌ Token refresh process error:', e);
        return null;
    }
};

// Get valid token (from storage or refresh)
export const getValidToken = async (clientId: string): Promise<string | null> => {
    // 1. Try to get stored token
    const storedToken = getStoredToken();
    if (storedToken) {
        return storedToken;
    }

    // 2. Try to refresh token silently
    const refreshedToken = await refreshAccessToken(clientId);
    if (refreshedToken) {
        return refreshedToken;
    }

    // 3. No valid token available
    return null;
};

// Trigger full login (with popup)
export const getGoogleToken = (clientId: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        console.log(`[Auth] Manual Login Origin: ${window.location.origin}`);
        const client = (window as any).google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/bigquery.readonly https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
            callback: (tokenResponse: any) => {
                if (tokenResponse.access_token) {
                    saveTokens(tokenResponse.access_token, tokenResponse.expires_in || 3600);
                    console.log('✅ New access token obtained and saved');
                    resolve(tokenResponse.access_token);
                } else {
                    reject(new Error('Failed to get access token'));
                }
            },
        });
        client.requestAccessToken();
    });
};

/**
 * Higher-level helper to get a token for a given connection
 */
export const getTokenForConnection = async (conn: any, clientId: string): Promise<string | null> => {
    if (conn.authType === 'ServiceAccount' && conn.serviceAccountKey) {
        return getServiceAccountToken(conn.serviceAccountKey);
    }
    return getValidToken(clientId);
};

// Clear all stored tokens (for logout)
export const clearStoredTokens = () => {
    const scopedTokenKey = getScopedKey(ACCESS_TOKEN_KEY);
    const scopedExpiryKey = getScopedKey(TOKEN_EXPIRY_KEY);
    localStorage.removeItem(scopedTokenKey);
    localStorage.removeItem(scopedExpiryKey);
    console.log('🗑️ Stored tokens cleared');
};
// --- Service Account Helper Functions ---

/**
 * Converts a PEM formatted private key string to an ArrayBuffer
 */
const pemToArrayBuffer = (pem: string): ArrayBuffer => {
    const b64 = pem
        .replace(/-----BEGIN PRIVATE KEY-----/, '')
        .replace(/-----END PRIVATE KEY-----/, '')
        .replace(/\s/g, '');
    const binaryStr = window.atob(b64);
    const len = binaryStr.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return bytes.buffer;
};

/**
 * Base64URL encode a string or ArrayBuffer
 */
const base64UrlEncode = (data: string | ArrayBuffer): string => {
    let b64: string;
    if (typeof data === 'string') {
        b64 = window.btoa(unescape(encodeURIComponent(data)));
    } else {
        const bytes = new Uint8Array(data);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        b64 = window.btoa(binary);
    }
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/**
 * Obtains an OAuth2 access token using a Google Service Account JSON key
 */
export const getServiceAccountToken = async (jsonKey: string): Promise<string | null> => {
    try {
        const key = JSON.parse(jsonKey);
        const scopedTokenKey = getScopedKey(`${ACCESS_TOKEN_KEY}_sa_${key.client_email}`);
        const scopedExpiryKey = getScopedKey(`${TOKEN_EXPIRY_KEY}_sa_${key.client_email}`);

        // 0. Check Cache
        const cachedToken = localStorage.getItem(scopedTokenKey);
        const cachedExpiry = localStorage.getItem(scopedExpiryKey);
        const buffer = 5 * 60 * 1000; // 5 min buffer

        if (cachedToken && cachedExpiry && Date.now() < (parseInt(cachedExpiry) - buffer)) {
            return cachedToken;
        }

        const iat = Math.floor(Date.now() / 1000);
        const exp = iat + 3600;

        // 1. Create JWT Header
        const header = {
            alg: 'RS256',
            typ: 'JWT'
        };

        // 2. Create JWT Claim Set
        const claimSet = {
            iss: key.client_email,
            scope: 'https://www.googleapis.com/auth/bigquery https://www.googleapis.com/auth/cloud-platform',
            aud: 'https://oauth2.googleapis.com/token',
            exp: exp,
            iat: iat
        };

        const encodedHeader = base64UrlEncode(JSON.stringify(header));
        const encodedClaimSet = base64UrlEncode(JSON.stringify(claimSet));
        const signatureInput = `${encodedHeader}.${encodedClaimSet}`;

        // 3. Sign the JWT using Web Crypto API
        const privateKeyBuffer = pemToArrayBuffer(key.private_key);
        const cryptoKey = await crypto.subtle.importKey(
            'pkcs8',
            privateKeyBuffer,
            {
                name: 'RSASSA-PKCS1-v1_5',
                hash: { name: 'SHA-256' }
            },
            false,
            ['sign']
        );

        const signatureBuffer = await crypto.subtle.sign(
            'RSASSA-PKCS1-v1_5',
            cryptoKey,
            new TextEncoder().encode(signatureInput)
        );

        const encodedSignature = base64UrlEncode(signatureBuffer);
        const jwt = `${signatureInput}.${encodedSignature}`;

        // 4. Exchange JWT for Access Token
        const response = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(`Token exchange failed: ${JSON.stringify(error)}`);
        }

        const data = await response.json();

        // Save to Cache
        localStorage.setItem(scopedTokenKey, data.access_token);
        localStorage.setItem(scopedExpiryKey, (Date.now() + (data.expires_in || 3600) * 1000).toString());

        console.log('✅ Service Account token obtained successfully');
        return data.access_token;
    } catch (error) {
        console.error('❌ Error getting Service Account token:', error);
        return null;
    }
};
