/**
 * The night integration, run in the DREAMING state.
 *
 * The product is written as the companion's own agent identity and carries the full `sourceRefs` of
 * the day's events, so it can be attributed (and later deleted) like any other memory rather than
 * laundering itself into the user's recall as anonymous evidence.
 *
 * Deterministic by design: the summary is a function of the day's redacted ledger, not a model call.
 */
import type { KernelAgentMemoryBackend, MemoryEvent, MemoryKernel, MemorySourceRef } from 'cogmem';
import type { TraceLog } from '../trace.ts';
import type { NativePlugin } from './host.ts';

export interface DreamServiceOptions {
  kernel: MemoryKernel;
  backend: KernelAgentMemoryBackend;
  agentId: string;
  projectId: string;
  sessionId: string;
  runKernelNight: boolean;
  maxEpisodes: number;
  trace?: TraceLog;
}

export interface DreamPluginConfig extends Omit<DreamServiceOptions, 'kernel' | 'backend' | 'trace'> {}

export interface DreamResult {
  localDate: string;
  eventCount: number;
  sourceRefs: MemorySourceRef[];
  summary: string;
  dreamEventId?: string;
  compiledNeuronId?: string;
  kernelNightRan: boolean;
  kernelNightSkippedReason?: string;
}

export class DreamService {
  constructor(private readonly options: DreamServiceOptions) {}

  async integrate(localDate: string, dayThreadId: string, now = Date.now()): Promise<DreamResult> {
    const { kernel, backend, agentId, projectId, sessionId } = this.options;
    const events = kernel
      .getThreadEvents(dayThreadId, { projectId, limit: 5_000 })
      .filter((event) => !isDreamProduct(event));
    const refs = dedupeRefs(events);
    let kernelNightRan = false;
    let kernelNightSkippedReason: string | undefined;
    if (this.options.runKernelNight) {
      try {
        const night = await kernel.runNight({ projectId, maxEpisodes: this.options.maxEpisodes, now });
        kernelNightRan = true;
        kernelNightSkippedReason = night.dream.skipped ? night.dream.reason : undefined;
      } catch (error) {
        kernelNightSkippedReason = error instanceof Error ? error.message : String(error);
        this.options.trace?.append('dream_kernel_night_failed', { localDate, message: kernelNightSkippedReason });
      }
    } else {
      kernelNightSkippedReason = 'disabled_by_config';
    }
    const summary = summarize(localDate, events, kernelNightSkippedReason);
    const dreamEvent = await backend.ingestTaskEvent({
      agentId,
      projectId,
      workspaceId: projectId,
      sessionId,
      threadId: `companion-dream:${localDate}`,
      taskId: `dream-${localDate}`,
      title: `夜间整合 ${localDate}`,
      content: summary,
      metadata: {
        sourceAgent: agentId,
        kind: 'dream-integration',
        sourceEventIds: refs.map((ref) => ref.eventId),
        sourceRefs: refs,
        kernelNightRan,
      },
      timestamp: now,
    });
    const neuron = await kernel.ingest({
      content: summary,
      projectId,
      source: agentId,
      sourceType: 'llm_inference',
      type: 'semantic_consolidation',
      sourceRefs: refs,
      tags: ['companion', 'dream', `local_date:${localDate}`],
      createdAt: now,
    });
    this.options.trace?.append('dream_integrated', {
      localDate,
      eventCount: events.length,
      sourceRefCount: refs.length,
      dreamEventId: dreamEvent.eventId,
      compiledNeuronId: neuron.id,
      kernelNightRan,
    });
    return {
      localDate,
      eventCount: events.length,
      sourceRefs: refs,
      summary,
      dreamEventId: dreamEvent.eventId,
      compiledNeuronId: neuron.id,
      kernelNightRan,
      kernelNightSkippedReason,
    };
  }
}

function isDreamProduct(event: MemoryEvent): boolean {
  const metadata = (event.payload as { metadata?: { kind?: unknown } } | undefined)?.metadata;
  return metadata?.kind === 'dream-integration';
}

function dedupeRefs(events: MemoryEvent[]): MemorySourceRef[] {
  const seen = new Set<string>();
  const refs: MemorySourceRef[] = [];
  for (const event of events) {
    if (seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    refs.push({
      eventId: event.eventId,
      eventType: event.eventType,
      sourceId: event.sourceId,
      contentHash: event.contentHash,
      threadId: event.threadId,
      sessionId: event.sessionId,
      turnId: event.turnId,
      role: event.role,
      threadSeq: event.threadSeq,
      turnSeq: event.turnSeq,
      eventOrdinal: event.eventOrdinal,
    });
  }
  return refs;
}

function summarize(localDate: string, events: MemoryEvent[], nightNote?: string): string {
  const counts = { user: 0, assistant: 0, tool: 0, other: 0 };
  const topics: string[] = [];
  for (const event of events) {
    if (event.role === 'user') {
      counts.user += 1;
      const text = textOf(event);
      if (text && topics.length < 5) topics.push(text.replace(/\s+/gu, ' ').slice(0, 80));
    } else if (event.role === 'assistant') counts.assistant += 1;
    else if (event.role === 'tool') counts.tool += 1;
    else counts.other += 1;
  }
  const lines = [
    `夜间整合 ${localDate}：当日共 ${events.length} 条事件（用户 ${counts.user}、助手 ${counts.assistant}、工具 ${counts.tool}、其它 ${counts.other}）。`,
  ];
  if (topics.length > 0) lines.push(`当日谈到：\n- ${topics.join('\n- ')}`);
  if (nightNote) lines.push(`内核 dream 备注：${nightNote}`);
  return lines.join('\n');
}

function textOf(event: MemoryEvent): string {
  const text = (event.payload as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
}

/** The night integration as a plugin: DREAMING is a state, the integration is an installed ability. */
export function dreamPlugin(config: DreamPluginConfig): NativePlugin {
  return {
    name: 'dream',
    inject: ['kernel', 'memory', 'trace'],
    provide: ['dream'],
    apply(ctx) {
      const service = new DreamService({
        ...config,
        kernel: ctx.getService<MemoryKernel>('kernel'),
        backend: ctx.getService<KernelAgentMemoryBackend>('memory'),
        trace: ctx.getService<TraceLog>('trace'),
      });
      ctx.provide('dream', service);
    },
  };
}
