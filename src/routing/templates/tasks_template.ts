import { asRecord, stringOrEmpty } from '../../utils/Values.js';
export function formatTasksReply(data: unknown): string {
  if (isCommandResult(data)) {
    return data.message || (data.success ? '任务操作已处理。' : '任务操作未执行。');
  }

  const tasks = extractArray(data, ['tasks']);
  if (tasks.length === 0) {
    return '当前没有进行中的任务。';
  }

  const lines = tasks.map((task) => {
    const record = asRecord(task);
    const status = stringOrEmpty(record.status) || 'unknown';
    const taskId = stringOrEmpty(record.taskId ?? record.id) || 'unknown';
    const goal = stringOrEmpty(record.goalDescription ?? record.goalText ?? record.currentPhase) || taskId;
    return `• [${status}] ${goal} (${taskId})`;
  });

  return `共 ${tasks.length} 个任务：\n${lines.join('\n')}`;
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

function isCommandResult(data: unknown): data is { success: boolean; message?: string } {
  const record = asRecord(data);
  return typeof record.success === 'boolean';
}
