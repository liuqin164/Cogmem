/**
 * The Pi compatibility layer: one removable adapter that translates Pi's imperative extension
 * registration into the shell's single tool registry and event bus.
 *
 * Nothing in the core imports this module; `app.ts` reaches it with a dynamic import only when the
 * adapter is enabled and a plugin is configured. Deleting this directory leaves the shell and its
 * native plugins working, which is the acceptance test the guidance asks for.
 *
 * Scope is deliberate: tool/event/command/provider extensions are in. Anything that needs the TUI or
 * the session tree (`ui.select`, `registerVirtualModel`, MCP client registration, custom editors)
 * raises `PiCapabilityUnsupported`; the loader records the refusal and disables that plugin instead
 * of pretending. Rendering-only registrations (`registerMessageRenderer`, `registerShortcut`) are
 * dropped with a trace, because a headless process has no renderer and the plugin's channel/tool
 * behaviour is unaffected.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { PluginHost } from '../plugins/host.ts';
import { CommandNameConflictError } from '../plugins/host.ts';
import { PI_TARGET_VERSION } from './target.ts';
import { contentToText } from '../content.ts';

export class PiCapabilityUnsupported extends Error {
  readonly code = 'pi_capability_unsupported';
  constructor(readonly capability: string, detail: string) {
    super(`pi_capability_unsupported: ${capability}: ${detail}`);
  }
}

export class PiAdapterUnavailable extends Error {
  readonly code = 'pi_adapter_unavailable';
}

export interface PiAdapterOptions {
  host: PluginHost;
  pluginName: string;
  cwd: string;
  sessionId: string;
  settings?: Record<string, unknown>;
  systemPrompt?: () => string;
  isIdle?: () => boolean;
  hasPendingMessages?: () => boolean;
  abort?: () => void;
  onShutdown?: () => void;
  onSendMessage?: (input: { text: string; deliverAs: 'steer' | 'followUp' | 'nextTurn'; customType?: string; details?: unknown }) => void;
  trace?: { append(kind: string, record?: Record<string, unknown>, now?: number): void };
}

export interface PiLoadResult {
  pluginName: string;
  entry: string;
  /** The loaded package's own version, read from the package.json above the entry. */
  version: string;
  status: 'loaded' | 'refused';
  reason?: string;
  tools: string[];
  commands: string[];
  dropped: string[];
  refusedCapabilities: string[];
}

function normalizeDeliverAs(value: unknown): 'steer' | 'followUp' | 'nextTurn' {
  return value === 'steer' ? 'steer' : value === 'followUp' ? 'followUp' : 'nextTurn';
}

function normalizeToolResult(result: unknown): { output: string; isError: boolean } {
  const value = result as { content?: unknown; isError?: boolean; details?: unknown } | string | undefined;
  if (typeof value === 'string') return { output: value, isError: false };
  return { output: contentToText(value?.content), isError: value?.isError === true };
}

export class PiCompatAdapter {
  readonly dropped: string[] = [];
  readonly refused: string[] = [];
  readonly registeredTools: string[] = [];
  readonly registeredCommands: string[] = [];
  status: 'loaded' | 'refused' = 'loaded';
  reason?: string;

  constructor(private readonly options: PiAdapterOptions) {}

  async load(entry: string): Promise<PiLoadResult> {
    let factory: unknown;
    try {
      const module = (await import(entry)) as { default?: unknown };
      factory = module.default ?? module;
    } catch (error) {
      throw new PiAdapterUnavailable(`pi_plugin_import_failed: ${entry}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (typeof factory !== 'function') throw new PiAdapterUnavailable(`pi_plugin_not_a_factory: ${entry}`);
    try {
      await (factory as (api: unknown) => unknown)(this.api());
    } catch (error) {
      if (error instanceof PiCapabilityUnsupported) {
        this.status = 'refused';
        this.reason = error.message;
        this.refused.push(error.capability);
        this.options.trace?.append('pi_plugin_refused', { plugin: this.options.pluginName, capability: error.capability, reason: error.message });
        return this.result(entry);
      }
      throw error;
    }
    this.options.trace?.append('pi_plugin_loaded', {
      plugin: this.options.pluginName,
      entry,
      version: readPackageVersion(entry),
      target: PI_TARGET_VERSION,
      tools: this.registeredTools,
      commands: this.registeredCommands,
      dropped: this.dropped,
    });
    return this.result(entry);
  }

  /** Pi's own `session_start`; the core has no such state, so the adapter fires it after load. */
  async emitSessionStart(): Promise<void> {
    await this.options.host.bus.emit('session_start', { type: 'session_start' });
  }

  async emitSessionShutdown(): Promise<void> {
    await this.options.host.bus.emit('session_shutdown', { type: 'session_shutdown' });
  }

  private result(entry: string): PiLoadResult {
    return {
      pluginName: this.options.pluginName,
      entry,
      version: readPackageVersion(entry),
      status: this.status,
      reason: this.reason,
      tools: this.registeredTools,
      commands: this.registeredCommands,
      dropped: this.dropped,
      refusedCapabilities: this.refused,
    };
  }

  private api(): any {
    const adapter = this;
    const host = this.options.host;
    const settings = this.options.settings ?? {};
    const flags = new Map<string, unknown>();
    const events = {
      on(event: string, handler: (payload: unknown) => unknown) {
        return host.bus.on(`pi-event:${event}`, handler as never, `pi:${adapter.options.pluginName}`);
      },
      emit(event: string, payload?: unknown) {
        void host.bus.emit(`pi-event:${event}`, payload);
      },
    };
    return {
      on(event: string, handler: (...args: any[]) => unknown) {
        if (event === 'tool_call') {
          return host.bus.on('beforeToolCall', async (payload: any) => {
            const result = (await handler(adapter.piToolCallEvent(payload), adapter.extensionContext())) as { block?: boolean; reason?: string } | undefined;
            if (result?.block) return { block: true, reason: result.reason ?? 'blocked_by_pi_extension' };
            return undefined;
          }, `pi:${adapter.options.pluginName}`);
        }
        if (event === 'tool_result') {
          return host.bus.on('afterToolCall', async (payload: any) => {
            const result = (await handler(adapter.piToolResultEvent(payload), adapter.extensionContext())) as { content?: unknown; isError?: boolean } | undefined;
            if (result && (result.content !== undefined || result.isError !== undefined)) {
              return {
                result: {
                  ...payload.result,
                  output: result.content !== undefined ? contentToText(result.content) : payload.result.output,
                  isError: result.isError === true,
                },
              };
            }
            return undefined;
          }, `pi:${adapter.options.pluginName}`);
        }
        // Every other Pi event has the same name on the core bus. The Pi handler always receives the
        // extension context as its second argument, whatever the core bus passed as its own ctx.
        return host.bus.on(event, ((payload: any) => handler(payload, adapter.extensionContext())) as never, `pi:${adapter.options.pluginName}`);
      },
      registerTool(definition: any) {
        if (!definition || typeof definition.name !== 'string') throw new Error('pi_register_tool_invalid: missing name');
        const registered = host.tools.register(
          {
            name: definition.name,
            description: String(definition.description ?? ''),
            parameters: definition.parameters ?? { type: 'object', properties: {} },
            async execute({ toolCallId, args, signal }) {
              const raw = await definition.execute(toolCallId, args, signal, undefined, adapter.extensionContext());
              const normalized = normalizeToolResult(raw);
              return { toolCallId, toolName: definition.name, output: normalized.output, isError: normalized.isError };
            },
          },
          { source: `pi:${adapter.options.pluginName}` },
        );
        adapter.registeredTools.push(registered.name);
      },
      registerCommand(name: string, command: any) {
        try {
          host.commands.register({ name, description: command?.description, handler: (args) => command.handler(args, adapter.extensionContext()) }, `pi:${adapter.options.pluginName}`);
        } catch (error) {
          // A refused command does not take the extension down: Pi's own loader drops what it cannot
          // register and keeps the rest of the plugin, and a name collision is exactly that case. The
          // core namespace (spec §7) is never free, so the word stays the core's.
          if (error instanceof CommandNameConflictError) {
            adapter.options.trace?.append('pi_command_refused', {
              plugin: adapter.options.pluginName,
              command: name,
              reservedCore: error.reservedCore,
              existingSource: error.existingSource,
            });
            adapter.dropped.push(`command:${name}`);
            return;
          }
          throw error;
        }
        adapter.registeredCommands.push(name);
      },
      registerProvider(nameOrProvider: any, config?: any) {
        if (typeof nameOrProvider === 'string') host.providers.set(nameOrProvider, config);
        else host.providers.set(String(nameOrProvider?.id ?? nameOrProvider?.name ?? 'pi-provider'), nameOrProvider);
      },
      unregisterProvider(name: string) {
        host.providers.delete(name);
      },
      registerFlag(name: string, options: { default?: unknown }) {
        flags.set(name, options?.default);
      },
      getFlag(name: string) {
        return flags.get(name);
      },
      getSettings() {
        return settings;
      },
      getActiveTools() {
        return host.tools.list().map((tool) => tool.name);
      },
      getAllTools() {
        return host.tools.list().map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters, source: tool.source === 'builtin' ? 'builtin' : tool.source }));
      },
      setActiveTools() {
        // The shell's run always offers every registered tool; the cage whitelist is the filter. Say so
        // instead of pretending the plugin changed the loadout (COMPATIBILITY.md, dropped list).
        adapter.drop('setActiveTools', 'the cage whitelist decides the loadout');
      },
      sendMessage(message: any, options?: any) {
        const text = contentToText(message?.content ?? message);
        adapter.options.onSendMessage?.({ text, deliverAs: normalizeDeliverAs(options?.deliverAs), customType: message?.customType, details: message?.details });
      },
      sendUserMessage(content: unknown, options?: any) {
        const text = contentToText(content);
        adapter.options.onSendMessage?.({ text, deliverAs: normalizeDeliverAs(options?.deliverAs) });
      },
      appendEntry() {},
      setSessionName() {},
      getSessionName() {
        return adapter.options.pluginName;
      },
      setLabel() {},
      getCommands() {
        return host.commands.list().map((command) => ({ name: command.name, description: command.description }));
      },
      async exec(command: string, args: string[], execOptions?: { cwd?: string; timeout?: number }) {
        return execFile(command, args, execOptions?.cwd ?? adapter.options.cwd, execOptions?.timeout ?? 30_000);
      },
      registerMessageRenderer(customType: string) {
        adapter.drop('registerMessageRenderer', customType);
      },
      registerMarkdownTransformer() {
        adapter.drop('registerMarkdownTransformer');
      },
      registerEntryRenderer(customType: string) {
        adapter.drop('registerEntryRenderer', customType);
      },
      registerToolRenderer() {
        adapter.drop('registerToolRenderer');
      },
      registerShortcut(shortcut: string) {
        adapter.drop('registerShortcut', shortcut);
      },
      registerMcpServer() {
        adapter.refuse('registerMcpServer', 'the shell has no MCP client and serves no outward MCP face to add a server to');
      },
      unregisterMcpServer() {},
      getMcpServers() {
        return [];
      },
      registerVirtualModel() {
        adapter.refuse('registerVirtualModel', 'virtual models are a Pi routing feature; the shell has one mg provider');
      },
      unregisterVirtualModel() {},
      events,
    };
  }

  private drop(capability: string, detail?: string): void {
    const entry = detail ? `${capability}:${detail}` : capability;
    if (this.dropped.includes(entry)) return;
    this.dropped.push(entry);
    this.options.trace?.append('pi_capability_dropped', { plugin: this.options.pluginName, capability, detail, reason: 'headless_renderer_or_shortcut' });
  }

  /**
   * Every refusal is traced where it happens, so COMPATIBILITY.md's refused list is checkable against
   * the log rather than against a promise. A refusal thrown while the plugin loads is additionally
   * recorded as `pi_plugin_refused` by `load()` and disables the plugin; one thrown from a handler
   * only refuses that call, and the plugin keeps running (see the UI surface below).
   */
  private refuse(capability: string, detail: string): never {
    this.options.trace?.append('pi_capability_refused', { plugin: this.options.pluginName, capability, detail, reason: 'the companion shell does not implement it' });
    throw new PiCapabilityUnsupported(capability, detail);
  }

  private extensionContext(): any {
    const options = this.options;
    const theme = new Proxy(
      {},
      {
        get: () => (...args: unknown[]) => String(args[args.length - 1] ?? ''),
      },
    );
    const notify = (message: string, type?: string) => options.trace?.append('pi_ui_notify', { plugin: options.pluginName, message, type });
    const setStatus = (key: string, text?: string) => options.trace?.append('pi_ui_status', { plugin: options.pluginName, key, text });
    return {
      ui: {
        notify,
        setStatus,
        setWorkingMessage: () => {},
        setWorkingVisible: () => {},
        setWorkingIndicator: () => {},
        setHiddenThinkingLabel: () => {},
        setWidget: () => {},
        setFooter: () => {},
        setHeader: () => {},
        setTitle: () => {},
        getToolsExpanded: () => false,
        setToolsExpanded: () => {},
        getEditorText: () => '',
        setEditorText: () => {},
        pasteToEditor: () => {},
        addAutocompleteProvider: () => {},
        setEditorComponent: () => {},
        getEditorComponent: () => undefined,
        getAllThemes: () => [],
        getTheme: () => undefined,
        setTheme: () => ({ success: false, error: 'headless' }),
        theme,
        onTerminalInput: () => () => {},
        select: () => this.refuse('ui.select', 'headless resident process has no interactive user'),
        confirm: () => this.refuse('ui.confirm', 'headless resident process has no interactive user'),
        input: () => this.refuse('ui.input', 'headless resident process has no interactive user'),
        editor: () => this.refuse('ui.editor', 'headless resident process has no interactive user'),
        custom: () => this.refuse('ui.custom', 'headless resident process has no interactive user'),
      },
      mode: 'json',
      hasUI: false,
      cwd: options.cwd,
      sessionManager: {
        getSessionId: () => options.sessionId,
        // No session tree exists headlessly. `[]` keeps a plugin that tolerates an empty history
        // working (pi-web-access does), and the drop is recorded so a plugin that needs the tree is
        // not silently degraded.
        getEntries: () => {
          this.drop('sessionManager.getEntries', 'no session tree in a resident process');
          return [];
        },
        getBranch: () => {
          this.drop('sessionManager.getBranch', 'no session tree in a resident process');
          return [];
        },
        getEntry: () => undefined,
        getLabel: () => undefined,
        getSessionName: () => options.pluginName,
        getCwd: () => options.cwd,
      },
      modelRegistry: {},
      model: undefined,
      scopedModels: [],
      thinkingLevel: undefined,
      isIdle: () => options.isIdle?.() ?? true,
      isProjectTrusted: () => true,
      signal: undefined,
      abort: () => options.abort?.(),
      hasPendingMessages: () => options.hasPendingMessages?.() ?? false,
      shutdown: () => options.onShutdown?.(),
      getContextUsage: () => ({ tokens: null, contextWindow: 0, percent: null }),
      compact: () => {},
      getSystemPrompt: () => options.systemPrompt?.() ?? '',
    };
  }

  private piToolCallEvent(payload: any) {
    return { type: 'tool_call', toolCallId: payload.toolCallId, toolName: payload.toolName, input: payload.input };
  }

  private piToolResultEvent(payload: any) {
    return {
      type: 'tool_result',
      toolCallId: payload.toolCall?.toolCallId,
      toolName: payload.toolCall?.toolName,
      input: payload.toolCall?.input,
      content: [{ type: 'text', text: payload.result?.output ?? '' }],
      isError: payload.result?.isError === true,
      details: payload.result?.details,
    };
  }
}

function execFile(command: string, args: string[], cwd: string, timeout: number): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd, timeout });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ stdout, stderr, code: code ?? -1 }));
  });
}

/**
 * Resolve a Pi package or local extension path to the file Pi itself would load.
 *
 * A package declares its extension entry under the `pi` key; a directory falls back to
 * `index.ts`/`index.js`. Relative and absolute paths are taken as-is for the spike's real-plugin tests.
 */
export function resolvePiExtensionEntry(spec: string, cwd = process.cwd()): string {
  const candidates: string[] = [];
  if (spec.startsWith('.') || spec.startsWith('/')) {
    candidates.push(resolve(cwd, spec));
  } else {
    const require = createRequire(join(cwd, 'package.json'));
    let packageRoot: string | undefined;
    try {
      packageRoot = dirname(require.resolve(`${spec}/package.json`));
    } catch {
      try {
        let dir = dirname(require.resolve(spec));
        while (dir !== '/' && !existsSync(join(dir, 'package.json'))) dir = dirname(dir);
        packageRoot = existsSync(join(dir, 'package.json')) ? dir : undefined;
      } catch {
        packageRoot = undefined;
      }
    }
    if (packageRoot) {
      const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { pi?: { extensions?: string[] }; main?: string };
      const declared = manifest.pi?.extensions;
      if (Array.isArray(declared) && declared.length > 0) candidates.push(resolve(packageRoot, declared[0]));
      if (manifest.main) candidates.push(resolve(packageRoot, manifest.main));
    }
  }
  for (const candidate of candidates) {
    const entry = resolveEntryFile(candidate);
    if (entry) return entry;
  }
  throw new PiAdapterUnavailable(`pi_extension_not_found: ${spec}`);
}

/** The version of the nearest package.json above an extension entry, or `unknown`. */
export function readPackageVersion(entry: string): string {
  let dir = entry;
  for (let depth = 0; depth < 6; depth += 1) {
    dir = dirname(dir);
    const manifestPath = join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { version?: string };
        return manifest.version ?? 'unknown';
      } catch {
        return 'unknown';
      }
    }
  }
  return 'unknown';
}

function resolveEntryFile(candidate: string): string | undefined {
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  for (const name of ['index.ts', 'index.js', 'index.mjs']) {
    const file = join(candidate, name);
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  for (const name of ['dist/index.js', 'dist/index.ts']) {
    const file = join(candidate, name);
    if (existsSync(file) && statSync(file).isFile()) return file;
  }
  return undefined;
}
