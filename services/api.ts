// NOTE: avoid optional chaining on `import.meta.env` - Vite only injects/replaces
// `import.meta.env.*` when it can statically detect the access.
const env = import.meta.env as any;
const configuredBase = String(env.VITE_API_BASE_URL ?? '').trim();

const getRuntimeProtocol = () => {
  if (typeof window !== 'undefined' && window.location && window.location.protocol) {
    return window.location.protocol === 'https:' ? 'https:' : 'http:';
  }
  return 'http:';
};

const getRuntimeHost = () => {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    return window.location.hostname;
  }
  return '127.0.0.1';
};

const normalizeConfiguredBase = (rawValue: string) => {
  const value = String(rawValue || '').trim().replace(/\/+$/, '');
  if (!value) return '';

  // Relative base for proxy (e.g. "/api")
  if (value.startsWith('/')) return value;

  // Already absolute
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      // Force IPv4 loopback to avoid localhost IPv6 mismatch in some environments.
      if (url.hostname === 'localhost') {
        url.hostname = '127.0.0.1';
      }
      return url.toString().replace(/\/+$/, '');
    } catch {
      return value;
    }
  }

  const protocol = getRuntimeProtocol();
  const host = getRuntimeHost();

  // Support shorthand forms: ":3001", "3001", "localhost:3001"
  if (/^:\d+$/.test(value)) return `${protocol}//${host}${value}`;
  if (/^\d+$/.test(value)) return `${protocol}//${host}:${value}`;
  if (/^localhost:\d+$/i.test(value)) {
    return `${protocol}//127.0.0.1:${value.split(':')[1]}`;
  }
  if (/^[a-z0-9.-]+:\d+$/i.test(value)) return `${protocol}//${value}`;

  return `${protocol}//${value}`;
};

const defaultBase = env.DEV ? 'http://127.0.0.1:3001' : 'https://evn.link';
const rawApiBase = normalizeConfiguredBase(configuredBase) || defaultBase;

if (!configuredBase && env.DEV) {
  console.warn('[api] VITE_API_BASE_URL is not set; defaulting to http://127.0.0.1:3001');
}

const normalizedApiBase = rawApiBase.replace(/\/+$/, '');

export const API_BASE = normalizedApiBase.endsWith('/api')
  ? normalizedApiBase
  : `${normalizedApiBase}/api`;
