const TABLE_REF_REGEX = /\b(FROM|JOIN|UPDATE|INTO|MERGE\s+INTO|DELETE\s+FROM)\s+((?:`[^`]+`(?:\s*\.\s*`[^`]+`)*)|[A-Za-z_][A-Za-z0-9_.-]*)/gi;

export const stripBigQueryProjectPrefixFromIdentifier = (identifier: string): string => {
  const raw = String(identifier || '').trim();
  if (!raw || raw.startsWith('(')) return raw;

  const normalized = raw
    .replace(/`/g, '')
    .replace(/\s*\.\s*/g, '.')
    .trim();
  const segments = normalized
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean);

  if (segments.length < 3) return raw;
  const withoutProject = segments.slice(1).join('.');
  return raw.includes('`') ? `\`${withoutProject}\`` : withoutProject;
};

export const stripBigQueryProjectPrefixFromSql = (sql: string): string => {
  const raw = String(sql || '');
  if (!raw.trim()) return raw;

  return raw.replace(TABLE_REF_REGEX, (full, keyword, identifier) => {
    const sanitizedIdentifier = stripBigQueryProjectPrefixFromIdentifier(String(identifier || ''));
    if (!sanitizedIdentifier) return full;
    return `${keyword} ${sanitizedIdentifier}`;
  });
};
