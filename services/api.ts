const rawApiBase = ((import.meta as any)?.env?.VITE_API_BASE_URL || 'https://evn.link').trim();
const normalizedApiBase = rawApiBase.replace(/\/+$/, '');

export const API_BASE = normalizedApiBase.endsWith('/api')
  ? normalizedApiBase
  : `${normalizedApiBase}/api`;
