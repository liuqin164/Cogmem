import { asRecord, stringOrEmpty } from '../../utils/Values.js';
export function formatMemoryReply(data: unknown): string {
  if (typeof data === 'number') {
    return `当前记忆条目数：${data}`;
  }

  const facts = extractArray(data, ['facts', 'items', 'memories']);
  if (facts.length === 0) {
    return '当前没有可展示的记忆。';
  }

  const lines = facts.map((item) => {
    const fact = asRecord(item);
    const subject = stringOrEmpty(fact.subject) || 'unknown';
    const predicate = stringOrEmpty(fact.predicateFamily) || 'fact';
    const value = stringOrEmpty(fact.predicateValue ?? fact.object ?? fact.sourceText) || '无内容';
    return `• ${subject} ${predicate}: ${value}`;
  });

  return `共找到 ${facts.length} 条记忆：\n${lines.join('\n')}`;
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
