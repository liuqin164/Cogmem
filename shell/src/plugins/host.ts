/**
 * The plugin host: one registry, one event bus, one service table.
 *
 * Two authoring entry points land here — native Cordis-style plugins (`apply(ctx, config)`,
 * `provide`, `inject`, `dispose`) and the Pi compatibility adapter — and the conflict rules are the
 * host's, not either layer's: a tool name registers once, the four builtins are not silently
 * overridden, and same-event hooks run in registration order with the first block winning.
 */
import { EventBus, type BusHandler, type BusResult } from '../bus.ts';
import type { ToolResult } from '../state/agent-loop.ts';

/** The four names the shell ships; nobody else may register them, and only their own plugin may mark them. */
export const RESERVED_BUILTIN_TOOLS: readonly string[] = ['read', 'write', 'edit', 'bash'];
const BUILTIN_SOURCE = 'plugin:builtin-tools';

/**
 * The core command namespace, per TUI spec §7: the commands that manage the shell rather than the
 * conversation. A plugin may not take one — the core set is what the palette and the resident's
 * dispatcher answer to, and a plugin command shadowing `/pause` would make the same word mean two
 * things depending on which layer saw it first.
 *
 * The last three are the spec's §7 addendum (Ryu 2026-11-12): they belong to F9 (#163) and F14
 * (#191) and are **not implemented this round**, so they are reserved but deliberately absent from
 * the palette (`tui/commands.ts`), which must never present an unimplemented command as available.
 */
export const RESERVED_CORE_COMMANDS: readonly string[] = [
  'soul',
  'memory',
  'commitments',
  'status',
  'context',
  'sleep',
  'dream',
  'help',
  'exit',
  'model',
  'pause',
  'resume',
  'why',
  'upgrade',
  'forget',
  'pin',
  'unpin',
];

export class ToolNameConflictError extends Error {
  readonly code = 'tool_name_conflict';
  constructor(readonly toolName: string, readonly existingSource: string, readonly nextSource: string, readonly existingBuiltin = false) {
    super(
      existingBuiltin
        ? `tool_name_conflict: "${toolName}" is a builtin tool and cannot be overridden (from ${nextSource})`
        : `tool_name_conflict: "${toolName}" is already registered by ${existingSource} (from ${nextSource})`,
    );
  }
}

export class ServiceConflictError extends Error {
  readonly code = 'service_conflict';
  constructor(readonly serviceName: string, readonly existingSource: string, readonly nextSource: string) {
    super(`service_conflict: "${serviceName}" is already provided by ${existingSource} (from ${nextSource})`);
  }
}

/**
 * A plugin command collided with the core namespace or with another plugin. `reservedCore` says which
 * rule fired, because the two mean different things to a reader: one is "the core owns this word",
 * the other is "someone already registered it".
 */
export class CommandNameConflictError extends Error {
  readonly code = 'command_name_conflict';
  constructor(readonly commandName: string, readonly existingSource: string, readonly nextSource: string, readonly reservedCore = false) {
    super(
      reservedCore
        ? `command_name_conflict: "${commandName}" is a core command and cannot be taken by ${nextSource}`
        : `command_name_conflict: "${commandName}" is already registered by ${existingSource} (from ${nextSource})`,
    );
  }
}

export class PluginDependencyError extends Error {
  readonly code = 'plugin_dependency_missing';
}

export class PluginCycleError extends Error {
  readonly code = 'plugin_dependency_cycle';
}

export interface ToolExecuteInput {
  toolCallId: string;
  args: any;
  signal?: AbortSignal;
  ctx: any;
}

/**
 * What a tool hands back: text is a successful result, the object names the error flag too (a bash
 * command that exited non-zero is an error even though it produced output — Pi's `isError`,
 * `bash.js:295-302`). The host stamps the ids and normalizes a missing flag to `false`.
 */
export interface ToolOutcome {
  output: string;
  isError?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: unknown;
  /**
   * Recovery policy for a call whose durable intent exists but whose outcome is unknown (Pi's
   * `AgentTool.replay`). The host defaults anything undeclared to `never`: a read is safe to repeat,
   * an effect is not, and a tool that knows it is idempotent says so.
   */
  replay?: 'never' | 'safe';
  execute(input: ToolExecuteInput): Promise<ToolResult | ToolOutcome | string> | ToolResult | ToolOutcome | string;
}

export interface RegisteredTool extends ToolDefinition {
  source: string;
  builtin: boolean;
  replay: 'never' | 'safe';
}

export interface CommandDefinition {
  name: string;
  description?: string;
  /** What the argument looks like; the palette shows it beside the command (spec §7). */
  argumentHint?: string;
  handler(args: string, ctx: any): Promise<string | void> | string | void;
}

export class ToolRegistry {
  private readonly registry = new Map<string, RegisteredTool>();

  register(definition: ToolDefinition, options: { source: string; builtin?: boolean }): RegisteredTool {
    const existing = this.registry.get(definition.name);
    if (existing) throw new ToolNameConflictError(definition.name, existing.source, options.source, existing.builtin);
    const wantsBuiltin = options.builtin === true;
    if (RESERVED_BUILTIN_TOOLS.includes(definition.name) && !wantsBuiltin) {
      throw new ToolNameConflictError(definition.name, 'builtin', options.source, true);
    }
    if (wantsBuiltin && options.source !== BUILTIN_SOURCE) {
      throw new Error(`builtin_flag_forbidden: "${definition.name}" from ${options.source} cannot claim to be a builtin`);
    }
    const registered: RegisteredTool = { ...definition, source: options.source, builtin: options.builtin === true, replay: definition.replay ?? 'never' };
    this.registry.set(definition.name, registered);
    return registered;
  }

  unregisterBySource(source: string): string[] {
    const removed: string[] = [];
    for (const [name, tool] of this.registry) {
      if (tool.source === source) {
        this.registry.delete(name);
        removed.push(name);
      }
    }
    return removed;
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  get(name: string): RegisteredTool | undefined {
    return this.registry.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.registry.values()];
  }

  async invoke(name: string, call: { toolCallId: string; input: unknown }, ctx: { runId: string; signal?: AbortSignal }): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      return { toolCallId: call.toolCallId, toolName: name, output: `unknown_tool: ${name} is not registered`, isError: true };
    }
    try {
      const raw = await tool.execute({ toolCallId: call.toolCallId, args: call.input, signal: ctx.signal, ctx });
      if (typeof raw === 'string') return { toolCallId: call.toolCallId, toolName: name, output: raw, isError: false };
      return { ...raw, toolCallId: call.toolCallId, toolName: name, isError: raw.isError === true };
    } catch (error) {
      return {
        toolCallId: call.toolCallId,
        toolName: name,
        output: `tool_error: ${error instanceof Error ? error.message : String(error)}`,
        isError: true,
      };
    }
  }
}

export class CommandRegistry {
  private readonly registry = new Map<string, CommandDefinition & { source: string }>();

  constructor(private readonly trace?: { append(kind: string, record?: Record<string, unknown>, now?: number): void }) {}

  register(definition: CommandDefinition, source: string): void {
    // The core check comes first: a core name is never free, whether or not anything registered it.
    if (RESERVED_CORE_COMMANDS.includes(definition.name)) {
      throw new CommandNameConflictError(definition.name, 'core', source, true);
    }
    if (this.registry.has(definition.name)) {
      throw new CommandNameConflictError(definition.name, this.registry.get(definition.name)!.source, source);
    }
    this.registry.set(definition.name, { ...definition, source });
  }

  unregisterBySource(source: string): void {
    for (const [name, command] of this.registry) if (command.source === source) this.registry.delete(name);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  list(): Array<CommandDefinition & { source: string }> {
    return [...this.registry.values()];
  }

  async run(name: string, args: string, ctx: any): Promise<string | undefined> {
    const command = this.registry.get(name);
    if (!command) return undefined;
    try {
      const result = await command.handler(args, ctx);
      return result ?? undefined;
    } catch (error) {
      // A handler that throws is attributed to its command name, in the receipt the caller prints
      // and in the trace. A bare rethrow here left only a nameless error at the transport layer.
      const message = error instanceof Error ? error.message : String(error);
      this.trace?.append('command_failed', { command: name, source: command.source, message });
      return `命令 /${name} 失败：${message}`;
    }
  }
}

export interface PluginContext {
  readonly pluginName: string;
  readonly config: unknown;
  readonly logger: { info(message: string, data?: unknown): void; warn(message: string, data?: unknown): void; error(message: string, data?: unknown): void };
  provide(name: string, value: unknown): void;
  inject(names: string[], callback: (ctx: PluginContext) => void): void;
  getService<T = unknown>(name: string): T;
  on(event: string, handler: BusHandler): () => void;
  registerTool(definition: ToolDefinition, options?: { builtin?: boolean }): RegisteredTool;
  registerCommand(definition: CommandDefinition): void;
  registerProvider(name: string, value: unknown): void;
  dispose(fn: () => void | Promise<void>): void;
}

export interface NativePlugin {
  name: string;
  inject?: string[];
  provide?: string[];
  apply(ctx: PluginContext, config: unknown): void | Promise<void> | (() => void);
}

interface PluginRecord {
  plugin: NativePlugin;
  config: unknown;
  status: 'registered' | 'started' | 'failed' | 'stopped';
  provided: string[];
  disposers: Array<() => void | Promise<void>>;
  unsubscribes: Array<() => void>;
  error?: string;
}

export interface PluginHostOptions {
  trace?: { append(kind: string, record?: Record<string, unknown>, now?: number): void };
}

export class PluginHost {
  readonly bus: EventBus;
  readonly tools = new ToolRegistry();
  readonly commands: CommandRegistry;
  readonly providers = new Map<string, unknown>();
  readonly plugins = new Map<string, PluginRecord>();
  private readonly services = new Map<string, { value: unknown; source: string }>();
  private readonly order: string[] = [];
  private started = false;

  constructor(private readonly options: PluginHostOptions = {}) {
    // The bus records a throwing handler (`bus_handler_failed`) against the plugin that owns it.
    this.bus = new EventBus({ trace: this.options.trace });
    // The trace is the command registry's too: a handler failure has to name its command in the
    // ledger, not only in the receipt the caller happens to print.
    this.commands = new CommandRegistry(this.options.trace);
  }

  /** Core services exist before any plugin starts; only the kernel connection and the shell are core. */
  seedService(name: string, value: unknown, source = 'core'): void {
    if (this.services.has(name)) throw new ServiceConflictError(name, this.services.get(name)!.source, source);
    this.services.set(name, { value, source });
  }

  hasService(name: string): boolean {
    return this.services.has(name);
  }

  getService<T = unknown>(name: string): T {
    const entry = this.services.get(name);
    if (!entry) throw new PluginDependencyError(`plugin_dependency_missing: service "${name}" is not provided`);
    return entry.value as T;
  }

  register(plugin: NativePlugin, config: unknown = {}): void {
    if (this.started) throw new Error('plugin_host_started: register plugins before start()');
    if (this.plugins.has(plugin.name)) throw new Error(`plugin_name_conflict: "${plugin.name}" is registered twice`);
    for (const name of plugin.provide ?? []) {
      const existing = this.findProvider(name);
      if (existing && existing !== plugin.name) throw new ServiceConflictError(name, existing, plugin.name);
    }
    this.plugins.set(plugin.name, { plugin, config, status: 'registered', provided: plugin.provide ?? [], disposers: [], unsubscribes: [] });
    this.order.push(plugin.name);
  }

  /**
   * The provider of a service name, ignoring plugins that were unloaded. A stopped plugin's declared
   * services are retired with it: looking one up must fail rather than name a dead plugin, and the
   * name has to be free for the next plugin that provides it.
   */
  private findProvider(service: string): string | undefined {
    for (const [name, record] of this.plugins) {
      if (record.status !== 'stopped' && record.provided.includes(service)) return name;
    }
    return undefined;
  }

  /** Dependency order, missing and cyclic dependencies refused by name. */
  private resolveOrder(): string[] {
    const ordered: string[] = [];
    const pending = new Set(this.order);
    while (pending.size > 0) {
      let progressed = false;
      for (const name of [...pending]) {
        const record = this.plugins.get(name)!;
        const injections = record.plugin.inject ?? [];
        const missing = injections.filter((service) => !this.services.has(service) && !this.findProvider(service));
        if (missing.length > 0) {
          throw new PluginDependencyError(
            `plugin_dependency_missing: plugin "${name}" injects ${missing.map((service) => `"${service}"`).join(', ')} which nothing provides`,
          );
        }
        const ready = injections.every((service) =>
          this.services.has(service) || ordered.some((done) => this.plugins.get(done)!.provided.includes(service)),
        );
        if (!ready) continue;
        ordered.push(name);
        pending.delete(name);
        progressed = true;
      }
      if (!progressed) throw new PluginCycleError(`plugin_dependency_cycle: ${[...pending].join(', ')}`);
    }
    return ordered;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const ordered = this.resolveOrder();
    for (const name of ordered) {
      const record = this.plugins.get(name)!;
      const ctx = this.contextFor(name, record);
      try {
        const disposer = await record.plugin.apply(ctx, record.config);
        if (typeof disposer === 'function') record.disposers.push(disposer);
        record.status = 'started';
        this.options.trace?.append('plugin_started', { name, provides: record.provided });
      } catch (error) {
        record.status = 'failed';
        record.error = error instanceof Error ? error.message : String(error);
        this.options.trace?.append('plugin_failed', { name, message: record.error });
        await this.stop();
        // A conflict is the host's own rule and keeps its type; anything else is wrapped with the
        // plugin name so the CLI can say who failed.
        if (error instanceof ServiceConflictError || error instanceof ToolNameConflictError || error instanceof CommandNameConflictError || error instanceof PluginDependencyError || error instanceof PluginCycleError) throw error;
        throw new Error(`plugin_failed: ${name}: ${record.error}`);
      }
    }
    this.started = true;
  }

  async stop(): Promise<void> {
    for (const name of [...this.order].reverse()) {
      const record = this.plugins.get(name);
      if (!record || record.status === 'stopped') continue;
      await this.unload(name);
    }
    this.started = false;
  }

  async unload(name: string): Promise<void> {
    const record = this.plugins.get(name);
    if (!record) return;
    for (const unsubscribe of record.unsubscribes.splice(0)) unsubscribe();
    this.tools.unregisterBySource(`plugin:${name}`);
    this.tools.unregisterBySource(`pi:${name}`);
    this.commands.unregisterBySource(`plugin:${name}`);
    this.commands.unregisterBySource(`pi:${name}`);
    for (const service of record.provided) {
      if (this.services.get(service)?.source === name) this.services.delete(service);
    }
    for (const disposer of record.disposers.splice(0).reverse()) await disposer();
    record.status = 'stopped';
  }

  private contextFor(name: string, record: PluginRecord): PluginContext {
    const host = this;
    const scoped = {
      get pluginName() {
        return name;
      },
      get config() {
        return record.config;
      },
      logger: {
        info: (message: string, data?: unknown) => this.options.trace?.append('plugin_log', { plugin: name, level: 'info', message, data }),
        warn: (message: string, data?: unknown) => this.options.trace?.append('plugin_log', { plugin: name, level: 'warn', message, data }),
        error: (message: string, data?: unknown) => {
          this.options.trace?.append('plugin_log', { plugin: name, level: 'error', message, data });
          console.error(`[companion-shell] plugin ${name}: ${message}`);
        },
      },
      provide(service: string, value: unknown) {
        if (host.services.has(service)) throw new ServiceConflictError(service, host.services.get(service)!.source, name);
        if (!record.provided.includes(service)) record.provided.push(service);
        host.services.set(service, { value, source: name });
      },
      inject(services: string[], callback: (ctx: PluginContext) => void) {
        for (const service of services) {
          if (!host.services.has(service)) throw new PluginDependencyError(`plugin_dependency_missing: plugin "${name}" injects "${service}" too early`);
        }
        callback(scoped as PluginContext);
      },
      getService<T = unknown>(service: string): T {
        return host.getService<T>(service);
      },
      on(event: string, handler: BusHandler) {
        const unsubscribe = host.bus.on(event, handler, `plugin:${name}`);
        record.unsubscribes.push(unsubscribe);
        return unsubscribe;
      },
      registerTool(definition: ToolDefinition, options?: { builtin?: boolean }) {
        return host.tools.register(definition, { source: `plugin:${name}`, builtin: options?.builtin === true });
      },
      registerCommand(definition: CommandDefinition) {
        try {
          host.commands.register(definition, `plugin:${name}`);
        } catch (error) {
          // Refusing the registration is the rule; the trace is so the refusal is not a silent drop.
          // The throw still travels, so a native plugin that named a core command fails loudly
          // instead of half-loading (the host's own conflict style, as with tool names).
          if (error instanceof CommandNameConflictError) {
            host.options.trace?.append('plugin_command_refused', {
              plugin: name,
              command: definition.name,
              reservedCore: error.reservedCore,
              existingSource: error.existingSource,
            });
          }
          throw error;
        }
      },
      registerProvider(providerName: string, value: unknown) {
        host.providers.set(providerName, value);
      },
      dispose(fn: () => void | Promise<void>) {
        record.disposers.push(fn);
      },
    };
    return scoped as unknown as PluginContext;
  }
}

