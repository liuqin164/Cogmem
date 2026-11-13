/**
 * Context accounting at the request boundary.
 *
 * Pi measures its live context with a chars/4 estimate and, when the provider reported one, anchors
 * on the last assistant usage, estimating only what came after it
 * (`core/compaction/compaction.js:110-135,201-252`). The shell keeps no usage on its messages and a
 * run assembles its context from scratch, so this is the from-scratch half of that estimate over
 * what the next request will actually carry: the system prompt, the tool declarations and the
 * messages. That number is what F14's budget controller will trim against and what the TUI's
 * context gauge reports, so it is measured where the request is built, not accumulated from events.
 *
 * This is a shell rule, not a Pi mechanism: Pi has no request-accounting hook, and its own estimate
 * omits tool schemas because the provider's usage already pays for them.
 */
import type { AgentMessage } from './agent-loop.ts';

/** Pi's conservative heuristic (`compaction.js:201`). Replace when a trim decision needs real counts. */
const CHARS_PER_TOKEN = 4;

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: unknown;
}

export interface ContextAccount {
  /** What the whole request carries, system prompt and tool schemas included. */
  totalTokens: number;
  systemTokens: number;
  toolTokens: number;
  messageTokens: number;
  /** How many messages the projection holds, for the trace to say what the number is made of. */
  messages: number;
  byRole: Record<AgentMessage['role'], number>;
}

/** Pi's `estimateTokens` for the shell's message shape: content, tool-call arguments, loadout deltas. */
export function estimateTokens(message: AgentMessage): number {
  let chars = message.content.length;
  for (const call of message.toolCalls ?? []) {
    chars += call.toolName.length + JSON.stringify(call.input ?? {}).length;
  }
  if (message.toolsAdded) chars += JSON.stringify(message.toolsAdded).length;
  if (message.toolsRemoved) chars += JSON.stringify(message.toolsRemoved).length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

export function estimateMessagesTokens(messages: readonly AgentMessage[]): number {
  let tokens = 0;
  for (const message of messages) tokens += estimateTokens(message);
  return tokens;
}

/** Pure: the request's parts, each measured the way the provider will be billed for it. */
export function accountRequest(input: {
  messages: readonly AgentMessage[];
  systemPrompt: string;
  tools: readonly ToolDeclaration[];
}): ContextAccount {
  const byRole: ContextAccount['byRole'] = { user: 0, assistant: 0, tool: 0, system: 0 };
  let messageTokens = 0;
  for (const message of input.messages) {
    const tokens = estimateTokens(message);
    messageTokens += tokens;
    byRole[message.role] += tokens;
  }
  const systemTokens = Math.ceil(input.systemPrompt.length / CHARS_PER_TOKEN);
  const toolTokens = input.tools.reduce(
    (sum, tool) => sum + Math.ceil(JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters }).length / CHARS_PER_TOKEN),
    0,
  );
  return {
    totalTokens: systemTokens + toolTokens + messageTokens,
    systemTokens,
    toolTokens,
    messageTokens,
    messages: input.messages.length,
    byRole,
  };
}
