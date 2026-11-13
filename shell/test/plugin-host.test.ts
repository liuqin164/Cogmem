import { describe, expect, test } from 'bun:test';
import { EventBus } from '../src/bus.ts';
import {
  PluginDependencyError,
  PluginHost,
  ServiceConflictError,
  ToolNameConflictError,
  type NativePlugin,
} from '../src/plugins/host.ts';

describe('native plugin host (Cordis-style)', () => {
  test('provide/inject orders plugins and services are injected, not imported', async () => {
    const host = new PluginHost();
    const order: string[] = [];
    host.seedService('core', { from: 'core' });
    const a: NativePlugin = {
      name: 'a',
      provide: ['serviceA'],
      apply(ctx) {
        order.push('a');
        ctx.provide('serviceA', { value: 1 });
      },
    };
    const b: NativePlugin = {
      name: 'b',
      inject: ['serviceA', 'core'],
      apply(ctx) {
        order.push('b');
        ctx.inject(['serviceA', 'core'], (injected) => {
          order.push(`b-inject:${injected.getService<{ value: number }>('serviceA').value}`);
        });
      },
    };
    // Registered out of dependency order on purpose.
    host.register(b);
    host.register(a);
    await host.start();
    expect(order).toEqual(['a', 'b', 'b-inject:1']);
    expect(host.getService<{ from: string }>('core').from).toBe('core');
  });

  test('a missing dependency and a cycle are refused by name', async () => {
    const missing = new PluginHost();
    missing.register({ name: 'needs', inject: ['nope'], apply() {} });
    await expect(missing.start()).rejects.toBeInstanceOf(PluginDependencyError);

    const cyclic = new PluginHost();
    cyclic.register({ name: 'x', inject: ['yService'], provide: ['xService'], apply(ctx) { ctx.provide('xService', 1); } });
    cyclic.register({ name: 'y', inject: ['xService'], provide: ['yService'], apply(ctx) { ctx.provide('yService', 1); } });
    await expect(cyclic.start()).rejects.toThrow('plugin_dependency_cycle');
  });

  test('a duplicate service is a loud conflict', async () => {
    const host = new PluginHost();
    host.register({ name: 'one', provide: ['shared'], apply(ctx) { ctx.provide('shared', 1); } });
    expect(() => host.register({ name: 'two', provide: ['shared'], apply(ctx) { ctx.provide('shared', 2); } })).toThrow(ServiceConflictError);
    // The same conflict inside apply is refused too.
    const late = new PluginHost();
    late.register({ name: 'first', apply(ctx) { ctx.provide('shared', 1); } });
    late.register({ name: 'second', apply(ctx) { ctx.provide('shared', 2); } });
    await expect(late.start()).rejects.toBeInstanceOf(ServiceConflictError);
  });

  test('tool names register once; the builtin four cannot be overridden', async () => {
    const host = new PluginHost();
    host.register({
      name: 'builtins',
      apply(ctx) {
        const tool = ctx.registerTool({ name: 'bash', description: 'builtin bash', parameters: {}, execute: () => 'ok' });
        tool.builtin = true;
      },
    });
    host.register({
      name: 'impostor',
      apply(ctx) {
        ctx.registerTool({ name: 'bash', description: 'not the builtin', parameters: {}, execute: () => 'nope' });
      },
    });
    let error: unknown;
    try {
      await host.start();
    } catch (caught) {
      error = caught;
    }
    expect(String(error)).toContain('tool_name_conflict');
    expect(String(error)).toContain('builtin');
  });

  test('a plugin cannot register a reserved builtin name or claim the builtin flag', async () => {
    const host = new PluginHost();
    host.register({
      name: 'impostor-name',
      apply(ctx) {
        ctx.registerTool({ name: 'bash', description: 'not ours', parameters: {}, execute: () => 'x' });
      },
    });
    await expect(host.start()).rejects.toThrow('builtin');

    const flagHost = new PluginHost();
    flagHost.register({
      name: 'impostor-flag',
      apply(ctx) {
        ctx.registerTool({ name: 'harmless', description: 'x', parameters: {}, execute: () => 'x' }, { builtin: true });
      },
    });
    await expect(flagHost.start()).rejects.toThrow('builtin_flag_forbidden');
  });

  test('same-event hooks run in registration order; the first block ends the chain', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('beforeToolCall', () => {
      seen.push('first');
      return { block: true, reason: 'first says no' };
    });
    bus.on('beforeToolCall', () => {
      seen.push('second');
      return undefined;
    });
    const result = await bus.emit('beforeToolCall', {});
    expect(seen).toEqual(['first']);
    expect(result?.block).toBe(true);
    expect(result?.reason).toBe('first says no');
  });

  test('context rewrite is one ordered pipeline', async () => {
    const bus = new EventBus();
    bus.on('transformContext', (value: string) => `${value}-one`);
    bus.on('transformContext', (value: string) => ({ value: `${value}-two` }));
    expect(await bus.pipeline('transformContext', 'start')).toBe('start-one-two');
  });

  test('stop disposes in reverse and unload removes a plugin\'s tools and hooks', async () => {
    const host = new PluginHost();
    const order: string[] = [];
    host.register({
      name: 'p',
      apply(ctx) {
        ctx.registerTool({ name: 'temp_tool', description: 'x', parameters: {}, execute: () => 'x' });
        ctx.on('agent_start', () => {
          order.push('hook');
        });
        ctx.dispose(() => {
          order.push('disposed');
        });
      },
    });
    await host.start();
    expect(host.tools.has('temp_tool')).toBe(true);
    expect(host.bus.listenerCount('agent_start')).toBe(1);
    await host.unload('p');
    expect(host.tools.has('temp_tool')).toBe(false);
    expect(host.bus.listenerCount('agent_start')).toBe(0);
    expect(order).toContain('disposed');
  });

  test('an unloaded plugin holds no service name: the lookup refuses, the name is free again', async () => {
    const host = new PluginHost();
    const provided = { handle: 'live' };
    const injected: unknown[] = [];
    host.register({
      name: 'provider',
      provide: ['memory-x'],
      apply(ctx) {
        ctx.provide('memory-x', provided);
      },
    });
    host.register({
      name: 'consumer',
      inject: ['memory-x'],
      apply(ctx) {
        // The documented way a native plugin gets a service: one reference, handed over at start.
        ctx.inject(['memory-x'], (injectedCtx) => {
          injected.push(injectedCtx.getService('memory-x'));
        });
      },
    });
    await host.start();
    // The injected reference is the provider's own value, and the host serves that same object.
    expect(injected).toEqual([provided]);
    expect(host.getService('memory-x')).toBe(provided);

    await host.unload('provider');
    // The service is retired, not answered from a dead plugin's value...
    expect(host.hasService('memory-x')).toBe(false);
    expect(() => host.getService('memory-x')).toThrow(PluginDependencyError);
    // ...and the host no longer names the stopped plugin as its provider, so nothing dangles.
    const fresh = new PluginHost();
    fresh.register({ name: 'stopped-provider', provide: ['memory-x'], apply() {} });
    await fresh.unload('stopped-provider');
    expect(() => fresh.register({ name: 'replacement', provide: ['memory-x'], apply() {} })).not.toThrow();
  });
});
