export const CLI_JSON_SCHEMA_VERSION = 'cogmem.cli.v1' as const;

interface QueueCounters {
  candidate?: unknown;
  promoted?: unknown;
  needsConfirmation?: unknown;
  needs_confirmation?: unknown;
}

export function formatCliJson(
  command: string,
  payload: unknown,
  options: { queue?: QueueCounters; beliefs?: number } = {},
): Record<string, unknown> {
  const queue = options.queue;
  const output: Record<string, unknown> = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? { ...(payload as Record<string, unknown>), schemaVersion: CLI_JSON_SCHEMA_VERSION, command }
    : { schemaVersion: CLI_JSON_SCHEMA_VERSION, command, items: Array.isArray(payload) ? payload : [payload] };
  if (queue) {
    output.candidate = finiteCounter(queue.candidate);
    output.promoted = finiteCounter(queue.promoted);
    output.needs_confirmation = finiteCounter(queue.needs_confirmation ?? queue.needsConfirmation);
    output.beliefs = finiteCounter(options.beliefs);
  }
  return output;
}

export function printCliJson(
  command: string,
  payload: unknown,
  options: { queue?: QueueCounters; beliefs?: number } = {},
): void {
  console.log(JSON.stringify(formatCliJson(command, payload, options), null, 2));
}

function finiteCounter(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}
