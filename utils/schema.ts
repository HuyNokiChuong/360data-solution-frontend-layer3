export type CanonicalFieldType = 'string' | 'number' | 'date' | 'boolean';

const NUMBER_TYPE_MARKERS = [
  'NUMBER',
  'NUMERIC',
  'DECIMAL',
  'INT',
  'INTEGER',
  'BIGINT',
  'SMALLINT',
  'FLOAT',
  'DOUBLE',
  'REAL',
  'MONEY',
  'SERIAL',
];

const DATE_TYPE_MARKERS = ['DATE', 'TIME', 'TIMESTAMP', 'DATETIME'];
const BOOLEAN_TYPE_MARKERS = ['BOOLEAN', 'BOOL'];

export const normalizeFieldType = (rawType: string | null | undefined): CanonicalFieldType => {
  const t = String(rawType || '').trim().toUpperCase();
  if (!t) return 'string';

  if (t === 'NUMBER' || NUMBER_TYPE_MARKERS.some((marker) => t.includes(marker))) {
    return 'number';
  }
  if (BOOLEAN_TYPE_MARKERS.some((marker) => t.includes(marker))) {
    return 'boolean';
  }
  if (DATE_TYPE_MARKERS.some((marker) => t.includes(marker))) {
    return 'date';
  }
  return 'string';
};

export const normalizeSchema = (
  schema: Array<{ name: string; type: string }> | null | undefined
): Array<{ name: string; type: CanonicalFieldType }> => {
  if (!Array.isArray(schema)) return [];
  return schema.map((field) => ({
    name: String(field?.name || ''),
    type: normalizeFieldType(field?.type),
  }));
};
