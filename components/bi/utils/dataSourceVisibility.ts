import type { DataSource } from '../types';

const LEGACY_AI_PREFIXES = ['[ai chart]', '[ai kpi]', '[ai report]'];

export const isAssistantGeneratedDataSource = (
  dataSource: Partial<DataSource> | null | undefined
): boolean => {
  if (!dataSource) return false;
  if (dataSource.type === 'ai_generated') return true;

  const explicitHidden = (dataSource as any).assistantGenerated === true
    || (dataSource as any).hiddenFromDataTables === true;
  if (explicitHidden) return true;

  const name = String(dataSource.name || '').trim().toLowerCase();
  if (!name) return false;
  return LEGACY_AI_PREFIXES.some((prefix) => name.startsWith(prefix));
};
