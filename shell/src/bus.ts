/**
 * One event bus for the shell: Pi loop events, companion lifecycle events, and the hooks scheduled
 * on them. Handlers run strictly in registration order and are awaited one at a time; a handler may
 * return `{ block: true, reason }` and every later handler for that event is skipped.
 *
 * A serial bus is the contract the guidance names ("同事件钩子按注册序串行、任一拦截即拦截"). It is
 * also what makes a `beforeToolCall` whitelist a veto rather than a race.
 */
export type BusResult = void | {
  block?: boolean;
  stop?: boolean;
  terminate?: boolean;
  reason?: string;
  value?: unknown;
  [key: string]: unknown;
};

export type BusHandler = (payload: any, ctx: any) => unknown;

export class EventBus {
  private readonly handlers = new Map<string, Array<{ id: number; handler: BusHandler }>>();
  private nextId = 1;

  on(event: string, handler: BusHandler): () => void {
    const entry = { id: this.nextId++, handler };
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

  /** Serial emit; the first handler that blocks or stops ends the chain and its result is returned. */
  async emit(event: string, payload: any, ctx: any = {}): Promise<BusResult> {
    const list = this.handlers.get(event);
    if (!list || list.length === 0) return undefined;
    let last: BusResult = undefined;
    for (const { handler } of [...list]) {
      const result = (await handler(payload, ctx)) as BusResult;
      if (result === undefined || result === null) continue;
      last = result;
      if (result.block || result.stop || result.terminate) return result;
    }
    return last;
  }

  /**
   * The single context-rewrite pipeline. A handler returns a replacement value (or `{ value }`); the
   * next handler sees the replacement. Order is registration order, one pipeline, no side channels.
   */
  async pipeline(name: string, value: unknown, ctx: any = {}): Promise<unknown> {
    const list = this.handlers.get(name);
    if (!list || list.length === 0) return value;
    let current = value;
    for (const { handler } of [...list]) {
      const result = await handler(current, ctx);
      if (result === undefined || result === null) continue;
      if (typeof result === 'object' && 'value' in result) current = (result as { value: unknown }).value;
      else current = result;
    }
    return current;
  }
}
