import { asRecord, stringOrEmpty } from '../../utils/Values.js';
export function formatContradictionsReply(data: unknown): string {
  const items = extractArray(data, ['contradictions', 'items']);
  if (items.length === 0) {
    return '当前没有待确认的记忆矛盾。';
  }

  const lines = items.map((item) => {
    const contradiction = asRecord(item);
    const id = stringOrEmpty(contradiction.contradictionId) || 'unknown';
    const subject = stringOrEmpty(contradiction.subject) || 'unknown';
    const predicate = stringOrEmpty(contradiction.predicateFamily) || 'fact';
    const oldValue = stringOrEmpty(contradiction.existingValue) || '无内容';
    const newValue = stringOrEmpty(contradiction.newValue) || '无内容';
    return `• [${id}] ${subject} ${predicate}: 旧值「${oldValue}」 / 新值「${newValue}」`;
  });

  return `${items.length} 项记忆矛盾待确认：\n${lines.join('\n')}`;
}

function extractArray(data: unknown, keys: string[]): unknown[] {
  if (Array.isArray(data)) {
    return data;
  }

  const record = asRecord(data);
  for (const key of keys) {
    if (Array.isArray(record[key])) {
      return record[key] as unknown[];
    }
  }

  return [];
}
