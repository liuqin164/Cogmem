/**
 * The context projection: the run's transcript is an append-only log, and what the model sees is a
 * pure function of it.
 *
 * Removing something from the model's context is an appended `context_edit` entry pointing at the
 * target, never a deletion — Pi coding-agent's session projection (`ContextEditEntry`,
 * `buildSessionProjection`). The log keeps every turn for capture and audit, the same append-only
 * shape the kernel writes, and a later edit overrides an earlier one. A projected message whose
 * source entry cannot be found fails loudly rather than being dropped silently.
 */
import type { AgentMessage } from './agent-loop.ts';

export class UnpairedToolResultError extends Error {
  readonly code = 'unpaired_tool_result';
}

export class ProjectionTargetMissingError extends Error {
  readonly code = 'projection_target_missing';
}

export interface MessageEntry {
  id: number;
  type: 'message';
  message: AgentMessage;
}

export interface ContextEditEntry {
  id: number;
  type: 'context_edit';
  targetId: number;
  /** `null` omits the target from the projection; a message replaces it. */
  replacement: AgentMessage | null;
}

export type ContextEntry = MessageEntry | ContextEditEntry;

export class ContextProjection {
  private readonly entries: ContextEntry[] = [];
  private readonly edits = new Map<number, AgentMessage | null>();
  private nextId = 1;

  /** The append-only log, edits included; nothing is ever removed from it. */
  get log(): readonly ContextEntry[] {
    return this.entries;
  }

  append(message: AgentMessage): MessageEntry {
    const entry: MessageEntry = { id: this.nextId++, type: 'message', message };
    this.entries.push(entry);
    return entry;
  }

  /** A `context_edit`: `null` omits the target, a message replaces it. The last edit wins. */
  edit(targetId: number, replacement: AgentMessage | null): ContextEditEntry {
    if (!this.entries.some((entry) => entry.id === targetId)) {
      throw new ProjectionTargetMissingError(`projection_target_missing: ${targetId}`);
    }
    const entry: ContextEditEntry = { id: this.nextId++, type: 'context_edit', targetId, replacement };
    this.entries.push(entry);
    this.edits.set(targetId, replacement);
    return entry;
  }

  /**
   * Pi's `_omitRecoveryAttempt`: a failed attempt leaves the model's context together with all of its
   * tool results. An unpaired tool result makes the provider reject the next request, so the pairing
   * is this method's job, not the caller's.
   */
  omitFailedAttempt(targetId: number): number[] {
    const target = this.entries.find((entry) => entry.id === targetId);
    if (!target || target.type !== 'message') {
      throw new ProjectionTargetMissingError(`projection_target_missing: ${targetId}`);
    }
    const callIds = new Set((target.message.toolCalls ?? []).map((call) => call.toolCallId));
    const edited = [targetId];
    this.edit(targetId, null);
    for (const entry of this.entries) {
      if (entry.type !== 'message' || entry.message.role !== 'tool') continue;
      if (entry.message.toolCallId && callIds.has(entry.message.toolCallId)) {
        this.edit(entry.id, null);
        edited.push(entry.id);
      }
    }
    return edited;
  }

  /**
   * The oldest live assistant message that owns tool results, dropped with those results. Context
   * overflow recovery needs the context to actually shrink, and a call plus its results is the
   * smallest unit that can leave without an unpaired tool result behind. `undefined` when there is no
   * exchange left to drop.
   */
  omitOldestToolExchange(): number[] | undefined {
    const target = this.entries.find(
      (entry) => entry.type === 'message' && entry.message.role === 'assistant' && (entry.message.toolCalls?.length ?? 0) > 0 && !this.edits.has(entry.id),
    );
    return target ? this.omitFailedAttempt(target.id) : undefined;
  }

  /** Pure: the edit overlay applied to the log. A tool result whose call is gone is refused loudly. */
  project(): AgentMessage[] {
    const projected: AgentMessage[] = [];
    const liveCallIds = new Set<string>();
    for (const entry of this.entries) {
      if (entry.type !== 'message') continue;
      const replacement = this.edits.has(entry.id) ? this.edits.get(entry.id)! : entry.message;
      if (replacement === null) continue;
      if (replacement.role === 'assistant') for (const call of replacement.toolCalls ?? []) liveCallIds.add(call.toolCallId);
      projected.push(replacement);
    }
    for (const message of projected) {
      if (message.role === 'tool' && message.toolCallId && !liveCallIds.has(message.toolCallId)) {
        throw new UnpairedToolResultError(
          `unpaired_tool_result: "${message.toolName ?? 'tool'}" (${message.toolCallId}) has no tool call in the projection; the provider rejects it`,
        );
      }
    }
    return projected;
  }
}
