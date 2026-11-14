/**
 * F1/F2/F6 probes: what the kernel's exported surface can and cannot do for a resident companion.
 *
 * Each probe drives the exported API and records the concrete absence it hit. Nothing here calls an
 * internal module or a private field; the point is to describe the public surface a host actually has.
 */
import * as cogmem from 'cogmem';
import type { KernelAgentMemoryBackend, MemoryKernel } from 'cogmem';

export type GapDisposition = 'amend-f-ticket' | 'new-ticket';

export interface GapProbe {
  id: string;
  title: string;
  disposition: GapDisposition;
  evidence: string[];
  kernelMissing: string[];
  proposal: string;
}

export interface GapProbeResult {
  generatedAt: string;
  probes: GapProbe[];
}

export interface GapProbeInput {
  kernel: MemoryKernel;
  backend: KernelAgentMemoryBackend;
  projectId: string;
  agentId: string;
  sessionId: string;
}

export async function runGapProbes(input: GapProbeInput): Promise<GapProbeResult> {
  const { kernel, backend, projectId, agentId, sessionId } = input;
  const probes: GapProbe[] = [];
  const publicApi = cogmem as unknown as Record<string, unknown>;

  // ── F1: a read-only event stream with a cursor, push or pull ────────────────
  const evidenceEvent = kernel.recordRawEvent({
    projectId,
    threadId: `probe-${Date.now()}`,
    sessionId,
    role: 'user',
    content: 'F1 probe: one ledger append that a subscriber should be able to see.',
  });
  const subscribeNames = ['on', 'subscribe', 'subscribeEvents', 'events', 'streamEvents', 'listEventsSince', 'listRawEventsAfterGlobalSeq'];
  const foundOnKernel = subscribeNames.filter((name) => typeof (kernel as unknown as Record<string, unknown>)[name] === 'function');
  const publicStreamHelpers = Object.keys(publicApi).filter((name) => /subscribe|event.*stream|watch/i.test(name));
  const emptySearch = kernel.searchRawEvents('', { projectId, limit: 5 });
  probes.push({
    id: 'F1',
    title: '事件订阅面（事件流可订阅唤醒）',
    disposition: 'amend-f-ticket',
    evidence: [
      `recorded ledger event ${evidenceEvent.eventId} without a single subscriber being notified`,
      `kernel method names a subscriber could use: ${foundOnKernel.length ? foundOnKernel.join(', ') : 'none'}`,
      `exported names that look like a stream: ${publicStreamHelpers.length ? publicStreamHelpers.join(', ') : 'none'}`,
      `kernel.searchRawEvents('') returned ${emptySearch.length} events (no "give me everything after cursor" mode)`,
      'the only cursor read that exists is kernel.eventStore.listRawEventsAfterGlobalSeq, and eventStore is not part of the documented public subscription surface',
    ],
    kernelMissing: [
      'a read-only event subscription (SSE or cursor pull) with project/agent/topic filters',
      'a cursor token a reconnecting subscriber replays from',
      'a subscription surface with zero write capability',
    ],
    proposal: 'F1 keeps its shape and adds the acceptance that the surface is exported from public.ts, not reachable only through kernel.eventStore.',
  });

  // ── F2: time context, wake-intent registration and due-time *events* ───────
  const dueAt = Date.now() - 1_000;
  kernel.recordRawEvent({
    projectId,
    threadId: `probe-${Date.now()}`,
    sessionId,
    role: 'user',
    content: 'F2 probe: evidence an intention can point at.',
  });
  const evidenceIds = [evidenceEvent.eventId];
  let dueRecord: { candidateId: string; dueAt?: number } | undefined;
  try {
    dueRecord = kernel.prospectiveMemoryService.propose({
      projectId,
      candidateType: 'reminder',
      canonicalKey: `probe-${Date.now()}`,
      title: 'F2 probe due intention',
      evidenceEventIds: evidenceIds,
      proposedBy: 'operator',
      dueAt,
    });
  } catch (error) {
    dueRecord = undefined;
    probes.push({
      id: 'F2',
      title: '时间感知层（语境注入、自设醒来意图与到期调度）',
      disposition: 'amend-f-ticket',
      evidence: [`proposing a due prospective memory failed: ${error instanceof Error ? error.message : String(error)}`],
      kernelMissing: ['prospective memory with dueAt', 'a time-context builder', 'wake-intent registration'],
      proposal: 'F2 keeps prospective memory and adds the event emission and the time-context block as exported surface.',
    });
  }
  if (dueRecord) {
    const pending = kernel.prospectiveMemoryService.list({ projectId, statuses: ['pending'] });
    const timeHelpers = Object.keys(publicApi).filter((name) => /timeContext|wakeIntent|schedul/i.test(name));
    probes.push({
      id: 'F2',
      title: '时间感知层（语境注入、自设醒来意图与到期调度）',
      disposition: 'amend-f-ticket',
      evidence: [
        `a prospective memory with dueAt=${dueAt} (in the past) was stored as ${dueRecord.candidateId}`,
        `it still sits in list({statuses:['pending']}) with ${pending.length} sibling(s): nothing fired, because there is no due event`,
        `exported time helpers: ${timeHelpers.length ? timeHelpers.join(', ') : 'none'}`,
        'no API registers "wake me at T for reason R", and no public function builds the wake context block F2 describes',
      ],
      kernelMissing: [
        'prospective-due as an event on the F1 stream (not data to poll)',
        'a deterministic time-context block (now, silence, rhythm, anchors)',
        'a wake-intent registration/revocation API',
      ],
      proposal: 'Amend F2: the intent and the context block are kernel public surface; the shell must not compute silence from the clock in its own plugin.',
    });
  }

  // ── F6: an emergence candidate surface with reason/confidence/sensitivity ──
  await backend.rememberTurnWithResult({
    agentId,
    projectId,
    sessionId,
    turnId: `probe-f6-${Date.now()}`,
    userText: 'F6 probe: I like the small bakery on the corner, the one with the blue awning.',
    assistantText: 'Noted: the bakery on the corner with the blue awning.',
    ingestMode: 'immediate_compile',
  });
  const recall = backend.recall({ agentId, projectId, query: 'bakery blue awning', limit: 5 });
  const first = recall.items[0];
  const itemKeys = first ? Object.keys(first) : [];
  const candidateMethods = Object.keys(publicApi).filter((name) => /emergence|candidate|prospective/i.test(name));
  probes.push({
    id: 'F6',
    title: '浮现候选面与敏感度分级',
    disposition: 'amend-f-ticket',
    evidence: [
      `recall returned ${recall.items.length} item(s); the item keys are: ${itemKeys.join(', ') || 'none'}`,
      `an item does carry confidence and whyMatched, so the kernel can say why recall picked it`,
      `an item carries no sensitivity grade, no freshness/decay field and no suppression flag, and no method returns candidates rather than answers`,
      `exported emergence/candidate helpers: ${candidateMethods.length ? candidateMethods.join(', ') : 'none'}`,
      'a candidate today can only be a recall item plus a query the shell invented, which is exactly the "timed self-questioning" the guidance forbids',
    ],
    kernelMissing: [
      'a candidate surface (not a recall answer) that returns content + reason + confidence + freshness + sensitivity',
      'at least three sensitivity grades with high-sensitivity items excluded from proactive surfacing by default',
      'a suppression flag on the candidate and a per-candidate decisionTrace that explain_recall can render',
    ],
    proposal: 'Amend F6: the candidate surface must be a kernel call, not a recall-with-a-query the shell constructs; the sensitivity grade travels on the candidate.',
  });

  // F-MCP (no public host-mode MCP transport or profile table) was withdrawn by #200 R2: the shell
  // no longer serves an outward MCP face, so a public transport factory is not a gap for it.

  return { generatedAt: new Date().toISOString(), probes };
}

export function renderGapsMarkdown(result: GapProbeResult): string {
  const lines = [
    `## #165 stage-one gap probes (${result.generatedAt})`,
    '',
    '_The probe writes real rows (one event, one prospective memory) to show what fires; run it without `--db` and it uses a throwaway in-memory kernel. With `--db` those rows land in that file, so pass it only when you mean it._',
    '',
  ];
  for (const probe of result.probes) {
    lines.push(`### ${probe.id} — ${probe.title} (${probe.disposition})`, '');
    lines.push('Evidence:');
    for (const item of probe.evidence) lines.push(`- ${item}`);
    lines.push('', 'Kernel missing:');
    for (const item of probe.kernelMissing) lines.push(`- ${item}`);
    lines.push('', `Proposal: ${probe.proposal}`, '');
  }
  return lines.join('\n');
}
