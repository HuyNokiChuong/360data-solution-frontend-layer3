
export const PUBLIC_DOMAINS = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'icloud.com',
    'me.com',
    'msn.com',
    'live.com',
    'aol.com',
    'mail.com',
    'protonmail.com',
    'yandex.com',
    'zoho.com',
    'gmx.com',
    'fastmail.com',
    'inbox.com',
    'rocketmail.com',
    'rediffmail.com',
    'aim.com'
];

export const isCorporateDomain = (email: string): boolean => {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) return false;
    return !PUBLIC_DOMAINS.includes(domain);
};
