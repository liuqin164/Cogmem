import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebSocketServer } from 'ws';
import { PluginHost } from '../src/plugins/host.ts';
import { PiCapabilityUnsupported, PiCompatAdapter, resolvePiExtensionEntry } from '../src/pi/adapter.ts';
import { PI_TARGET_PACKAGE, PI_TARGET_VERSION } from '../src/pi/target.ts';
import { TraceLog } from '../src/trace.ts';
import { makeTempDir } from './helpers.ts';

const shellRoot = join(import.meta.dir, '..');
const repoRoot = join(shellRoot, '..');

async function online(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(4_000) });
    return response.ok;
  } catch {
    return false;
  }
}

interface CapturedMessage {
  text: string;
  deliverAs: string;
  customType?: string;
}

const ianaUp = await online('https://www.iana.org/help/example-domains');

describe('Pi compatibility adapter', () => {
  test('the pinned target version is the installed one', () => {
    const manifest = JSON.parse(readFileSync(join(shellRoot, 'node_modules', PI_TARGET_PACKAGE, 'package.json'), 'utf8')) as { version: string };
    expect(manifest.version).toBe(PI_TARGET_VERSION);
  });

  test('the real plugin set is pinned by version in the test', () => {
    const toolPlugin = JSON.parse(readFileSync(join(shellRoot, 'node_modules', 'pi-web-access', 'package.json'), 'utf8')) as { version: string };
    const channelPlugin = JSON.parse(readFileSync(join(shellRoot, 'node_modules', '@lalalic', 'channel', 'package.json'), 'utf8')) as { version: string };
    expect(toolPlugin.version).toBe('0.47.0');
    expect(channelPlugin.version).toBe('1.0.6');
  });

  test.skipIf(!ianaUp)('a real tool plugin loads and one tool executes', async () => {
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({ host, pluginName: 'pi-web-access', cwd: shellRoot, sessionId: 's' });
    const result = await adapter.load(resolvePiExtensionEntry('pi-web-access', shellRoot));
    await adapter.emitSessionStart();
    expect(result.status).toBe('loaded');
    expect(result.version).toBe('0.47.0');
    expect(result.tools).toContain('fetch_content');
    expect(host.tools.has('fetch_content')).toBe(true);
    const output = await host.tools.invoke('fetch_content', { toolCallId: 't1', input: { url: 'https://www.iana.org/help/example-domains', mode: 'raw' } }, { runId: 'r' });
    expect(output.isError).toBe(false);
    expect(output.output.length).toBeGreaterThan(100);
  }, 60_000);

  test('a real channel plugin delivers an inbound message to the shell', async () => {
    const dir = makeTempDir('pi-channel-');
    const cwd = join(dir, 'agent');
    mkdirSync(join(cwd, '.pi'), { recursive: true });
    const server = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolvePromise) => server.once('listening', () => resolvePromise()));
    const port = (server.address() as { port: number }).port;
    writeFileSync(
      join(cwd, '.pi', 'settings.json'),
      JSON.stringify({
        channels: [{ id: 'wechat-main', name: 'Ryu', type: 'wechat', enabled: true, channel: 'Ryu', wechatDaemon: `ws://127.0.0.1:${port}`, default: true, forwardToolCalls: true }],
      }),
      'utf8',
    );
    const fakeBro = join(cwd, 'wechat-bro');
    writeFileSync(
      fakeBro,
      '#!/usr/bin/env bun\nlet buffer = "";\nprocess.stdin.on("data", (chunk) => { buffer += chunk; const index = buffer.indexOf("\\n"); if (index < 0) return; const request = JSON.parse(buffer.slice(0, index)); if (request.cmd === "status") console.log(JSON.stringify({ ok: true, data: { loggedIn: true } })); else console.log(JSON.stringify({ ok: true })); });\n',
      'utf8',
    );
    chmodSync(fakeBro, 0o755);

    const previousBin = process.env.WECHAT_BRO_BIN;
    process.env.WECHAT_BRO_BIN = fakeBro;
    const received: CapturedMessage[] = [];
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({
      host,
      pluginName: '@lalalic/channel',
      cwd,
      sessionId: 's',
      onSendMessage: (message) => received.push(message),
    });
    try {
      const result = await adapter.load(resolvePiExtensionEntry('@lalalic/channel', shellRoot));
      expect(result.status).toBe('loaded');
      expect(result.version).toBe('1.0.6');
      expect(result.dropped.some((entry) => entry.startsWith('registerMessageRenderer'))).toBe(true);
      await adapter.emitSessionStart();
      const client = await new Promise<any>((resolvePromise, rejectPromise) => {
        const timer = setTimeout(() => rejectPromise(new Error('channel plugin did not open its WebSocket')), 8_000);
        server.once('connection', (socket: any) => {
          clearTimeout(timer);
          resolvePromise(socket);
        });
      });
      client.send(JSON.stringify({ event: 'message:private', data: { from: 'Ryu', Content: 'hello from the channel', MsgId: 'm1', timestamp: Math.floor(Date.now() / 1000) } }));
      const started = Date.now();
      while (received.length === 0 && Date.now() - started < 8_000) await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
      expect(received.length).toBeGreaterThan(0);
      expect(received[0].text).toContain('hello from the channel');
      expect(received[0].text).toContain('<channel-ctx');
      expect(received[0].customType).toBe('channel-inbound');
      expect(received[0].deliverAs).toBe('followUp');
      await adapter.emitSessionShutdown();
    } finally {
      process.env.WECHAT_BRO_BIN = previousBin;
      await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    }
  }, 30_000);

  test('deleting the adapter leaves the shell and native plugins working', async () => {
    const dir = makeTempDir('pi-detach-');
    const copy = join(dir, 'shell');
    mkdirSync(copy, { recursive: true });
    cpSync(join(shellRoot, 'src'), join(copy, 'src'), { recursive: true });
    rmSync(join(copy, 'src', 'pi'), { recursive: true, force: true });
    expect(existsSync(join(copy, 'src', 'pi'))).toBe(false);
    symlinkSync(join(shellRoot, 'node_modules'), join(copy, 'node_modules'), 'dir');
    writeFileSync(join(copy, 'package.json'), JSON.stringify({ name: 'detached-shell', private: true, type: 'module' }), 'utf8');
    writeFileSync(
      join(copy, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          strict: true,
          skipLibCheck: true,
          types: ['bun-types'],
          baseUrl: '.',
          paths: { cogmem: [join(repoRoot, 'src', 'public.ts')], 'cogmem/internal': [join(repoRoot, 'src', 'internal.ts')] },
        },
        include: ['src/**/*.ts'],
      }),
      'utf8',
    );
    writeFileSync(
      join(copy, 'detach.ts'),
      [
        "import { CompanionShell } from './src/app.ts';",
        "import { mkdirSync } from 'node:fs';",
        'const dir = process.argv[2]!;',
        "const provider = { name: 'scripted', model: 'scripted/detached', async complete() { return { text: 'detached reply', toolCalls: [] }; } };",
        'const shell = new CompanionShell({',
        '  config: { workspaceRoot: dir, dataDir: dir + "/data", dbPath: dir + "/data/memory.sqlite", timeZone: "UTC", projectId: "detached", agentId: "detached-agent", sessionId: "s", terminalEnabled: false, http: { enabled: false, port: 0, hostname: "127.0.0.1" }, pi: { adapterEnabled: false, plugins: [] } },',
        '  modelProvider: provider,',
        '  tick: false,',
        '});',
        'await shell.start();',
        'const summary = await shell.submit("hello");',
        "console.log('REPLY:' + (summary?.assistantText ?? ''));",
        'await shell.stop();',
      ].join('\n'),
      'utf8',
    );
    const child = spawn('bun', [join(copy, 'detach.ts'), join(dir, 'ws')], { cwd: copy, env: { ...process.env, TMPDIR: join(shellRoot, '.tmp') } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const code = await new Promise<number | null>((resolvePromise) => child.once('exit', (exitCode) => resolvePromise(exitCode)));
    expect(stderr).toBe('');
    expect(code).toBe(0);
    expect(stdout).toContain('REPLY:detached reply');
  }, 60_000);

  test('the core has no static import of the adapter', () => {
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === 'pi') continue;
          walk(full);
        } else if (entry.name.endsWith('.ts')) files.push(full);
      }
    };
    walk(join(shellRoot, 'src'));
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source).not.toMatch(/from\s+['"][^'"]*pi\/adapter/);
    }
    expect(readFileSync(join(shellRoot, 'src', 'app.ts'), 'utf8')).toContain("await import('./pi/adapter.ts')");
  });

  test('a real command-type plugin loads, and its own handler runs against the shell', async () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({ host, pluginName: 'debug-provider', cwd: shellRoot, sessionId: 's', trace });
    const entry = resolvePiExtensionEntry(join(shellRoot, 'node_modules', PI_TARGET_PACKAGE, 'examples', 'extensions', 'debug-provider.ts'), shellRoot);
    const result = await adapter.load(entry);
    expect(result.status).toBe('loaded');
    // The example ships inside the pinned Pi package, so its version is the pin by construction.
    expect(result.version).toBe(PI_TARGET_VERSION);
    expect(result.commands).toContain('debug-provider');
    expect(result.tools).toEqual([]);
    expect(result.dropped.some((item) => item.startsWith('registerEntryRenderer'))).toBe(true);
    expect(trace.read().some((record) => record.kind === 'pi_capability_dropped' && record.capability === 'registerEntryRenderer')).toBe(true);
    for (const event of ['turn_start', 'provider_stream_event', 'message_end', 'turn_end']) {
      expect(host.bus.listenerCount(event), `${event} hook registered`).toBeGreaterThan(0);
    }
    await adapter.emitSessionStart();

    // The command is the plugin's own code, not a stub: `on` enables capture, an empty argument
    // toggles it back off, and both paths report through the shell's UI shim.
    await host.commands.run('debug-provider', 'on', {});
    await host.commands.run('debug-provider', '', {});
    const uiRecords = trace.read().filter((record) => record.kind === 'pi_ui_notify');
    expect(uiRecords.some((record) => String(record.message).includes('enabled'))).toBe(true);
    expect(uiRecords.some((record) => String(record.message).includes('disabled'))).toBe(true);
    expect(trace.read().some((record) => record.kind === 'pi_ui_status' && record.key === 'debug-provider')).toBe(true);
  }, 30_000);

  test('a plugin that registers an MCP server is refused at load, disabled, and traced', async () => {
    const dir = makeTempDir();
    const pluginDir = join(dir, 'refusing-plugin');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'index.ts'), 'export default function (pi: any) { pi.registerMcpServer("x", {}); }\n', 'utf8');
    const trace = new TraceLog(dir);
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({ host, pluginName: 'refusing-plugin', cwd: dir, sessionId: 's', trace });
    const result = await adapter.load(resolvePiExtensionEntry(pluginDir, dir));
    expect(result.status).toBe('refused');
    expect(result.refusedCapabilities).toEqual(['registerMcpServer']);
    const records = trace.read();
    expect(records.some((record) => record.kind === 'pi_capability_refused' && record.capability === 'registerMcpServer')).toBe(true);
    expect(records.some((record) => record.kind === 'pi_plugin_refused' && record.capability === 'registerMcpServer')).toBe(true);
  });

  // The refused and dropped boundaries are lists in COMPATIBILITY.md; each one is proved twice: the
  // doc names it, and exercising it writes the trace record that documents the degradation.
  const REFUSED_BOUNDARIES: Array<[string, (api: any, ctx: any) => void]> = [
    ['registerMcpServer', (api) => api.registerMcpServer()],
    ['registerVirtualModel', (api) => api.registerVirtualModel()],
    ['ui.select', (_api, ctx) => ctx.ui.select()],
    ['ui.confirm', (_api, ctx) => ctx.ui.confirm()],
    ['ui.input', (_api, ctx) => ctx.ui.input()],
    ['ui.editor', (_api, ctx) => ctx.ui.editor()],
    ['ui.custom', (_api, ctx) => ctx.ui.custom()],
  ];
  const DROPPED_BOUNDARIES: Array<[string, (api: any, ctx: any) => void]> = [
    ['registerMessageRenderer', (api) => api.registerMessageRenderer('probe')],
    ['registerEntryRenderer', (api) => api.registerEntryRenderer('probe')],
    ['registerToolRenderer', (api) => api.registerToolRenderer()],
    ['registerMarkdownTransformer', (api) => api.registerMarkdownTransformer()],
    ['registerShortcut', (api) => api.registerShortcut('probe')],
    ['sessionManager.getEntries', (_api, ctx) => ctx.sessionManager.getEntries()],
    ['sessionManager.getBranch', (_api, ctx) => ctx.sessionManager.getBranch()],
    ['setActiveTools', (api) => api.setActiveTools(['read'])],
  ];

  test('every boundary COMPATIBILITY.md names is traced when it is exercised', async () => {
    const dir = makeTempDir();
    const trace = new TraceLog(dir);
    const host = new PluginHost();
    host.seedService('eventBus', host.bus);
    const adapter = new PiCompatAdapter({ host, pluginName: 'boundary-probe', cwd: shellRoot, sessionId: 's', trace });
    const api = (adapter as unknown as { api(): any }).api();
    const ctx = (adapter as unknown as { extensionContext(): any }).extensionContext();
    const doc = readFileSync(join(shellRoot, 'COMPATIBILITY.md'), 'utf8');

    for (const [capability, trigger] of REFUSED_BOUNDARIES) {
      let thrown: unknown;
      try {
        trigger(api, ctx);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, capability).toBeInstanceOf(PiCapabilityUnsupported);
      expect(trace.read().some((record) => record.kind === 'pi_capability_refused' && record.capability === capability), `${capability} is traced`).toBe(true);
    }
    for (const [capability, trigger] of DROPPED_BOUNDARIES) {
      trigger(api, ctx);
      expect(trace.read().some((record) => record.kind === 'pi_capability_dropped' && record.capability === capability), `${capability} is traced`).toBe(true);
    }

    // Both directions, so neither the doc nor this test can grow a boundary alone: the doc's boundary
    // section names exactly the capabilities driven here.
    const boundarySection = doc.slice(doc.indexOf('## Refused or dropped'));
    const namedInDoc = (boundarySection.match(/`(?:ui\.[a-zA-Z]+|register[A-Z][A-Za-z]*|sessionManager\.[a-zA-Z]+|setActiveTools)`/g) ?? []).map((token) => token.slice(1, -1));
    const drivenHere = [...REFUSED_BOUNDARIES, ...DROPPED_BOUNDARIES].map(([capability]) => capability);
    expect([...namedInDoc].sort()).toEqual([...drivenHere].sort());
  });
});
