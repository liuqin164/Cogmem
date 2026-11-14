/**
 * One event bus for the shell: Pi loop events, companion lifecycle events, and the hooks scheduled
 * on them. Handlers run strictly in registration order and are awaited one at a time; a handler may
 * return `{ block: true, reason }` and every later handler for that event is skipped.
 *
 * A serial bus is the contract the guidance names ("同事件钩子按注册序串行、任一拦截即拦截"). It is
 * also what makes a `beforeToolCall` whitelist a veto rather than a race.
 *
 * A handler that throws is the one exception to "the first block ends the chain": the failure is
 * recorded and the rest of the chain still runs. Pi's extension runner does the same
 * (`pi-coding-agent/dist/core/extensions/runner.js`, the `emit` catch) — one broken hook must not
 * take down the turn. The failed event's own action still fails closed (see `emit`).
 */
export type BusResult = void | {
  block?: boolean;
  stop?: boolean;
  terminate?: boolean;
  reason?: string;
  value?: unknown;
  /** A handler for this event threw; `reason` names the hook. Set by `emit`, read by the callers
   *  that own a boundary (`agent_end`/`agent_settled` report it as the run's error). */
  hookFailed?: boolean;
  [key: string]: unknown;
};

export type BusHandler = (payload: any, ctx: any) => unknown;

export interface BusTraceSink {
  append(kind: string, record?: Record<string, unknown>, now?: number): void;
}

export interface EventBusOptions {
  /** Where a throwing handler's `bus_handler_failed` record goes; absent in the loop's unit tests. */
  trace?: BusTraceSink;
}

export class EventBus {
  private readonly handlers = new Map<string, Array<{ id: number; handler: BusHandler; label?: string }>>();
  private nextId = 1;

  constructor(private readonly options: EventBusOptions = {}) {}

  /** `label` names the owner in a `bus_handler_failed` record (a plugin name, say). */
  on(event: string, handler: BusHandler, label?: string): () => void {
    const entry = { id: this.nextId++, handler, label };
    const list = this.handlers.get(event) ?? [];
    list.push(entry);
    this.handlers.set(event, list);
    return () => {
      const current = this.handlers.get(event);
      if (!current) return;
      const index = current.findIndex((item) => item.id === entry.id);
      if (index >= 0) current.splice(index, 1);
    };
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.length ?? 0;
  }

  /**
   * Serial emit; the first handler that blocks or stops ends the chain and its result is returned.
   * A handler that throws is recorded as `bus_handler_failed` and skipped, not propagated: the rest
   * of the chain runs, and the event's own action fails closed with a result naming the hook.
   */
  async emit(event: string, payload: any, ctx: any = {}): Promise<BusResult> {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return undefined;
    let last: BusResult = undefined;
    let failure: BusResult = undefined;
    for (const { handler, label } of [...list]) {
      let result: BusResult;
      try {
        result = (await handler(payload, ctx)) as BusResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.trace?.append('bus_handler_failed', { event, label, message });
        // `block: true` is what makes a throwing gate (`beforeToolCall`) fail the call closed; the
        // other callers ignore it. The first failure wins over a later plain result.
        failure ??= { block: true, reason: `hook_failed:${event}: ${message}`, hookFailed: true };
        continue;
      }
      if (result === undefined || result === null) continue;
      last = result;
      if (result.block || result.stop || result.terminate) return result;
    }
    return failure ?? last;
  }

  /**
   * The single context-rewrite pipeline. A handler returns a replacement value (or `{ value }`); the
   * next handler sees the replacement. Order is registration order, one pipeline, no side channels.
   */
  async pipeline(name: string, value: unknown, ctx: any = {}): Promise<unknown> {
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return value;
    let current = value;
    for (const { handler, label } of [...list]) {
      let result: unknown;
      try {
        result = await handler(current, ctx);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.options.trace?.append('bus_handler_failed', { event: name, label, message });
        continue;
      }
      if (result === undefined || result === null) continue;
      if (typeof result === 'object' && 'value' in result) current = (result as { value: unknown }).value;
      else current = result;
    }
    return current;
  }
}
