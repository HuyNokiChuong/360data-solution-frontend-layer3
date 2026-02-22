const crypto = require('crypto');

const IV_LENGTH = 12; // AES-GCM recommended nonce size
const KEY_LENGTH = 32; // AES-256

const getSecret = () => process.env.CONNECTION_SECRET_KEY || '';

const deriveKey = () => {
    const secret = getSecret();
    if (!secret) {
        throw new Error('CONNECTION_SECRET_KEY is required for connection credential encryption');
    }
    return crypto.createHash('sha256').update(secret).digest().subarray(0, KEY_LENGTH);
};

const encryptString = (plainText) => {
    const text = plainText === undefined || plainText === null ? '' : String(plainText);
    const key = deriveKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString('base64')}.${authTag.toString('base64')}.${encrypted.toString('base64')}`;
};

const decryptString = (payload) => {
    if (!payload || typeof payload !== 'string') return '';
    const parts = payload.split('.');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted payload format');
    }

    const key = deriveKey();
    const iv = Buffer.from(parts[0], 'base64');
    const authTag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
};

const encryptJSON = (value) => {
    return encryptString(JSON.stringify(value ?? null));
};

const decryptJSON = (payload) => {
    const raw = decryptString(payload);
    return JSON.parse(raw);
};

module.exports = {
    encryptString,
    decryptString,
    encryptJSON,
    decryptJSON,
};

