/**
 * The inner loop: Pi's turn lifecycle, event names and hook positions reused verbatim.
 *
 * A Pi extension that subscribes to `turn_end` or vetoes in `tool_call` sees the same points here.
 * The loop's contract is Pi 1.5.0's turn-boundary triad — `prepareRequest` before every provider
 * request, `finishTurn` for the turn decision, `prepareNextTurn` at the turn boundary — not the
 * earlier `shouldStopAfterTurn` sketch. What is new is only around it: the steering and follow-up
 * queues are native (guidance §一), and the run leaves through this loop's return value so the outer
 * state machine owns the lifecycle.
 */
import type { EventBus } from '../bus.ts';
import type { TraceLog } from '../trace.ts';
import { ContextProjection } from './projection.ts';
import { accountRequest, type ContextAccount } from './context-budget.ts';
import { DEFAULT_RETRY_POLICY, planFailure, sleepAbortable, type RetryPolicy } from './retry.ts';

/**
 * The message a boundary hook's failure leaves on the bus result, or `undefined` when no handler
 * threw. `agent_end`/`agent_settled` are the only events whose failure is the run's own verdict.
 */
function hookFailure(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !(result as { hookFailed?: boolean }).hookFailed) return undefined;
  return String((result as { reason?: unknown }).reason ?? 'hook failed');
}

export interface AgentMessage {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
  /** Pi's tool-loadout declaration: names this message adds to the executable set. */
  toolsAdded?: string[];
  /** Pi's tool-loadout declaration: names this message removes from the executable set. */
  toolsRemoved?: string[];
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export interface ToolResult {
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
  blocked?: { reason: string };
}

/**
 * What the provider itself reported for one request (#165 round 21). Every field is optional and
 * present only when the provider sent it: a field it did not report stays absent, never zero. An
 * absent number and a reported zero are different facts, and the trace this feeds has to keep them
 * apart. Round 17's request-side estimate (`context-budget.ts`) is a separate number and never fills
 * these slots.
 */
export interface TurnUsage {
  /**
   * The prompt as the provider counts it (OpenAI `prompt_tokens`), cached tokens included. Pi nets
   * the cache out of `input` (`pi-ai/dist/api/openai-completions.js:1171`); the shell keeps the raw
   * prompt count so the run's charged total does not shrink on a cache hit, and so the hit ratio uses
   * the same denominator Pi's display does: the whole prompt.
   */
  input?: number;
  output?: number;
  /** Prompt tokens served from the provider's cache: `prompt_cache_hit_tokens` / `cached_tokens`. */
  cacheHit?: number;
  /** Prompt tokens that missed the cache (`prompt_cache_miss_tokens`); DeepSeek reports it, OpenAI does not. */
  cacheMiss?: number;
}

export interface ModelTurn {
  text: string;
  toolCalls: ToolCall[];
  usage?: TurnUsage;
  /**
   * Pi's `AssistantMessage.stopReason`, narrowed to what the loop acts on. `length` means the output
   * was cut off by the token limit, so tool-call arguments may have been silently truncated even
   * when they parse (Pi agent-loop's `failToolCallsFromTruncatedMessage`).
   */
  stopReason?: 'stop' | 'length' | 'error' | 'aborted';
  error?: string;
}

export interface ModelCompletionInput {
  messages: AgentMessage[];
  tools: Array<{ name: string; description: string; parameters: unknown; source: string }>;
  systemPrompt: string;
  model: string;
  signal: AbortSignal;
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  complete(input: ModelCompletionInput): Promise<ModelTurn>;
}

/** What a tool's `execute` sees: the run, the abort signal, and Pi's `runToolCall` when it nests. */
export interface ToolInvocationContext {
  runId: string;
  signal: AbortSignal;
  /** A call to another tool through the same hooks the model's calls take (cage included). */
  runToolCall?(name: string, input: unknown): Promise<ToolResult>;
}

export interface ToolInvoker {
  list(): Array<{ name: string; description: string; parameters: unknown; source: string }>;
  invoke(name: string, call: ToolCall, ctx: ToolInvocationContext): Promise<ToolResult>;
}

export interface ToolCallPipelineContext {
  bus: EventBus;
  tools: ToolInvoker;
  trace?: TraceLog;
  clock: () => number;
  runId: string;
  signal: AbortSignal;
}

export interface ExecutedToolCall {
  result: ToolResult;
  terminate: boolean;
}

const MAX_NESTED_TOOL_DEPTH = 8;

async function emitToolStart(context: ToolCallPipelineContext, call: ToolCall): Promise<void> {
  await context.bus.emit('tool_execution_start', { type: 'tool_execution_start', toolCallId: call.toolCallId, toolName: call.toolName, input: call.input }, { runId: context.runId });
}

async function emitToolEnd(context: ToolCallPipelineContext, call: ToolCall, result: ToolResult): Promise<void> {
  await context.bus.emit('tool_execution_end', { type: 'tool_execution_end', toolCallId: call.toolCallId, toolName: call.toolName, result, isError: result.isError }, { runId: context.runId });
}

/**
 * Pi's `failToolCallsFromTruncatedMessage`: in a `length`-truncated message every call becomes an
 * error the model can read and correct. `beforeToolCall` does not run because nothing executes, but
 * the start/end pair is still emitted so capture records the call and its refusal.
 */
export async function refuseTruncatedCall(context: ToolCallPipelineContext, call: ToolCall): Promise<ToolResult> {
  await emitToolStart(context, call);
  const result: ToolResult = {
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    output: `tool_not_executed: "${call.toolName}" was not executed because the response hit the output token limit, so its arguments may be truncated. Re-issue the call with complete arguments.`,
    isError: true,
  };
  await emitToolEnd(context, call, result);
  return result;
}

/**
 * One tool call through the same steps whether the model or another tool issued it: `beforeToolCall`
 * (where the cage's whitelist lives), execution, `afterToolCall`.
 *
 * A nested call emits no events and adds no messages — Pi's `runToolCall` contract — but it does pass
 * the hooks, which is what stops a tool from side-stepping the cage by calling a sibling directly.
 */
export async function executeToolCall(
  context: ToolCallPipelineContext,
  call: ToolCall,
  options: { emitEvents: boolean; depth?: number } = { emitEvents: true },
): Promise<ExecutedToolCall> {
  const depth = options.depth ?? 0;
  // Pi emits `tool_execution_start` before `prepareToolCall` — that is, before argument validation
  // and `beforeToolCall` — so every call the model issued pairs, blocked and failed ones included
  // (`agent-loop.js:380-390,419-426`). The end alone left the ledger an observation with no call,
  // the mirror of the dangling pair round 15 closed. The hooks also live inside this try because Pi
  // turns a throwing `beforeToolCall` into that call's error result (`:539-545`); outside it, the
  // throw would escape with a start and no end.
  if (options.emitEvents) await emitToolStart(context, call);
  let result: ToolResult;
  let terminate = false;
  try {
    const before = await context.bus.emit('beforeToolCall', {
      type: 'beforeToolCall',
      toolCall: call,
      toolCallId: call.toolCallId,
      toolName: call.toolName,
      input: call.input,
    }, { runId: context.runId });
    if (before?.block) {
      result = { toolCallId: call.toolCallId, toolName: call.toolName, output: before.reason ?? 'blocked', isError: true, blocked: { reason: before.reason ?? 'blocked' } };
      // Pi's blocked result honors `terminate` too, so a veto can also end the batch (`:513-522`).
      terminate = before.terminate === true;
      context.trace?.append('tool_blocked', { runId: context.runId, toolName: call.toolName, reason: before.reason, nested: !options.emitEvents }, context.clock());
    } else {
      const nest = async (name: string, input: unknown): Promise<ToolResult> => {
        if (depth >= MAX_NESTED_TOOL_DEPTH) {
          return { toolCallId: `${call.toolCallId}:${name}`, toolName: name, output: `nested_tool_depth_exceeded: "${name}" is nested more than ${MAX_NESTED_TOOL_DEPTH} deep`, isError: true };
        }
        const nested = await executeToolCall(context, { toolCallId: `${call.toolCallId}:${depth + 1}:${name}`, toolName: name, input }, { emitEvents: false, depth: depth + 1 });
        return nested.result;
      };
      result = await context.tools.invoke(call.toolName, call, { runId: context.runId, signal: context.signal, runToolCall: nest });
      const after = await context.bus.emit('afterToolCall', { type: 'afterToolCall', tool: call, result }, { runId: context.runId });
      if (after && typeof after === 'object' && 'result' in after) result = after.result as ToolResult;
      terminate = Boolean(after && typeof after === 'object' && 'terminate' in after && after.terminate);
    }
  } catch (caught) {
    // Pi's `executePreparedToolCall`/`finalizeExecutedToolCall`: a thrown failure is an error result,
    // never an escaped rejection. Without this a rejecting invoker skipped `tool_execution_end`, so the
    // ledger's call had no observation and the checkpoint's in-flight entry stuck until the next
    // recovery — the dangling pair the interrupt audit went looking for.
    const message = caught instanceof Error ? caught.message : String(caught);
    result = { toolCallId: call.toolCallId, toolName: call.toolName, output: `tool_call_failed: ${message}`, isError: true };
    context.trace?.append('tool_call_failed', { runId: context.runId, toolName: call.toolName, message, nested: !options.emitEvents }, context.clock());
  }
  if (options.emitEvents) await emitToolEnd(context, call, result);
  return { result, terminate };
}

export interface RunBudget {
  checkTurn(turnIndex: number): { exceeded: boolean; reason?: string };
  addTokens(tokens: number): { exceeded: boolean; reason?: string };
}

/** Pi's `AgentTurnContext`: the completed turn handed to the boundary hooks. */
export interface TurnContext {
  turnIndex: number;
  message: AgentMessage;
  toolResults: ToolResult[];
}

/**
 * Pi's `AgentTurnDecision`. `end` stops without polling the queues; `continue` guarantees one more
 * request — satisfied by tool results, steering or follow-ups when any are pending, and otherwise by
 * one context-only turn.
 */
export type TurnDecision = { action: 'end' | 'continue' } | void;

/**
 * Pi's `AgentLoopTurnUpdate`, narrowed to what this shell's `prepareNextTurn` applies: messages to
 * append before the next request. Pi also lets it replace the model and thinking level; the shell has
 * one mg provider and no thinking-level concept, so those fields are deliberately absent rather than
 * declared and ignored.
 */
export interface TurnUpdate {
  messages?: AgentMessage[];
}

/** Pi's `AgentRequestUpdate`: replacement request state, applied at `prepareRequest` (polls no queues). */
export interface RequestUpdate {
  messages?: AgentMessage[];
  tools?: Array<{ name: string; description: string; parameters: unknown; source: string }>;
  systemPrompt?: string;
  model?: string;
}

export interface RunSummary {
  runId: string;
  sessionId: string;
  turnId: string;
  userText: string;
  assistantText: string;
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  turns: number;
  tokens: number;
  stopReason: 'run_complete' | 'run_aborted' | 'run_error' | 'budget_exceeded';
  error?: string;
}

export interface AgentRuntimeOptions {
  bus: EventBus;
  tools: ToolInvoker;
  provider: ModelProvider;
  budget: RunBudget;
  systemPrompt: () => string;
  /**
   * The prompt is durable before the model call (Pi #10000's requirement). The callback owns
   * redaction and the log, so a crash cannot leave only the checkpoint's 500-char display copy.
   */
  onPrompt?: (prompt: { runId: string; sessionId: string; text: string }) => void;
  trace?: TraceLog;
  clock?: () => number;
  /** The failure ladder's budget (Pi's `RetrySettings`); defaults to the mg gateway's real one. */
  retry?: RetryPolicy;
  /** Injectable backoff sleep, so a test never waits a real second. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /**
   * Called when a tool-loadout declaration lands in the transcript (Pi's `declareToolChanges`), so
   * the checkpoint can record the declared set; recovery compares it against the executable set.
   */
  onToolsDeclared?: (names: string[]) => void;
  /**
   * The queues as the checkpoint left them (#210). A killed run's typed lines are state, so the next
   * start drains them in order instead of losing them with the process.
   */
  initialQueues?: { steering?: readonly string[]; followUps?: readonly string[] };
  /** Called on every queue change so the checkpoint can hold it; a failed write stays loud. */
  onQueueChange?: (queues: { steering: readonly string[]; followUps: readonly string[] }) => void;
  /**
   * The request as it will be sent, measured (`context-budget.ts`). Measured here, after the last
   * projection, is the only place the number is true: `transformContext` may have injected a block
   * no message event carries, and the system prompt and tool schemas are part of the request too.
   * The trace keeps the breakdown, so a later compaction can be read against what it replaced.
   */
  onContextAssembled?: (account: ContextAccount) => void;
}

export class AgentRuntime {
  private steering: string[] = [];
  private followUps: string[] = [];
  private running = false;
  private abortController?: AbortController;
  private readonly clock: () => number;
  /** The overflow recovery latch: one attempt per run, so a persistently oversized context cannot loop. */
  private overflowRecoveryUsed = false;
  /**
   * What the transcript last declared the tool loadout to be. It survives across runs, so a hot-plug
   * that happened while the shell was idle is declared on the next run's first request.
   */
  private declaredTools?: Set<string>;

  constructor(private readonly options: AgentRuntimeOptions) {
    this.clock = options.clock ?? Date.now;
    this.steering = [...(options.initialQueues?.steering ?? [])];
    this.followUps = [...(options.initialQueues?.followUps ?? [])];
  }

  get isRunning(): boolean {
    return this.running;
  }

  get pendingMessages(): number {
    return this.steering.length + this.followUps.length;
  }

  /** RUNNING steer: injected after the current tool batch, before the next turn. */
  steer(text: string): void {
    this.steering.push(text);
    this.persistQueues();
  }

  /** Follow-up: injected only when the loop would otherwise end. */
  followUp(text: string): void {
    this.followUps.push(text);
    this.persistQueues();
  }

  /** The steering queue as the view shows it; FIFO, so the newest is last. */
  get steeringMessages(): readonly string[] {
    return this.steering;
  }

  /**
   * Withdraw the newest not-yet-injected steer. The queue is drained at the turn boundary, so an item
   * pulled here is one the model has certainly not seen.
   */
  withdrawSteering(): string | undefined {
    const withdrawn = this.steering.pop();
    if (withdrawn !== undefined) this.persistQueues();
    return withdrawn;
  }

  /**
   * Every queue change lands in the checkpoint, under the same atomic-publish discipline as a
   * transition (#210). A failed write throws: the caller hears it, the machine halts, and no line is
   * silently remembered only in this process.
   */
  private persistQueues(): void {
    this.options.onQueueChange?.({ steering: [...this.steering], followUps: [...this.followUps] });
  }

  abort(reason = 'aborted'): void {
    this.options.trace?.append('run_abort_requested', { reason }, this.clock());
    this.abortController?.abort();
  }

  async run(input: { runId: string; sessionId: string; userText: string; signal?: AbortSignal }): Promise<RunSummary> {
    if (this.running) throw new Error('agent_already_running: at most one RUNNING state exists');
    this.running = true;
    // Pi #10000: the prompt is durable before the model call. The callback redacts and writes the
    // session log, so an interrupted run keeps its whole prompt and not only the display copy.
    this.options.onPrompt?.({ runId: input.runId, sessionId: input.sessionId, text: input.userText });
    this.overflowRecoveryUsed = false;
    const controller = new AbortController();
    this.abortController = controller;
    const signal = input.signal
      ? AbortSignal.any([input.signal, controller.signal])
      : controller.signal;
    const context = new ContextProjection();
    const allToolCalls: ToolCall[] = [];
    const allToolResults: ToolResult[] = [];
    let turns = 0;
    let tokens = 0;
    let stopReason: RunSummary['stopReason'] = 'run_complete';
    let error: string | undefined;
    const turnId = `${input.runId}:0`;
    const userMessage: AgentMessage = { role: 'user', content: input.userText };
    context.append(userMessage);
    // Pi fires before_agent_start before agent_start; an extension may hand back one injected message
    // (the shape the Cogmem pi extension uses for recall context).
    const beforeStart = await this.options.bus.emit('before_agent_start', {
      type: 'before_agent_start',
      prompt: input.userText,
      messageType: 'user',
    }, { runId: input.runId });
    const injected = (beforeStart as { message?: { content?: unknown } } | undefined)?.message;
    if (injected && injected.content !== undefined) {
      context.append({ role: 'system', content: typeof injected.content === 'string' ? injected.content : JSON.stringify(injected.content) });
    }
    await this.options.bus.emit('agent_start', { type: 'agent_start', runId: input.runId, messages: context.project() }, { runId: input.runId });
    await this.emitUserMessage(userMessage, input.runId);

    try {
      for (;;) {
        if (signal.aborted) {
          stopReason = 'run_aborted';
          break;
        }
        const turnIndex = turns + 1;
        const budgetCheck = this.options.budget.checkTurn(turnIndex);
        if (budgetCheck.exceeded) {
          stopReason = 'budget_exceeded';
          error = budgetCheck.reason;
          // The budget owns the `cage_violation` record; the loop only obeys the verdict.
          break;
        }
        turns = turnIndex;
        await this.options.bus.emit('turn_start', { type: 'turn_start', turnIndex }, { runId: input.runId });

        let assistantDraft: AgentMessage = { role: 'assistant', content: '' };
        let terminateRequested = false;
        // Pi's `prepareRequest`: the last assembly gate before every request, including the first.
        // `transformContext` still owns the message pipeline; this hook owns the request's shape
        // (system prompt, model, tool list) and polls no queues.
        const requestSeed: RequestUpdate & { messages: AgentMessage[]; systemPrompt: string; model: string } = {
          messages: context.project(),
          tools: this.options.tools.list(),
          systemPrompt: this.options.systemPrompt(),
          model: this.options.provider.model,
        };
        const requestUpdate = (await this.options.bus.pipeline('prepareRequest', requestSeed, { runId: input.runId, turnIndex })) as RequestUpdate | undefined;
        const request = requestUpdate && typeof requestUpdate === 'object' ? { ...requestSeed, ...requestUpdate } : requestSeed;
        // A `prepareRequest` handler may replace the message list for this turn; otherwise the model
        // sees the live projection, re-read on every attempt so an omitted failed attempt is gone.
        // `pipeline` returns the seed object when no handler ran, so identity — not truthiness — says
        // whether a handler really replaced the list.
        const handlerMessages = requestUpdate?.messages !== requestSeed.messages ? requestUpdate?.messages : undefined;

        // Pi's `declareToolChanges`: the transcript says what the model may call, and the difference
        // from the executable set becomes `toolsAdded`/`toolsRemoved` on a system message before the
        // request. The first run sets the baseline silently; a hot-plug is what produces a delta.
        const executableTools = (request.tools ?? this.options.tools.list()).map((tool) => tool.name);
        if (!this.declaredTools) this.declaredTools = new Set(executableTools);
        const added = executableTools.filter((name) => !this.declaredTools!.has(name));
        const removed = [...this.declaredTools].filter((name) => !executableTools.includes(name));
        if (added.length > 0 || removed.length > 0) {
          // Empty lists omit the field (Pi's `withToolChanges`), so a declaration is `toolsAdded`
          // only when something was added.
          const declaration: AgentMessage = {
            role: 'system',
            content: '',
            ...(added.length > 0 ? { toolsAdded: added } : {}),
            ...(removed.length > 0 ? { toolsRemoved: removed } : {}),
          };
          context.append(declaration);
          await this.options.bus.emit('message_start', { type: 'message_start', message: declaration }, { runId: input.runId });
          await this.options.bus.emit('message_end', { type: 'message_end', message: declaration }, { runId: input.runId });
          this.declaredTools = new Set(executableTools);
          this.options.trace?.append('tools_declared', { runId: input.runId, turnIndex, toolsAdded: added, toolsRemoved: removed }, this.clock());
          this.options.onToolsDeclared?.(executableTools);
        }
        const policy = this.options.retry ?? DEFAULT_RETRY_POLICY;

        // The failure ladder runs inside the turn: a retry re-requests the same turn, so `turns` — and
        // therefore the cage's turn budget — is charged once however many provider calls it took.
        let turn: ModelTurn = { text: '', toolCalls: [] };
        let failedReason: string | undefined;
        let abortedReason: string | undefined;
        let lastDraft: AgentMessage = assistantDraft;
        for (let attempt = 0; ; ) {
          const draft: AgentMessage = { role: 'assistant', content: '' };
          const attemptMessages = await this.projectMessages(handlerMessages ?? context.project(), input.runId);
          // The request is measured once it is final: after `transformContext`, so a block it injected
          // (the recall context) is part of the number instead of invisible to it.
          const account = accountRequest({ messages: attemptMessages, systemPrompt: request.systemPrompt, tools: request.tools ?? this.options.tools.list() });
          this.options.onContextAssembled?.(account);
          this.options.trace?.append('context_assembled', { runId: input.runId, turnIndex, attempt, ...account }, this.clock());
          await this.options.bus.emit('message_start', { type: 'message_start', message: draft }, { runId: input.runId });
          try {
            turn = await this.options.provider.complete({
              // A copy, so each attempt sees the context as of that call. Handing the live array over
              // let a provider that keeps its input (and this suite's scripted provider) observe
              // messages pushed after the call — steering a later turn consumed looked already sent.
              messages: [...attemptMessages],
              tools: request.tools ?? this.options.tools.list(),
              systemPrompt: request.systemPrompt,
              model: request.model,
              signal,
            });
          } catch (caught) {
            // A thrown transport failure is the same failure as a provider that reports one in its
            // turn; normalize it so one ladder classifies both. An abort is not a failure to
            // classify: it is terminal, and it must keep reporting run_aborted whether it surfaced as
            // a throw, a signal that fired, or a provider turn that says so.
            turn = {
              text: '',
              toolCalls: [],
              stopReason: signal.aborted ? 'aborted' : 'error',
              error: caught instanceof Error ? caught.message : String(caught),
            };
          }
          draft.content = turn.text;
          draft.toolCalls = turn.toolCalls;
          draft.isError = turn.stopReason === 'error';
          // The provider's own account, next to `context_assembled`'s estimate (#165 round 21). The two
          // pair by runId/turnIndex/attempt and are never added together: one is what the provider
          // charged, the other is what the shell measured. A response that carried no usage leaves no
          // record — a zero-filled one would read as a real measurement of zero.
          if (turn.usage) this.options.trace?.append('provider_usage', { runId: input.runId, turnIndex, attempt, ...turn.usage }, this.clock());
          await this.options.bus.emit('message_update', { type: 'message_update', message: draft, delta: turn.text }, { runId: input.runId });
          await this.options.bus.emit('message_end', { type: 'message_end', message: draft }, { runId: input.runId });
          const failedEntry = context.append(draft);
          lastDraft = draft;
          if (turn.stopReason !== 'error' && turn.stopReason !== 'aborted') {
            assistantDraft = draft;
            break;
          }
          if (turn.stopReason === 'aborted' || signal.aborted) {
            // Pi's `retryAssistantCall` never retries an abort; it is a hard exit. `signal.aborted`
            // wins over the error text so an abort cannot be read as a transient failure.
            abortedReason = turn.error ?? 'aborted';
            break;
          }
          const plan = planFailure({ message: turn.error ?? 'provider_error', attempt, policy, overflowRecoveryUsed: this.overflowRecoveryUsed });
          this.options.trace?.append('provider_call_failed', {
            runId: input.runId,
            turnIndex,
            kind: plan.kind,
            next: plan.action,
            attempt: plan.action === 'fail' ? attempt : plan.attempt,
            delayMs: plan.action === 'fail' ? 0 : plan.delayMs,
            message: turn.error,
          }, this.clock());
          if (plan.action === 'fail') {
            failedReason = plan.reason;
            break;
          }
          if (plan.action === 'recover_overflow') {
            this.overflowRecoveryUsed = true;
            // Without a compaction subsystem the only way to make an overflow recoverable is for the
            // context to actually shrink, so drop the oldest call-plus-results exchange. Nothing to
            // drop means the recovery is unavailable: fail, rather than re-send the same bytes and
            // call it a recovery.
            const trimmed = context.omitOldestToolExchange();
            this.options.trace?.append('overflow_recovery', { runId: input.runId, turnIndex, trimmed: trimmed ?? null }, this.clock());
            if (!trimmed) {
              failedReason = `overflow_recovery_unavailable: no exchange left to omit — ${turn.error ?? "context overflow"}`;
              break;
            }
          }
          // The failed attempt leaves the model's context together with any tool results it owns, but
          // stays in the log: Pi's `_omitRecoveryAttempt` applied as a `context_edit`. An unpaired
          // tool result would make the provider reject the retry, so the pairing is the projection's.
          const omitted = context.omitFailedAttempt(failedEntry.id);
          this.options.trace?.append('recovery_attempt_omitted', { runId: input.runId, turnIndex, targetId: failedEntry.id, omitted }, this.clock());
          attempt = plan.attempt;
          if (plan.delayMs > 0) await (this.options.sleep ?? sleepAbortable)(plan.delayMs, signal);
        }
        if (failedReason !== undefined || abortedReason !== undefined) {
          stopReason = abortedReason !== undefined ? 'run_aborted' : 'run_error';
          error = abortedReason ?? failedReason;
          // Pi runs finishTurn and emits turn_end for an error or aborted turn too: the turn did
          // complete, it just did not succeed, and a hook is entitled to see it.
          const failedTurn: TurnContext = { turnIndex, message: lastDraft, toolResults: [] };
          await this.options.bus.emit('finishTurn', { type: 'finishTurn', ...failedTurn }, { runId: input.runId });
          await this.options.bus.emit('turn_end', { type: 'turn_end', ...failedTurn }, { runId: input.runId });
          break;
        }

        const toolResults: ToolResult[] = [];
        // Pi: a `length` stop means every tool call in the message may carry truncated arguments —
        // the streamed JSON is finalized by a best-effort salvage parser, so a call can parse and
        // validate while being incomplete. None of them are safe to execute; fail the whole batch
        // and let the model re-issue, rather than run a call with half its arguments.
        const truncated = turn.stopReason === 'length';
        if (truncated) {
          this.options.trace?.append('tool_batch_truncated', { runId: input.runId, turnIndex, toolCalls: turn.toolCalls.map((call) => call.toolName) }, this.clock());
        }
        const pipeline: ToolCallPipelineContext = {
          bus: this.options.bus,
          tools: this.options.tools,
          trace: this.options.trace,
          clock: this.clock,
          runId: input.runId,
          signal,
        };
        const batchTerminates: boolean[] = [];
        for (const call of turn.toolCalls) {
          allToolCalls.push(call);
          if (truncated) {
            const refused = await refuseTruncatedCall(pipeline, call);
            toolResults.push(refused);
            allToolResults.push(refused);
            continue;
          }
          // The same pipeline a nested `runToolCall` takes, so the cage sees both.
          const executed = await executeToolCall(pipeline, call);
          batchTerminates.push(executed.terminate);
          toolResults.push(executed.result);
          allToolResults.push(executed.result);
        }
        // Pi's `shouldTerminateToolBatch` (`agent-loop.js:471-473`): early termination is a property
        // of the whole batch — a rejected call ends the run only when every result asked to stop,
        // because the model asked for the others too. A truncated batch is all refusals and never
        // terminates, so the model still gets to re-issue.
        if (batchTerminates.length > 0 && batchTerminates.every(Boolean)) terminateRequested = true;
        // Pi appends one tool message per result before the next provider call; without this the model
        // never sees what its own tool returned.
        for (const toolResult of toolResults) {
          context.append({
            role: 'tool',
            content: toolResult.output,
            toolCallId: toolResult.toolCallId,
            toolName: toolResult.toolName,
            isError: toolResult.isError,
          });
        }
        // Pi's `finishTurn`: after the assistant message and every tool result are in context, and
        // before `turn_end`. `end` stops without polling the queues; `continue` guarantees one more
        // request. Error and abort remain hard exits (they leave through the `catch`).
        const completedTurn: TurnContext = { turnIndex, message: assistantDraft, toolResults };
        const decision = (await this.options.bus.emit(
          'finishTurn',
          { type: 'finishTurn', ...completedTurn },
          { runId: input.runId },
        )) as TurnDecision;
        await this.options.bus.emit('turn_end', { type: 'turn_end', turnIndex, message: assistantDraft, toolResults }, { runId: input.runId });

        if (turn.usage) {
          const tokenTotal = (turn.usage.input ?? 0) + (turn.usage.output ?? 0);
          tokens += tokenTotal;
          // The cage owns the verdict; this event only tells the view where the running total is, so
          // the budget bars move while the run is still going rather than only at the boundary. The
          // provider's cache split rides along so the status face can show it without re-reading the
          // trace (#165 round 21).
          await this.options.bus.emit('turn_usage', { type: 'turn_usage', runId: input.runId, turnIndex, tokens: tokenTotal, totalTokens: tokens, usage: turn.usage }, { runId: input.runId });
          const tokenCheck = this.options.budget.addTokens(tokenTotal);
          if (tokenCheck.exceeded) {
            stopReason = 'budget_exceeded';
            error = tokenCheck.reason;
            break;
          }
        }

        if (terminateRequested || decision?.action === 'end') {
          stopReason = 'run_complete';
          break;
        }

        const steeringPending = this.steering.length > 0;
        const followUpPending = this.followUps.length > 0;
        const explicitContinue = decision?.action === 'continue';
        if (turn.toolCalls.length === 0 && !steeringPending && !followUpPending && !explicitContinue) break;

        // Pi's `prepareNextTurn`: after `turn_end` and before the next turn begins — the formal turn
        // boundary (compaction is its canonical Pi user; here it is also where the steering boundary
        // is settled). A long handler may take new steering while it runs, so the queue is read again
        // after it: the re-poll is what keeps a line typed during a long prepare from being dropped,
        // and it is the reason a steering message's own turn gets a fresh recall (guidance #7) — the
        // next request runs `transformContext` against that new last user line.
        const prepared = (await this.options.bus.emit(
          'prepareNextTurn',
          { type: 'prepareNextTurn', ...completedTurn },
          { runId: input.runId },
        )) as TurnUpdate | undefined;
        for (const message of prepared?.messages ?? []) {
          context.append(message);
          await this.emitUserMessage(message, input.runId);
        }
        this.options.trace?.append('prepare_next_turn', {
          runId: input.runId,
          afterTurn: turnIndex,
          preparedMessages: prepared?.messages?.length ?? 0,
          steeringPending: this.steering.length,
          followUpPending: this.followUps.length,
          explicitContinue,
        }, this.clock());

        if (this.steering.length > 0) {
          await this.drainSteering(context, input.runId, turnIndex);
          continue;
        }
        if (turn.toolCalls.length > 0) continue;
        if (this.followUps.length > 0) {
          const text = this.followUps.shift()!;
          this.persistQueues();
          const queued: AgentMessage = { role: 'user', content: text };
          context.append(queued);
          await this.emitUserMessage(queued, input.runId);
          continue;
        }
        // `{ action: 'continue' }` with nothing else to schedule: one context-only turn.
        continue;
      }
    } catch (caught) {
      stopReason = signal.aborted ? 'run_aborted' : 'run_error';
      error = caught instanceof Error ? caught.message : String(caught);
      this.options.trace?.append('run_error', { runId: input.runId, message: error }, this.clock());
    } finally {
      this.running = false;
      this.abortController = undefined;
    }

    const assistantText = context.project().filter((message) => message.role === 'assistant').map((message) => message.content).filter(Boolean).join('\n');
    const summary: RunSummary = {
      runId: input.runId,
      sessionId: input.sessionId,
      turnId,
      userText: input.userText,
      assistantText,
      toolCalls: allToolCalls,
      toolResults: allToolResults,
      turns,
      tokens,
      stopReason,
      error,
    };
    const endFailure = hookFailure(await this.options.bus.emit('agent_end', { type: 'agent_end', runId: input.runId, messages: context.project(), summary }, { runId: input.runId }));
    if (endFailure) {
      // `agent_end` is where capture writes the run's account to the ledger. A handler failing there
      // makes the account incomplete, so the run is reported as `run_error` and the caller leaves
      // RUNNING through the legal edge. The bus did not let the throw escape — it recorded the failure
      // and returned it — so this is the verdict, not a rescue. Nothing is swallowed: the summary
      // carries the message and the trace names the hook.
      this.options.trace?.append('agent_end_hook_failed', { runId: input.runId, message: endFailure }, this.clock());
      summary.stopReason = 'run_error';
      summary.error = `agent_end_hook_failed: ${endFailure}`;
    }
    // Pi's `agent_settled`: the run is not over when the last event is *emitted*, only when its
    // awaited listeners have finished. This is the boundary the outer machine leaves RUNNING on —
    // `run()` does not return until this resolves — so a settle handler still sees RUNNING, and
    // nothing it queues can be mistaken for the next run's.
    const settleFailure = hookFailure(await this.options.bus.emit('agent_settled', {
      type: 'agent_settled',
      runId: input.runId,
      aborted: stopReason === 'run_aborted',
      stopReason,
    }, { runId: input.runId }));
    if (settleFailure) {
      // The settled boundary is the last chance to leave RUNNING; a handler failing here must not be
      // why the machine stays there. Same rule as the `agent_end` failure above: loud, not swallowed.
      this.options.trace?.append('agent_settled_hook_failed', { runId: input.runId, message: settleFailure }, this.clock());
      summary.stopReason = 'run_error';
      summary.error = `agent_settled_hook_failed: ${settleFailure}`;
    }
    return summary;
  }

  /**
   * Steering drains here: after the turn's tool batch, before the next turn begins. The trace record
   * makes the timing legible — a long tool call is exactly when a user types, and the survival run
   * needs to read back which turn their line landed on.
   */
  private async drainSteering(context: ContextProjection, runId: string, afterTurn: number): Promise<void> {
    const count = this.steering.length;
    while (this.steering.length > 0) {
      const queued: AgentMessage = { role: 'user', content: this.steering.shift()! };
      context.append(queued);
      await this.emitUserMessage(queued, runId);
    }
    // Injected is durable too: a kill after this point must not re-deliver what the model already saw.
    this.persistQueues();
    this.options.trace?.append('steering_injected', { runId, afterTurn, beforeTurn: afterTurn + 1, count }, this.clock());
  }

  /** Pi emits the user message on the same start/end pair the assistant uses. */
  private async emitUserMessage(message: AgentMessage, runId: string): Promise<void> {
    await this.options.bus.emit('message_start', { type: 'message_start', message }, { runId });
    await this.options.bus.emit('message_end', { type: 'message_end', message }, { runId });
  }

  /** One context pipeline (`transformContext` in Pi terms), then the messages reach the provider. */
  private async projectMessages(messages: AgentMessage[], runId: string): Promise<AgentMessage[]> {
    const projected = await this.options.bus.pipeline('transformContext', messages, { runId });
    return Array.isArray(projected) ? (projected as AgentMessage[]) : messages;
  }
}
