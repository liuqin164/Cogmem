import { asRecord, stringOrEmpty } from '../../utils/Values.js';
export function formatTraceReply(data: unknown): string {
  const events = extractArray(data, ['events', 'items']);
  if (events.length === 0) {
    return '当前没有可展示的决策轨迹。';
  }

  const lines = events.map((item) => {
    const event = asRecord(item);
    const eventType = stringOrEmpty(event.eventType) || 'unknown';
    const timestamp = numberOrNull(event.timestamp);
    const timeLabel = timestamp === null ? 'unknown-time' : new Date(timestamp).toISOString();
    return `• ${timeLabel} ${eventType}`;
  });

  return `最近 ${events.length} 条轨迹事件：\n${lines.join('\n')}`;
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

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
