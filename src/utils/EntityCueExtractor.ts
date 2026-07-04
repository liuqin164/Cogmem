export interface EntityCue {
  label: string;
  id: string;
}

export interface OperationalActionCue {
  kind: string;
  label: string;
  verb: string;
}

const ENTITY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'before',
  'bug',
  'context',
  'database',
  'debug',
  'exact',
  'graph',
  'install',
  'installed',
  'launch',
  'launched',
  'memory',
  'operation',
  'operations',
  'quote',
  'recall',
  'sourcecontext',
  'start',
  'started',
  'the',
  'what',
  'you',
]);

export function extractEntityCues(text: string, limit = 8): EntityCue[] {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  const labels: string[] = [];
  collectEntityMatches(normalized, /(?:对|给|把|关于|有关|围绕)\s*([A-Za-z][A-Za-z0-9_-]{1,48}|[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9_-]{1,23})\s*(?:做过|做了|做|启动|安装|配置|修改|重启|停止|操作|处理|执行|有关|的)/giu, labels);
  collectEntityMatches(normalized, /(?:启动|安装|配置|修改|重启|停止|执行|运行|start|started|launch|launched|boot|install|installed|setup|configure|configured|restart|stop|run|ran)\s*(?:本机安装的|本地的|the\s+)?([A-Za-z][A-Za-z0-9_-]{1,48}|[\u3400-\u9fff][\u3400-\u9fffA-Za-z0-9_-]{1,23})/giu, labels);
  collectEntityMatches(normalized, /\b([A-Z][A-Za-z0-9_-]{1,48})\b/g, labels);

  const seen = new Set<string>();
  const cues: EntityCue[] = [];
  for (const label of labels.map(cleanEntityLabel).filter(Boolean)) {
    const id = normalizeEntityCueId(label);
    if (!id || ENTITY_STOP_WORDS.has(id) || seen.has(id)) continue;
    seen.add(id);
    cues.push({ label, id });
    if (cues.length >= limit) break;
  }
  return cues;
}

export function inferOperationalActionCue(text: string): OperationalActionCue | undefined {
  if (/启动|start|started|launch|launched|boot/i.test(text)) return { kind: 'started', label: '启动', verb: '启动' };
  if (/安装|install|installed|setup/i.test(text)) return { kind: 'installed', label: '安装', verb: '安装' };
  if (/配置|config|configured|设置|修改配置|修改/i.test(text)) return { kind: 'configured', label: '配置', verb: '配置' };
  if (/重启|restart|restarted/i.test(text)) return { kind: 'restarted', label: '重启', verb: '重启' };
  if (/停止|stop|stopped/i.test(text)) return { kind: 'stopped', label: '停止', verb: '停止' };
  if (/操作|处理|执行|运行|run|ran/i.test(text)) return { kind: 'operated', label: '操作', verb: '操作' };
  return undefined;
}

export function normalizeEntityCueId(label: string): string {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/['"“”‘’`]/g, '')
    .replace(/[^a-z0-9\u3400-\u9fff]+/gu, '-')
    .replace(/^-|-$/g, '');
}

function collectEntityMatches(text: string, regex: RegExp, out: string[]): void {
  for (const match of text.matchAll(regex)) {
    if (match[1]) out.push(match[1]);
  }
}

function cleanEntityLabel(label: string): string {
  return String(label || '')
    .replace(/^(本机安装的|本地的|the\s+)/i, '')
    .replace(/[，。？！、；：,.?!;:()[\]{}<>]/g, '')
    .trim();
}
