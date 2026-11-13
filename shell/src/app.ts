/**
 * Assembly: the three core pieces (state machine, plugin host, kernel connection) wired to the
 * plugins that carry every capability.
 *
 * The app is also the only place that knows the transition triggers' meanings — a message wakes the
 * shell, a due intent re-injects the clock, the cage's overrun leaves RUNNING. Plugins decide
 * behaviour; the app decides which transition that behaviour is.
 */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createMemoryKernel, KernelAgentMemoryBackend, type MemoryKernel } from 'cogmem';
import { TraceStore } from 'cogmem/internal';
import { defaultShellConfig, type ShellConfig } from './config.ts';
import { StateMachine } from './state/machine.ts';
import { CheckpointStore, type InFlightToolCall } from './state/checkpoint.ts';
import { ProcessLock } from './process-lock.ts';
import { TraceLog } from './trace.ts';
import { PluginHost } from './plugins/host.ts';
import { clockPlugin, ClockService } from './plugins/clock.ts';
import { providedModelPlugin } from './plugins/mg-provider.ts';
import { ModelRouter, modelRouterPlugin, routeLine } from './model/router.ts';
import { RouteStore, redactUrl } from './model/routes.ts';
import { cagePlugin, RunCage } from './plugins/cage.ts';
import { builtinToolsPlugin } from './plugins/builtin-tools.ts';
import { coreCommandFor, availableCoreCommand, unknownCommandReply, type CommandHost, type CommandReply } from './commands.ts';
import { proposalPlugin } from './plugins/proposal.ts';
import { CommandProposals, executeProposal, type CommandProposal, type ProposalConfirmation } from './proposals.ts';
import { capturePlugin } from './plugins/capture.ts';
import { recallPlugin } from './plugins/recall.ts';
import { dreamPlugin } from './plugins/dream.ts';
import { emergencePlugin } from './plugins/emergence.ts';
import { terminalPlugin, TerminalChannel, type ShellControl } from './channels/terminal.ts';
import { AgentRuntime, type ModelProvider, type RunSummary, type TurnUsage } from './state/agent-loop.ts';
import { SecretRedactor, startKernelHttpFace, type HttpFaceHandle } from './kernel-host.ts';
import { readSoul } from './install/soul.ts';
import { AttachServer, defaultSocketPath, type AttachShell } from './attach/server.ts';
import { buildAwayReport, enqueueAway } from './presence.ts';
import type { PresenceReport, StatusState, WorkState } from './tui/view.ts';

export interface PiPluginLoadResult {
  pluginName: string;
  status: string;
  tools: string[];
  commands: string[];
  refusedCapabilities: string[];
}

export interface CompanionShellOptions {
  config?: Partial<ShellConfig>;
  /** Tests inject a deterministic provider; production uses the mg plugin. */
  modelProvider?: ModelProvider;
  now?: () => number;
  tick?: boolean;
  /** Called when a checkpoint write fails; the CLI turns it into a non-zero exit. */
  onAlarm?: (error: Error) => void;
  terminalInput?: NodeJS.ReadableStream;
  terminalOutput?: NodeJS.WritableStream;
}

export class CompanionShell implements ShellControl, AttachShell {
  readonly config: ShellConfig;
  readonly trace: TraceLog;
  readonly machine: StateMachine;
  readonly host: PluginHost;
  readonly kernel: MemoryKernel;
  readonly backend: KernelAgentMemoryBackend;
  readonly lock: ProcessLock;
  /** The agent's command offers and the user's answers; the transcript element's source of truth. */
  readonly proposals: CommandProposals;
  private runtime?: AgentRuntime;
  private cage?: RunCage;
  private clock?: ClockService;
  private dream?: { integrate(...args: [string, string, number?]): Promise<{ localDate: string; eventCount: number; sourceRefs: unknown[]; summary: string }> };
  private emergence?: { decide(query: string | undefined, now?: number): { candidates: Array<{ id: string; text: string; reason: string }>; suppressed: unknown[] } };
  private http?: HttpFaceHandle;
  private terminal?: TerminalChannel;
  private attach?: AttachServer;
  private modelLabel = 'unknown';
  /** Present only when this process built its own provider; an injected test provider has no routes. */
  private modelRouter?: ModelRouter;
  /** An estimate of the assembled context; the kernel has no F14 budget controller to ask. */
  private contextTokenEstimate = 0;
  /** Whether a soul-read failure has been traced; the read itself is retried on the next turn. */
  private soulFailureTraced = false;
  private workLabel = '';
  private runTurns = 0;
  private runTokens = 0;
  /**
   * The provider's own prompt-cache account for the run in flight (#165 round 21): `hit` is what the
   * endpoint reported served from cache, `miss` the remainder of the prompt, `percent` their ratio.
   * Absent until a provider reports a cache field — and absent is shown as nothing, never as 0%, so a
   * provider that never reports caching cannot look like a provider that always misses. Round 17's
   * estimate is not this number and never fills it.
   */
  private promptCache?: { hit: number; miss: number; percent: number };
  private runStartedAt?: number;
  /**
   * The killed run's prompt, rebuilt from the session log at recovery (#210). Delivery is a product
   * decision the shell does not make; holding it means the interrupted turn is reconstructable.
   */
  private interrupted?: { runId: string; text: string; chars: number };
  private readonly redactor = new SecretRedactor();
  private readonly adapters: Array<{ emitSessionShutdown(): Promise<void> }> = [];
  private tickTimer?: ReturnType<typeof setInterval>;
  private started = false;
  private readonly now: () => number;
  readonly piPluginResults: PiPluginLoadResult[] = [];

  constructor(private readonly options: CompanionShellOptions = {}) {
    this.config = defaultShellConfig(options.config);
    this.now = options.now ?? Date.now;
    this.trace = new TraceLog(this.config.dataDir);
    this.machine = new StateMachine({
      checkpoint: new CheckpointStore(this.config.dataDir),
      trace: this.trace,
      clock: this.now,
      onAlarm: (error) => {
        console.error(`[companion-shell] ALARM: ${error.message}; halting`);
        this.options.onAlarm?.(error);
      },
    });
    this.lock = new ProcessLock(this.config.dataDir);
    this.kernel = createMemoryKernel({ dbPath: this.config.dbPath, projectTimeZone: this.config.timeZone });
    this.backend = new KernelAgentMemoryBackend(this.kernel);
    this.host = new PluginHost({ trace: this.trace });
    this.host.seedService('stateMachine', this.machine);
    this.host.seedService('eventBus', this.host.bus);
    this.host.seedService('memory', this.backend);
    this.host.seedService('kernel', this.kernel);
    this.host.seedService('shell', this);
    this.host.seedService('commands', this.host.commands);
    this.host.seedService('trace', this.trace);
    // The proposal registry (spec §7, #165 round 22). Its availability rule is the palette's, asked
    // on the resident's face — the face a confirmed proposal executes on — so the panel and the
    // proposal path cannot disagree about what is runnable.
    this.proposals = new CommandProposals(
      (command) => availableCoreCommand(command, 'resident', { multipleRoutes: this.modelRoutes().length > 1 }) !== undefined,
      this.trace,
      this.now,
      (proposal) => void this.host.bus.emit('companion_command_proposal', { proposal }),
    );
    this.host.seedService('proposals', this.proposals);
    // Every transition is also a bus event, so a plugin can observe the lifecycle without reading the
    // checkpoint file. The Pi-aligned names are untouched; this one carries the companion prefix.
    this.machine.onTransition((record) => {
      if (record.to === 'RUNNING') {
        this.runStartedAt = record.at;
        this.runTurns = 0;
        this.runTokens = 0;
        // A new run's cache account starts empty: the previous run's ratio is not evidence about this
        // one, and a stale percentage in the footer would read as if it were.
        this.promptCache = undefined;
        this.workLabel = '思考中';
      }
      void this.host.bus.emit('companion_transition', { ...record, state: record.to });
      this.emitWork();
      this.emitStatus();
    });
  }

  get state(): string {
    return this.machine.state;
  }

  /** How many TUI clients are attached; zero is what makes the shell hold emergence. */
  get attachedClients(): number {
    return this.attach?.clientCount ?? 0;
  }

  isRunning(): boolean {
    return this.machine.state === 'RUNNING';
  }

  /** The `/pause` gate, read from the checkpoint so a restart cannot forget it. */
  get capturePaused(): boolean {
    return this.machine.runtime.capturePaused === true;
  }

  get runtimeInstance(): AgentRuntime | undefined {
    return this.runtime;
  }

  /** The loopback HTTP face's address (status + star map), when this process started one. */
  get httpUrl(): string | undefined {
    return this.http?.baseUrl;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const lock = this.lock.acquire(process.pid, this.now());
    if (lock.recoveredStalePid) this.trace.append('stale_lock_recovered', { pid: lock.recoveredStalePid });
    let restored: ReturnType<StateMachine['restore']>;
    let traceScan: ReturnType<TraceLog['recover']>;
    try {
      // The session log is read before the state machine is: a log damaged while nothing was watching
      // is repaired and written down here, and a checkpoint that cannot be recovered still leaves that
      // record behind (the lock goes with the failure, since this process will not run).
      traceScan = this.trace.recover();
      restored = this.machine.restore();
    } catch (error) {
      this.lock.release(process.pid);
      throw error;
    }
    // The loadout the checkpoint's transcript declared, read before any plugin registers a tool so
    // the comparison below sees what the previous process promised, not what this one just built.
    const restoredTools = this.machine.runtime.declaredTools ? [...this.machine.runtime.declaredTools] : undefined;
    if (restored.previous && ['RUNNING', 'DREAMING', 'WAKING'].includes(restored.previous)) {
      const recoveredRunId = this.machine.activeRunId;
      this.trace.append('recovery', { previous: restored.previous, seq: this.machine.seq, runId: recoveredRunId ?? null });
      if (restored.previous === 'RUNNING' && recoveredRunId) {
        // Pi #10000's durable prompt is what the interrupted turn hangs on: the checkpoint's display
        // copy stops at 500 chars, the session log does not.
        const prompt = traceScan.records.find((record) => record.kind === 'run_prompt' && record.runId === recoveredRunId);
        if (prompt && typeof prompt.text === 'string') {
          this.interrupted = { runId: recoveredRunId, text: prompt.text, chars: Number(prompt.chars ?? prompt.text.length) };
          this.trace.append('prompt_recovered', { runId: recoveredRunId, chars: this.interrupted.chars });
        }
      }
      await this.machine.dispatch('recovered_run', { reason: `recovered_after_kill:${restored.previous}` });
    }
    try {
      await this.startPlugins();
    } catch (error) {
      this.lock.release(process.pid);
      throw error;
    }
    if (this.config.http.enabled) {
      this.http = await startKernelHttpFace(this.kernel, {
        ...this.config.http,
        health: () => ({ state: this.machine.state }),
      });
      this.trace.append('http_face_started', { url: this.http.baseUrl, port: this.http.port });
    }
    if (this.config.pi.adapterEnabled && this.config.pi.plugins.length > 0) {
      await this.loadPiPlugins();
    }
    // The executable set is complete only now (native tools, then Pi plugin tools). A checkpoint that
    // declared a different loadout is a loud failure, and the current one becomes the declaration.
    const mismatch = this.declaredToolMismatch(restoredTools);
    if (mismatch) {
      this.trace.append('tool_set_mismatch', mismatch);
      // Unwind what start built before refusing, so an embedder does not inherit a half-started shell;
      // the lock goes last, since releasing it is what admits the next process.
      this.http?.stop();
      await this.host.stop();
      this.lock.release(process.pid);
      throw new Error(`tool_set_mismatch: the checkpoint declared [${mismatch.declared.join(', ')}] but this process can execute [${mismatch.executable.join(', ')}]`);
    }
    this.refuseRecoveryReplay(restored.previous);
    this.machine.updateRuntime({ declaredTools: this.executableToolNames() });
    if (this.machine.state === 'DORMANT') {
      await this.machine.dispatch('boot', { reason: 'process_start' });
      this.injectTimeContext('process_start');
      await this.machine.dispatch('context_injected', { reason: 'waking_complete' });
    }
    this.clock!.scheduleIdleWake();
    this.terminal?.start();
    if (this.config.attach.enabled) {
      this.attach = new AttachServer({
        socketPath: this.config.attach.socketPath ?? defaultSocketPath(this.config.dataDir),
        shell: this,
        bus: this.host.bus,
        trace: this.trace,
      });
      await this.attach.start();
    }
    if (this.options.tick !== false) {
      // The tick is what keeps a headless resident process alive: it is the scheduler that fires a
      // persisted wake intent, not an unref'd convenience timer. An unref here let `--no-terminal`
      // exit immediately and leave its lock behind.
      this.tickTimer = setInterval(() => {
        void this.tick().catch((error) => this.trace.append('tick_error', { message: error instanceof Error ? error.message : String(error) }));
      }, this.config.tickIntervalMs);
    }
    // The queue is state (#210), so a non-empty one comes back item by item; the recovery fact is
    // written down rather than silent. The queue's own text stays in the checkpoint, not the log.
    const restoredQueue = {
      steering: [...(this.machine.runtime.pendingSteering ?? [])],
      followUps: [...(this.machine.runtime.pendingFollowUps ?? [])],
    };
    if (restoredQueue.steering.length > 0 || restoredQueue.followUps.length > 0) {
      this.trace.append('steering_restored', {
        steering: restoredQueue.steering.length,
        followUps: restoredQueue.followUps.length,
        steeringChars: restoredQueue.steering.reduce((sum, line) => sum + line.length, 0),
      });
    }
    this.started = true;
    this.trace.append('shell_started', { state: this.machine.state, mi: this.machine.wakeIntents.length });
  }

  private async startPlugins(): Promise<void> {
    // An injected provider (tests, an embedding host) is used as-is and has no route table. The real
    // resident gets a router: the mg route from env plus whatever named routes the user stored.
    let provider = this.options.modelProvider ? providedModelPlugin(this.options.modelProvider) : undefined;
    if (!provider) {
      this.modelRouter = new ModelRouter({
        store: new RouteStore(join(this.config.dataDir, 'routes.json')).load(),
        builtin: { name: 'mg', baseUrl: this.config.model.baseUrl, apiKey: this.config.model.apiKey, model: this.config.model.model },
        timeoutMs: this.config.model.timeoutMs,
      });
      // A routes file that did not parse is a real problem the user must see, but it must not stop the
      // resident: mg is available either way.
      if (this.modelRouter.storeError) this.trace.append('model_routes_load_failed', { message: this.modelRouter.storeError });
      provider = modelRouterPlugin(this.modelRouter);
    }
    this.host.register(clockPlugin({ timeZone: this.config.timeZone, idleWakeIntervalMs: this.config.idleWakeIntervalMs, dreamWindow: { startHour: this.config.dream.windowStartHour, endHour: this.config.dream.windowEndHour } }));
    this.host.register(provider, this.config.model);
    this.host.register(cagePlugin(this.config.budgets, this.trace));
    this.host.register(builtinToolsPlugin(), { workspaceRoot: this.config.workspaceRoot });
    this.host.register(proposalPlugin());
    this.host.register(capturePlugin({ agentId: this.config.agentId, projectId: this.config.projectId, sessionId: this.config.sessionId, paused: () => this.capturePaused }));
    this.host.register(recallPlugin({ agentId: this.config.agentId, projectId: this.config.projectId, limit: 3 }));
    this.host.register(dreamPlugin({ agentId: this.config.agentId, projectId: this.config.projectId, sessionId: this.config.sessionId, runKernelNight: this.config.dream.runKernelNight, maxEpisodes: this.config.dream.maxEpisodes }));
    this.host.register(emergencePlugin({ agentId: this.config.agentId, projectId: this.config.projectId }));
    if (this.config.terminalEnabled) {
      this.host.register(terminalPlugin({
        shell: this,
        input: this.options.terminalInput,
        output: this.options.terminalOutput,
        trace: this.trace,
        captureTerminalRecord: async (text: string) => {
          await this.captureService?.captureTerminalRecord(text, `companion-day:${this.clock!.localDate()}`);
        },
      }));
    }
    await this.host.start();
    this.clock = this.host.getService<ClockService>('clock');
    this.cage = this.host.getService<RunCage>('cage');
    const model = this.host.getService<ModelProvider>('model');
    this.runtime = new AgentRuntime({
      bus: this.host.bus,
      // Pi #10000: the whole prompt is durable before the model call, redacted so the log never holds a
      // secret the ledger would have stripped. The checkpoint keeps only the 500-char display copy.
      onPrompt: ({ runId, sessionId, text }) => {
        const marked = this.redactor.mark(text);
        this.trace.append('run_prompt', { runId, sessionId, chars: text.length, text: marked.value, ...marked.metadata });
      },
      tools: this.host.tools,
      provider: model,
      budget: this.cage,
      systemPrompt: () => this.systemPrompt(),
      trace: this.trace,
      clock: this.now,
      // A mid-run hot-plug declares the delta in the transcript; the checkpoint keeps the same set so
      // the next recovery can compare it against what the process can run.
      onToolsDeclared: (names) => this.machine.updateRuntime({ declaredTools: [...names].sort() }),
      // The queues are state, not memory (#210): the checkpoint written before the process dies is
      // what the next start drains, in order.
      initialQueues: { steering: this.machine.runtime.pendingSteering, followUps: this.machine.runtime.pendingFollowUps },
      onQueueChange: ({ steering, followUps }) => this.machine.updateRuntime({
        pendingSteering: steering.length > 0 ? [...steering] : undefined,
        pendingFollowUps: followUps.length > 0 ? [...followUps] : undefined,
      }),
      // The context gauge is the measured request, not a running total of message events: the system
      // prompt, the tool schemas and a `transformContext`-injected recall block are all part of what
      // the model was charged for, and none of them is a message this process emits.
      onContextAssembled: (account) => {
        this.contextTokenEstimate = account.totalTokens;
        this.emitStatus();
      },
    });
    this.modelLabel = `${this.host.getService<ModelProvider>('model').name}/${model.model}`;
    this.attachWorkListeners();
    this.dream = this.host.getService('dream');
    this.emergence = this.host.getService('emergence');
    // Crash recovery needs to know what was running. The checkpoint records the calls that started and
    // have not finished, which is the list a replay would have to be judged against (see
    // `refuseRecoveryReplay`). ponytail: two checkpoint writes per tool call; batch them if a run ever
    // issues tools fast enough for the fsyncs to show up.
    this.host.bus.on('tool_execution_start', (event: { toolCallId?: string; toolName?: string }) => {
      if (!event.toolCallId || !event.toolName) return;
      const inFlight = this.machine.runtime.inFlightToolCalls ?? [];
      if (inFlight.some((call) => call.toolCallId === event.toolCallId)) return;
      const started: InFlightToolCall = { toolCallId: event.toolCallId, toolName: event.toolName };
      this.machine.updateRuntime({ inFlightToolCalls: [...inFlight, started] });
    });
    this.host.bus.on('tool_execution_end', (event: { toolCallId?: string }) => {
      const inFlight = this.machine.runtime.inFlightToolCalls ?? [];
      if (!event.toolCallId || !inFlight.some((call) => call.toolCallId === event.toolCallId)) return;
      this.machine.updateRuntime({ inFlightToolCalls: inFlight.filter((call) => call.toolCallId !== event.toolCallId) });
    });
    // The terminal channel prints what the shell says; the app is the only place that knows a reply
    // finished, so it forwards the assistant text on the bus the channel already listens to.
    this.host.bus.on('message_end', (event: { message?: { role?: string; content?: string } }) => {
      if (event.message?.role === 'assistant' && event.message.content) {
        void this.host.bus.emit('terminal_print', { text: `${event.message.content}\n` });
      }
    });
    this.terminal = this.host.hasService('terminal') ? this.host.getService<TerminalChannel>('terminal') : undefined;
  }

  private get captureService() {
    return this.host.hasService('capture') ? this.host.getService<{ captureTerminalRecord(text: string, threadId: string): Promise<unknown> }>('capture') : undefined;
  }

  /** The names the process can actually execute, which is what a transcript declaration must match. */
  private executableToolNames(): string[] {
    return this.host.tools.list().map((tool) => tool.name).sort();
  }

  /**
   * Crash recovery must not replay an effect whose outcome is unknown. Nothing in the shell replays a
   * tool call today; this makes the refusal explicit and names what it would have replayed, using the
   * policy each tool declares (`read` is safe; bash/write/edit and anything undeclared are not).
   */
  private refuseRecoveryReplay(previous: string | undefined): void {
    const inFlight = this.machine.runtime.inFlightToolCalls ?? [];
    if (previous !== 'RUNNING' || inFlight.length === 0) return;
    const judged = inFlight.map((call) => ({ ...call, replay: this.host.tools.get(call.toolName)?.replay ?? 'never' }));
    this.trace.append('recovery_no_replay', { previous, inFlight: judged, refused: judged.filter((call) => call.replay === 'never').map((call) => call.toolName) });
    this.machine.updateRuntime({ inFlightToolCalls: [] });
  }

  /**
   * Pi restores the loadout a transcript declared (`_restoreToolsFromTranscript`). Here the rule is
   * stricter: if the checkpoint promised a set the process can no longer execute exactly — a plugin
   * removed, added or failed to load — the shell refuses to start with a transcript that names tools
   * it does not have, rather than run degraded and quiet.
   */
  private declaredToolMismatch(restored: string[] | undefined): { declared: string[]; executable: string[] } | undefined {
    if (!restored) return undefined;
    const executable = this.executableToolNames();
    const declared = [...restored].sort();
    if (declared.length === executable.length && declared.every((name, index) => name === executable[index])) return undefined;
    return { declared, executable };
  }

  private async loadPiPlugins(): Promise<void> {
    const adapterModule = await import('./pi/adapter.ts');
    for (const spec of this.config.pi.plugins) {
      const entry = adapterModule.resolvePiExtensionEntry(spec, this.config.workspaceRoot);
      const adapter = new adapterModule.PiCompatAdapter({
        host: this.host,
        pluginName: spec,
        cwd: this.config.workspaceRoot,
        sessionId: this.config.sessionId,
        systemPrompt: () => this.systemPrompt(),
        isIdle: () => this.machine.state === 'IDLE',
        hasPendingMessages: () => (this.runtime?.pendingMessages ?? 0) > 0,
        abort: () => this.runtime?.abort('pi_extension_abort'),
        onShutdown: () => void this.stop(),
        onSendMessage: ({ text, deliverAs }) => this.onPiMessage(text, deliverAs),
        trace: this.trace,
      });
      const result = await adapter.load(entry);
      await adapter.emitSessionStart();
      this.adapters.push(adapter);
      this.piPluginResults.push(result);
    }
  }

  private onPiMessage(text: string, deliverAs: 'steer' | 'followUp' | 'nextTurn'): void {
    if (deliverAs === 'steer' && this.machine.state === 'RUNNING') {
      this.runtime!.steer(text);
      return;
    }
    if (deliverAs === 'followUp' && this.machine.state === 'RUNNING') {
      this.runtime!.followUp(text);
      return;
    }
    void this.submit(text).catch((error) => this.trace.append('pi_message_failed', { message: error instanceof Error ? error.message : String(error) }));
  }

  /**
   * The system prompt is assembled from two sections, and the split is a contract, not a layout
   * choice. The **pinned zone** is the soul (verbatim, at its head), the identity and the rules: its
   * bytes must be identical from one request to the next, which is what F14's lane order starts with
   * (#191) and the half of it a provider-side prompt cache can hit. The **variable tail** is the only
   * place per-turn content may live; today that is the time context, which is why it is rebuilt from
   * the live clock on every call instead of reusing the block written at the last wake — a prompt
   * that froze "now" at boot kept telling the model it was still morning three hours later.
   *
   * Pi holds the same property structurally: named sections rendered in a fixed order, diffed so a
   * changed section travels as an update instead of the prompt being re-sent (`core/system-prompt.js`
   * `buildSystemPromptSections` / `diffSystemPromptSections`), and a tool list frozen so "the cached
   * prefix survives every tool change" (`pi-ai/dist/api/anthropic-messages.js:947-951`). The shell has
   * one seam and no mid-run prompt mutation, so the pinned zone is what plays that part.
   */
  systemPromptSections(): { pinned: string; tail: string } {
    const pinned = [
      this.soulText(),
      'You are a resident companion agent whose memory is Cogmem. Memory comes first: recall before you answer, and let what you remember shape how you say it.',
      'You are present at all hours; when nothing needs you, you are quiet rather than chatty.',
      'You have four basic tools (read, write, edit, bash). Use them when the moment needs real work; otherwise just talk.',
      'To hand the user a shell command, call `propose_command` with the command and a one-line reason. It is only an offer: the command runs when the user confirms it, never before, so never say it already ran.',
      'Never invent a memory. If recall is empty, say so plainly.',
    ].filter(Boolean);
    const tail = [this.clock ? this.clock.timeContextBlock(this.now()) : ''].filter(Boolean);
    return { pinned: pinned.join('\n\n'), tail: tail.join('\n\n') };
  }

  systemPrompt(): string {
    const { pinned, tail } = this.systemPromptSections();
    return [pinned, tail].filter(Boolean).join('\n\n');
  }

  /**
   * The newest soul row, read where it is: it is the pinned zone's head, so it is injected verbatim,
   * and F17's editor has to reach the next request without a restart. A database the installer never
   * wrote the table into is not a turn failure — the pinned zone is simply shorter — but it is
   * recorded once, so an absent soul is distinguishable from a soul that failed to load.
   */
  private soulText(): string {
    try {
      return readSoul(this.config.dbPath, this.config.agentId)?.content ?? '';
    } catch (error) {
      // The read is retried every turn — a lock held for a moment must not cost the soul for the rest
      // of the process's life — but the trace entry is one-shot, or a database the installer never
      // wrote would file the same record on every turn forever.
      if (!this.soulFailureTraced) {
        this.soulFailureTraced = true;
        this.trace.append('soul_read_failed', { message: error instanceof Error ? error.message : String(error) });
      }
      return '';
    }
  }

  async submit(text: string): Promise<RunSummary | undefined> {
    if (this.machine.state === 'RUNNING') {
      this.runtime!.steer(text);
      this.emitSteering();
      return undefined;
    }
    this.clock!.markInteraction(text, this.now());
    await this.wakeIfNeeded('message_received');
    if (this.machine.state !== 'IDLE') throw new Error(`submit_requires_idle: state is ${this.machine.state}`);
    return this.executeRun(text, 'message_received', 'user_message');
  }

  private async wakeIfNeeded(trigger: 'message_received' | 'wake_intent_due' | 'emergence_due'): Promise<void> {
    if (this.machine.state === 'DORMANT') await this.machine.dispatch('message_received', { reason: 'message_while_dormant' });
    if (this.machine.state === 'DREAMING') await this.machine.dispatch('message_received', { reason: 'message_while_dreaming' });
    if (this.machine.state === 'WAKING') {
      this.injectTimeContext(trigger);
      await this.machine.dispatch('context_injected', { reason: `${trigger}_time_context` });
    }
  }

  private async executeRun(text: string, trigger: 'message_received' | 'emergence_due', reason: string): Promise<RunSummary> {
    const runId = `run-${this.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    this.cage!.beginRun(runId);
    await this.machine.dispatch(trigger, { runId, reason });
    const summary = await this.runtime!.run({ runId, sessionId: this.config.sessionId, userText: text });
    await this.machine.dispatch(summary.stopReason, { reason: summary.error ?? reason, runId });
    if (!this.clock!.nextPendingIntent()) this.clock!.scheduleIdleWake();
    return summary;
  }

  /** One deterministic tick: due intent, then dream window, then the emergence decision point. */
  async tick(at = this.now()): Promise<void> {
    if (this.machine.state === 'RUNNING' || this.machine.state === 'WAKING') return;
    if (this.machine.state === 'DORMANT') {
      await this.applyDueWakeIntent(at);
      return;
    }
    if (this.machine.state === 'DREAMING') return;
    await this.applyDueWakeIntent(at);
    if (this.clock!.dreamWindowOpen(at) && !this.clock!.dreamedToday(at)) {
      await this.runDream(at);
      return;
    }
    if (this.machine.state === 'IDLE') {
      const decision = this.emergence!.decide(this.machine.runtime.lastInteractionText, at);
      if (decision.candidates.length > 0) {
        const candidate = decision.candidates[0];
        if (this.shouldHoldForAbsence()) {
          // Nobody is attached, so speaking now would be talking to an empty room. Hold it in the
          // durable away queue and let the next attach's "你不在时" broadcast carry it.
          this.machine.updateRuntime({
            awayQueue: enqueueAway(this.machine.runtime, { id: candidate.id, text: candidate.text, reason: candidate.reason, at }),
          });
          this.trace.append('emergence_accumulated', { id: candidate.id, reason: candidate.reason, at });
          return;
        }
        void this.host.bus.emit('companion_emergence', { id: candidate.id, reason: candidate.reason, text: candidate.text });
        await this.executeRun(candidate.text, 'emergence_due', `emergence:${candidate.id}`);
      }
    }
  }

  /** WAKING means the block is written into runtime state, not just into the trace. */
  private injectTimeContext(reason: string, at = this.now()): void {
    const block = this.clock!.timeContextBlock(at);
    this.machine.updateRuntime({ lastTimeContext: block });
    this.trace.append('time_context_injected', { block, reason });
  }

  /** One due intent is one WAKING->IDLE pass; both the dormant and the standby path use it. */
  private async applyDueWakeIntent(at: number): Promise<void> {
    const due = this.clock!.dueWakeIntent(at);
    if (!due) return;
    this.clock!.consumeWakeIntent(due.id);
    await this.machine.dispatch('wake_intent_due', { reason: due.reason });
    this.injectTimeContext(`wake_intent:${due.id}`, at);
    await this.machine.dispatch('context_injected', { reason: 'wake_intent' });
  }

  async runDream(at = this.now()): Promise<void> {
    await this.machine.dispatch('dream_window_open', { reason: 'dream_window' });
    const localDate = this.clock!.localDate(at);
    try {
      const result = await this.dream!.integrate(localDate, `companion-day:${localDate}`, at);
      this.clock!.markDreamed(at);
      this.clock!.setWakeIntent(at + 8 * 60 * 60_000, 'morning_after_dream');
      this.trace.append('dream_complete', { localDate, eventCount: result.eventCount, sourceRefs: result.sourceRefs.length });
      void this.host.bus.emit('companion_dream', { product: { localDate, eventCount: result.eventCount, summary: result.summary } });
      // A message that arrived while the integration was awaiting wakes the shell out of DREAMING.
      // The product is already written; the transition belongs to whoever moved the state, not to us.
      if (this.machine.state !== 'DREAMING') {
        this.trace.append('dream_finished_after_wake', { localDate, state: this.machine.state });
        return;
      }
      await this.machine.dispatch('dream_complete', { reason: `dream:${localDate}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.trace.append('dream_failed', { localDate, message });
      await this.machine.dispatch('run_error', { reason: `dream_failed:${message}` });
    }
  }

  // ---- The attach surface (`AttachShell`): everything the TUI process is allowed to ask for. ----

  /**
   * The work indicator and the context gauge are fed from the same events the transcript is, so the
   * TUI never has to poll state: a turn starts, a tool starts, tokens are charged, a run settles.
   */
  private attachWorkListeners(): void {
    this.host.bus.on('agent_start', () => {
      this.emitStatus();
    });
    this.host.bus.on('turn_start', (event: { turnIndex?: number }) => {
      this.runTurns = event.turnIndex ?? this.runTurns;
      this.workLabel = '思考中';
      this.emitWork();
    });
    this.host.bus.on('turn_usage', (event: { totalTokens?: number; usage?: TurnUsage }) => {
      this.runTokens = event.totalTokens ?? this.runTokens;
      const cache = promptCacheAccount(event.usage);
      if (cache) {
        this.promptCache = cache;
        this.emitStatus();
      }
      this.emitWork();
    });
    this.host.bus.on('tool_execution_start', (event: { toolName?: string }) => {
      this.workLabel = event.toolName ?? '工具';
      this.emitWork();
    });
    this.host.bus.on('tool_execution_end', () => {
      this.workLabel = '思考中';
      this.emitWork();
    });
    this.host.bus.on('turn_end', () => this.emitSteering());
    this.host.bus.on('agent_end', (event: { summary?: RunSummary }) => {
      const tokens = event.summary?.tokens ?? 0;
      if (tokens > 0) this.chargeCost(tokens);
    });
    this.host.bus.on('agent_settled', () => {
      this.workLabel = '思考中';
      this.emitWork();
      this.emitSteering();
      this.emitStatus();
    });
  }

  private chargeCost(tokens: number): void {
    try {
      const today = this.clock?.localDate() ?? new Date().toISOString().slice(0, 10);
      const previous = this.machine.runtime.costDayDate === today ? this.machine.runtime.costDayTokens ?? 0 : 0;
      this.machine.updateRuntime({ costDayDate: today, costDayTokens: previous + tokens });
    } catch (error) {
      this.trace.append('cost_charge_failed', { tokens, message: error instanceof Error ? error.message : String(error) });
    }
  }

  private emitWork(): void {
    void this.host.bus.emit('companion_work', this.currentWork());
  }

  private emitStatus(): void {
    void this.host.bus.emit('companion_status', { status: this.currentStatus() });
  }

  private emitSteering(): void {
    void this.host.bus.emit('companion_steering', { queued: this.currentQueued() });
  }

  private shouldHoldForAbsence(): boolean {
    return this.config.attach.enabled && (this.attach?.clientCount ?? 0) === 0;
  }

  currentStatus(): StatusState {
    const next = this.clock?.nextPendingIntent();
    const today = this.clock?.localDate() ?? new Date().toISOString().slice(0, 10);
    return {
      name: this.config.agentId,
      lifecycle: this.machine.state,
      kernelConnected: !this.machine.isHalted,
      nextWakeAt: next?.at,
      nextWakeReason: next?.reason,
      model: this.modelLabel,
      workspace: this.config.workspaceRoot,
      showWorkspace: true,
      contextTokens: this.contextTokenEstimate,
      contextSweetSpot: this.config.contextSweetSpot,
      promptCache: this.promptCache ?? null,
      costTokens: this.machine.runtime.costDayDate === today ? this.machine.runtime.costDayTokens ?? 0 : 0,
      timeZone: this.config.timeZone,
      capturePaused: this.capturePaused,
    };
  }

  currentWork(): WorkState {
    return {
      active: this.machine.state === 'RUNNING',
      label: this.workLabel,
      startedAt: this.runStartedAt,
      turns: this.runTurns,
      maxTurns: this.config.budgets.maxTurnsPerRun,
      tokens: this.runTokens,
      maxTokens: this.config.budgets.maxTokensPerRun,
    };
  }

  currentQueued(): string[] {
    return [...(this.runtime?.steeringMessages ?? [])];
  }

  /** The TUI's Esc on a queued line: withdraw the newest steer the model has not seen. */
  withdrawSteering(): string | undefined {
    const withdrawn = this.runtime?.withdrawSteering();
    this.emitSteering();
    return withdrawn;
  }

  /**
   * The prompt of the run a kill interrupted, rebuilt from the session log (#210). `undefined` when
   * the last start was not a recovery of a RUNNING run with a prompt on record. What to *do* with it
   * — a new turn, the away report, or nothing — is a product decision this method does not make.
   */
  interruptedRun(): { runId: string; text: string; chars: number } | undefined {
    return this.interrupted;
  }

  /** `/sleep` is the command that puts it into DORMANT; closing the window is only a detach. */
  async sleep(): Promise<void> {
    if (this.machine.state === 'DORMANT') return;
    if (this.machine.state !== 'IDLE') throw new Error(`sleep_requires_idle: state is ${this.machine.state}`);
    await this.machine.dispatch('shutdown', { reason: 'sleep_command' });
    this.trace.append('sleep_command', { state: this.machine.state });
  }

  /**
   * The report shown before the conversation resumes. Building it consumes the away queue: it is
   * reported once, because "what happened while you were away" is not a recurring banner.
   */
  awayReport(): PresenceReport {
    // The one production read of the session log. `recover()` is the tolerant read plus the one-time
    // record of any damage, so a torn or corrupted log shows up in the report's own evidence instead
    // of silently reading as "nothing happened while you were away".
    const report = buildAwayReport({
      projectId: this.config.projectId,
      runtime: this.machine.runtime,
      trace: this.trace.recover().records,
      kernel: this.kernel,
      now: this.now(),
    });
    const patch: Record<string, unknown> = { lastAttachAt: this.now() };
    if ((this.machine.runtime.awayQueue?.length ?? 0) > 0) patch.awayQueue = [];
    try {
      this.machine.updateRuntime(patch);
    } catch (error) {
      this.trace.append('attach_state_write_failed', { message: error instanceof Error ? error.message : String(error) });
    }
    return report;
  }

  /** Date the absence when the last client leaves, so the next report has a window to read. */
  attachChanged(count: number): void {
    try {
      this.machine.updateRuntime(count > 0 ? { lastAttachAt: this.now() } : { lastDetachAt: this.now() });
    } catch (error) {
      this.trace.append('attach_state_write_failed', { count, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // ---- The install's first-wake probe (#203), asked over the same control socket. ----
  //
  // The installer is out of process and the resident holds the one writer on the database, so the
  // probe is a request to the resident rather than a second kernel opened on the same file. Both
  // halves are deterministic (`rememberTurnWithResult` / `recall`), so nothing here needs a model.

  async probeRemember(text: string, turnId?: string): Promise<{ ok: boolean; text: string }> {
    try {
      const result = await this.backend.rememberTurnWithResult({
        agentId: this.config.agentId,
        projectId: this.config.projectId,
        sessionId: this.config.sessionId,
        ...(turnId ? { turnId } : {}),
        userText: text,
      });
      return { ok: true, text: result.rawEventIds.join(',') };
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  async probeRecall(query: string): Promise<{ ok: boolean; text: string }> {
    try {
      const result = this.backend.recall({ agentId: this.config.agentId, projectId: this.config.projectId, query, limit: 5 });
      return { ok: true, text: result.items.map((item) => item.text).join('\n') };
    } catch (error) {
      return { ok: false, text: error instanceof Error ? error.message : String(error) };
    }
  }

  commitments(): Array<{ candidateId: string; title: string; status: string; updatedAt: number }> {
    try {
      return this.kernel.prospectiveMemoryService
        .list({ projectId: this.config.projectId, statuses: ['pending', 'confirmed', 'deferred', 'completed'], limit: 100 })
        .map((record) => ({ candidateId: record.candidateId, title: record.title, status: record.status, updatedAt: record.updatedAt }));
    } catch (error) {
      this.trace.append('commitments_read_failed', { message: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /** The TUI route list; with no router (an injected provider) it is just the one label, as before. */
  modelRoutes(): string[] {
    return this.modelRouter ? this.modelRouter.labels() : [this.modelLabel];
  }

  /**
   * Switch the active route in place. The runtime holds this router object, so the next turn's request
   * uses the new endpoint: no restart, no checkpoint rewrite, the session is untouched. A stored
   * switch is remembered by the route store; the built-in mg route is not persisted because it is not
   * user configuration.
   */
  switchModelRoute(name: string): { ok: true; name: string; model: string } | { ok: false; message: string } {
    if (!this.modelRouter) return { ok: false, message: '本进程用的是注入的模型提供者，没有路线表可切。' };
    try {
      const route = this.modelRouter.switchTo(name);
      this.modelLabel = `${route.name}/${route.model}`;
      // The key is not in any of these fields; the URL is redacted in case it carries one.
      this.trace.append('model_route_switched', { name: route.name, model: route.model, baseUrl: redactUrl(route.baseUrl, [route.apiKey]) });
      void this.host.bus.emit('companion_model_routes', { routes: this.modelRoutes(), active: route.name });
      return { ok: true, name: route.name, model: route.model };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  snapshotNote(): string | undefined {
    return `checkpoint seq ${this.machine.seq}`;
  }

  /**
   * The resident's one command entry point, shared by the attach socket and the terminal channel.
   * Core names come from the table (`commands.ts`); plugin commands from the host registry; anything
   * else gets the same unknown-command receipt the other two faces give. A handler that throws is
   * attributed to its command name in both the receipt and the trace — never a nameless error.
   */
  async runCommand(name: string, args = ''): Promise<CommandReply> {
    const core = coreCommandFor(name, 'resident');
    if (core) return this.runCommandGuarded(name, () => core.run(this.commandHost, args));
    if (this.host.commands.has(name)) {
      return this.runCommandGuarded(name, async () => ({ text: (await this.host.commands.run(name, args, this)) ?? '', receipt: true }));
    }
    return unknownCommandReply(name);
  }

  private async runCommandGuarded(name: string, invoke: () => CommandReply | Promise<CommandReply>): Promise<CommandReply> {
    try {
      return await invoke();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.trace.append('command_failed', { command: name, message });
      return { text: `命令 /${name} 失败：${message}`, receipt: true };
    }
  }

  // ---- Command proposals (spec §7, #165 round 22): the agent offers, the user decides. ----

  /**
   * The user's "Enter". This is the only caller of `executeProposal`, and the confirmation event it
   * builds is the user's key — there is no other way for a proposal to reach the dispatcher, which
   * reuses `runCommand` so a confirmed proposal and a typed `/pause` are the same execution. The
   * agent's side is the `propose_command` tool (`plugins/proposal.ts`), which only records.
   */
  async confirmProposal(id: string): Promise<{ ok: boolean; proposal?: CommandProposal; reason?: string; reply?: CommandReply }> {
    const proposal = this.proposals.get(id);
    const confirmation: ProposalConfirmation | undefined = proposal
      ? { kind: 'user-confirm', proposalId: proposal.id, at: this.now() }
      : undefined;
    const outcome = await executeProposal(proposal, confirmation, {
      dispatch: (command, args) => this.runCommand(command, args),
      trace: this.trace,
      now: this.now,
    });
    if (outcome.ok && proposal) this.proposals.settled(proposal);
    return {
      ok: outcome.ok,
      ...(proposal ? { proposal } : {}),
      ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
      ...(outcome.reply ? { reply: outcome.reply } : {}),
    };
  }

  /** The user's "Esc": retire a pending proposal; it can never be confirmed after this. */
  discardProposal(id: string): CommandProposal | undefined {
    return this.proposals.discard(id);
  }

  /** The pending offers, for tests and any face that wants the list rather than the transcript. */
  currentProposals(): CommandProposal[] {
    return [...this.proposals.pending()];
  }

  /**
   * What the palette's command table may ask of the shell. It exists so the handlers can live in
   * `commands.ts` (one table for every face) without moving the shell's private state out of the
   * class: each arrow reads `this` at call time.
   */
  private readonly commandHost: CommandHost = {
    config: () => this.config,
    lifecycle: () => ({ state: this.machine.state, seq: this.machine.seq, costDayTokens: this.machine.runtime.costDayTokens ?? 0 }),
    contextTokens: () => this.contextTokenEstimate,
    promptCache: () => this.promptCache,
    lastDream: () => this.lastDreamProduct(),
    commitments: () => this.commitments(),
    whyReport: () => this.whyReport(),
    capturePaused: () => this.capturePaused,
    setCapturePaused: (paused: boolean) => {
      this.machine.updateRuntime({ capturePaused: paused });
      this.trace.append(paused ? 'capture_paused_command' : 'capture_resumed_command', { at: this.now() });
      this.emitStatus();
    },
    sessionModel: () => this.modelLabel,
    modelRoutes: () => this.modelRoutes(),
    modelRouter: () =>
      this.modelRouter
        ? {
            active: this.modelRouter.active,
            lines: this.modelRouter.routes().map((route) => routeLine(route, route.name === this.modelRouter!.active)),
            storeError: this.modelRouter.storeError,
          }
        : undefined,
    switchRoute: (name: string) => this.switchModelRoute(name),
    sleep: () => this.sleep(),
  };

  /** The palette's plugin half: the resident is the only process that holds the registry. */
  pluginCommands(): Array<{ name: string; description?: string; argumentHint?: string }> {
    return this.host.commands.list().map(({ name, description, argumentHint }) => ({ name, description, argumentHint }));
  }

  /**
   * `/why`: read back the newest recall decision. This goes through the kernel's own `TraceStore`
   * read face — `trace_events` is written by `RecallDecisionTrace` for every recall, and the
   * emergence decision point calls the same recall lane, so both a recall and a surfacing have a row
   * here. It is a read of what was decided, not a re-run (which would write a fresh row); no row is
   * an answer the receipt gives plainly instead of guessing at one.
   */
  whyReport(): string {
    try {
      const db = this.kernel.factStore.getDatabase();
      const hasTraceTable = (db.query(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trace_events'`).all() as unknown[]).length > 0;
      if (!hasTraceTable) return '本会话尚无召回决策痕迹（内核还没有 trace_events 表）。不编造。';
      const store = new TraceStore(db);
      const rows = store.queryByEventType('recall.result').filter((event) => {
        if (event.projectId !== undefined && event.projectId !== this.config.projectId) return false;
        // The trace table has no agent column, so the payload is where an owner can be named (the same
        // reading the observatory uses): an unnamed row is project-level and shown, a named other is not.
        const payload = event.payload as Record<string, unknown>;
        const named = [payload.agentId, payload.agent, payload.sourceAgent].filter((value): value is string => typeof value === 'string');
        return named.length === 0 || named.includes(this.config.agentId);
      });
      const last = rows[rows.length - 1];
      if (!last) return '本会话尚无召回决策痕迹。不编造。';
      const payload = last.payload as Record<string, unknown>;
      const selected = Array.isArray(payload.selectedIds) ? payload.selectedIds.map(String) : [];
      const suppressed = Array.isArray(payload.suppressed) ? (payload.suppressed as Array<Record<string, unknown>>) : [];
      const chain = store.getDecisionChain(last.id);
      const lines = [
        `最近一次召回决策 · ${new Date(last.timestamp).toISOString()}`,
        `查询：${typeof payload.query === 'string' && payload.query !== '' ? payload.query : '（空）'}`,
        `车道：${String(payload.lane ?? 'unknown')} · 理由：${String(payload.reason ?? 'unknown')}`,
        `选中 ${selected.length} 条${selected.length > 0 ? `：${selected.join(', ')}` : ''}`,
      ];
      if (suppressed.length > 0) {
        lines.push(`抑制 ${suppressed.length} 类：${suppressed.map((entry) => `${String(entry.reason ?? 'unknown')}×${Number(entry.count ?? 0)}`).join('、')}`);
      }
      lines.push(`来源链：${chain.length <= 1 ? '无父事件' : chain.map((event) => event.eventType).join(' ← ')}`);
      return lines.join('\n');
    } catch (error) {
      // A read that failed is not "no trace": the receipt says which it was, or a broken database
      // would read as an empty history.
      this.trace.append('why_read_failed', { message: error instanceof Error ? error.message : String(error) });
      return '读决策痕迹失败（内核读取报错）；没有可展示的内容。';
    }
  }

  private lastDreamProduct(): { localDate: string; eventCount: number; summary: string } | undefined {
    const records = this.trace.read().filter((record) => record.kind === 'dream_complete');
    const last = records[records.length - 1];
    if (!last) return undefined;
    const localDate = String(last.localDate ?? '');
    const events = this.kernel.getThreadEvents(`companion-dream:${localDate}`, { projectId: this.config.projectId, limit: 50 });
    const product = events.find((event) => (event.payload as { metadata?: { kind?: unknown } } | undefined)?.metadata?.kind === 'dream-integration');
    const summary = (product?.payload as { text?: unknown } | undefined)?.text;
    return { localDate, eventCount: Number(last.eventCount ?? 0), summary: typeof summary === 'string' ? summary : `夜间整合 ${localDate}` };
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    await this.attach?.stop();
    this.attach = undefined;
    this.terminal?.stop();
    try {
      if (this.machine.state === 'RUNNING') {
        this.runtime?.abort('shutdown');
        await this.machine.dispatch('run_aborted', { reason: 'shutdown' });
      }
      if (this.machine.state === 'DREAMING') await this.machine.dispatch('run_error', { reason: 'shutdown' });
      if (this.machine.state !== 'DORMANT') await this.machine.dispatch('shutdown', { reason: 'process_stop' });
    } finally {
      for (const adapter of this.adapters) await adapter.emitSessionShutdown();
      this.adapters.length = 0;
      this.http?.stop();
      await this.host.stop();
      this.kernel.close();
      this.lock.release(process.pid);
      this.trace.append('shell_stopped', { state: this.machine.state });
    }
  }
}

/**
 * The reported prompt-cache ratio, or `undefined` when the provider reported no cache field. `miss`
 * is the provider's own miss count when it sends one (DeepSeek), otherwise the prompt less the hit —
 * the same denominator Pi's hit-rate display uses (`pi-coding-agent/dist/modes/interactive/components/
 * footer.js:105-107`: `cacheRead / (input + cacheRead + cacheWrite)`). A hit with no prompt size
 * yields no ratio: the divisor would be invented, and an invented ratio is worse than none.
 */
function promptCacheAccount(usage: TurnUsage | undefined): { hit: number; miss: number; percent: number } | undefined {
  const hit = usage?.cacheHit;
  if (hit === undefined) return undefined;
  const miss = usage?.cacheMiss ?? (usage?.input === undefined ? undefined : Math.max(0, usage.input - hit));
  if (miss === undefined || hit + miss <= 0) return undefined;
  return { hit, miss, percent: Math.round((hit / (hit + miss)) * 100) };
}

