import type { TraceEvent } from './TraceEvent.js';
import { pad2 } from '../utils/Values.js';

function pad(value: number): string {
  return pad2(value);
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function quoteIfString(value: unknown): string {
  return typeof value === 'string' ? `"${value}"` : String(value);
}

function compactEventType(eventType: string): string {
  return eventType.endsWith('.decision') ? eventType.replace(/\.decision$/, '') : eventType;
}

function buildDetails(event: TraceEvent): string {
  const payload = event.payload;

  switch (event.eventType) {
    case 'recall.request':
      return payload.query ? `query=${quoteIfString(payload.query)}` : '';
    case 'recall.result':
      return `returned ${payload.factCount ?? 0} facts`;
    case 'confidence_gate.decision':
      return `verdict=${payload.verdict ?? 'unknown'}, score=${payload.score ?? 'n/a'}`;
    case 'risk_gate.decision':
      return `decision=${payload.decision ?? 'unknown'}, risk=${payload.riskLevel ?? 'n/a'}`;
    case 'task_router.plan':
      return `intent=${payload.intentType ?? 'unknown'}, steps=${payload.stepCount ?? 0}`;
    case 'capability.invoke':
      return `capability=${payload.capabilityId ?? 'unknown'}`;
    case 'capability.result':
      return `capability=${payload.capabilityId ?? 'unknown'}, success=${payload.success ?? false}`;
    case 'observation_filter.decision':
      return `shouldIngest=${payload.shouldIngest ?? false}, reason=${quoteIfString(payload.reason ?? '')}`;
    case 'memory.promote':
      return `count=${payload.count ?? 0}, type=${payload.memoryType ?? 'unknown'}`;
    case 'approval.request':
      return `capability=${payload.capabilityId ?? 'unknown'}, risk=${payload.riskLevel ?? 'n/a'}`;
    case 'approval.resolve':
      return `status=${payload.status ?? 'unknown'}`;
    case 'task_state.transition':
      return `${payload.from ?? 'unknown'} → ${payload.to ?? 'unknown'}`;
    default: {
      const entries = Object.entries(payload).slice(0, 3);
      return entries.map(([key, value]) => `${key}=${quoteIfString(value)}`).join(', ');
    }
  }
}

export class DecisionExplainer {
  explain(events: TraceEvent[]): string {
    if (events.length === 0) return 'No events';

    const sorted = [...events].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
    const taskId = sorted.find((event) => event.taskId)?.taskId ?? 'unknown';
    const lines = [`Task ${taskId}`];

    sorted.forEach((event, index) => {
      const branch = index === sorted.length - 1 ? '└─' : '├─';
      const details = buildDetails(event);
      const suffix = details ? `  ${details}` : '';
      lines.push(`  ${branch} [${formatTime(event.timestamp)}] ${compactEventType(event.eventType)}${suffix}`);
    });

    return lines.join('\n');
  }
}
