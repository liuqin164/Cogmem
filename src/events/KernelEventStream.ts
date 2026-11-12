/**
 * The kernel's in-process event stream: what a resident shell subscribes to instead of polling.
 *
 * The contract this implements is written down in `docs/events.md` — the frozen type list, the
 * cursor semantics, the filter semantics and the error codes. The list below is the contract's first
 * section in code, and `__tests__/event-stream.contract.test.ts` asserts the two agree, so a type
 * added here without a line in the document (or the reverse) is red.
 *
 * Delivery is synchronous and a callback must not write to the kernel. The shell reads an event and
 * schedules work; a callback that appended inside its own delivery would re-enter `emit` while it is
 * still walking the buffer. That constraint is written in the contract too, in those words.
 */

/** Bump when the envelope, cursor, filter or error semantics change incompatibly. Adding a type does not. */
export const EVENT_CONTRACT_VERSION = 1;

/**
 * The frozen list of memory event types.
 *
 * `present here` means the type is defined, not that something emits it. Which producers are wired
 * and which are owned by a later ticket is the table in `docs/events.md`; `prospective-due` is F2's
 * and `candidate-pending` is F6's, and neither has a producer today.
 */
export const KERNEL_EVENT_TYPES = ['ledger-append', 'prospective-due', 'compile-done', 'candidate-pending'] as const;

export type KernelEventType = (typeof KERNEL_EVENT_TYPES)[number];

export interface KernelEvent {
  /** Monotonic within this stream, assigned by the stream and never by a producer. */
  cursor: number;
  type: KernelEventType;
  /** Wall-clock ms at which the producer observed the event. */
  at: number;
  projectId?: string;
  /**
   * Every agent the event is scoped to. Absent or empty means no agent owns it, which the scope rule
   * reads as project-public (#143) — so an empty list is not "nobody can see it".
   */
  agentIds?: string[];
  /** The topic the event belongs to, when the producer knows one. Most ledger rows know none. */
  topic?: string;
  /** Ids and counts only. The ledger's text stays in the ledger; this stream is not a second read path. */
  payload: Record<string, unknown>;
}

export interface KernelEventFilter {
  project?: string;
  agent?: string;
  topic?: string;
  /** Empty or absent means every type. An unknown type is `invalid_filter`, not an empty result. */
  types?: readonly KernelEventType[];
}

export type KernelEventStreamErrorCode = 'invalid_cursor' | 'cursor_expired' | 'invalid_filter';

/** The frozen error codes. `docs/events.md`'s table is compared against this list by the contract test. */
export const KERNEL_EVENT_STREAM_ERROR_CODES = ['invalid_cursor', 'cursor_expired', 'invalid_filter'] as const;

/**
 * The stream could not honour a subscription.
 *
 * `cursor_expired` means the stream cannot resume from that cursor at all: it has been evicted from
 * the buffer, or it is beyond this stream's head (a cursor from another process or a previous
 * lifetime). Recovery is the same either way — the events in the gap are not recoverable from here,
 * so the caller subscribes again with no `since` and starts at the head.
 */
export class KernelEventStreamError extends Error {
  readonly oldestCursor?: number;
  readonly headCursor?: number;

  constructor(
    readonly code: KernelEventStreamErrorCode,
    message: string,
    detail: { oldestCursor?: number; headCursor?: number } = {},
  ) {
    super(message);
    this.name = 'KernelEventStreamError';
    this.oldestCursor = detail.oldestCursor;
    this.headCursor = detail.headCursor;
  }
}

export interface KernelEventSubscription {
  /** The stream position consumed. Pass it back as `since` to resume without a gap and without a repeat. */
  readonly cursor: number;
  /** False after `unsubscribe()`, or after the callback threw and the subscriber was dropped. */
  readonly active: boolean;
  unsubscribe(): void;
}

/**
 * How many events are kept for reconnect replay. A cursor older than the buffer is `cursor_expired`;
 * the buffer is what "no events are lost across a reconnect" is bounded by, and the bound is stated
 * rather than implied.
 */
export const DEFAULT_EVENT_BUFFER_CAPACITY = 1024;

function matchesFilter(event: KernelEvent, filter: KernelEventFilter): boolean {
  if (filter.project !== undefined && event.projectId !== filter.project) return false;
  if (filter.agent !== undefined && !(event.agentIds ?? []).includes(filter.agent)) return false;
  if (filter.topic !== undefined && event.topic !== filter.topic) return false;
  if (filter.types && filter.types.length > 0 && !filter.types.includes(event.type)) return false;
  return true;
}

export class KernelEventStream {
  private readonly capacity: number;
  private readonly buffer: KernelEvent[] = [];
  private readonly listeners = new Set<(event: KernelEvent) => void>();
  private head = 0;

  constructor(options: { capacity?: number } = {}) {
    this.capacity = Math.max(1, Math.trunc(options.capacity ?? DEFAULT_EVENT_BUFFER_CAPACITY));
  }

  /** The highest cursor issued. Zero before the first event. */
  get headCursor(): number {
    return this.head;
  }

  /** The earliest cursor a subscriber can replay from. `head + 1` when nothing is buffered. */
  get oldestCursor(): number {
    return this.buffer[0]?.cursor ?? this.head + 1;
  }

  /**
   * Producers only. Assigns the cursor, appends to the replay buffer and delivers synchronously.
   *
   * A callback that throws is unsubscribed and its error is swallowed: the producer is mid-write and
   * a consumer's failure is not the ledger's. Every other subscriber still gets the event.
   */
  emit(input: Omit<KernelEvent, 'cursor'>): KernelEvent {
    const event: KernelEvent = { ...input, cursor: ++this.head };
    this.buffer.push(event);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        this.listeners.delete(listener);
      }
    }
    return event;
  }

  /**
   * Replay from `since` (exclusive) and then stream. Omit `since` to start live at the head.
   *
   * The replay and the live registration are one synchronous block on purpose: there is no await
   * between them, so no event can arrive in the seam and be lost or delivered twice.
   */
  subscribe(
    filter: KernelEventFilter,
    onEvent: (event: KernelEvent) => void,
    options: { since?: number } = {},
  ): KernelEventSubscription {
    this.assertFilter(filter);
    const since = options.since ?? this.head;
    this.assertResumable(since);

    let cursor = since;
    let active = true;
    const listeners = this.listeners;
    // Replay and live delivery share this one consumption path, so the cursor bookkeeping and the
    // filter cannot disagree between the two. `false` means the subscriber threw and is now dropped.
    const consume = (event: KernelEvent): boolean => {
      cursor = event.cursor;
      if (!matchesFilter(event, filter)) return true;
      try {
        onEvent(event);
        return true;
      } catch {
        active = false;
        listeners.delete(listener);
        return false;
      }
    };
    const listener = (event: KernelEvent) => {
      if (active) consume(event);
    };

    for (const event of [...this.buffer]) {
      if (event.cursor <= since) continue;
      if (!consume(event)) break;
    }
    if (active) this.listeners.add(listener);

    return {
      get cursor() {
        return cursor;
      },
      get active() {
        return active;
      },
      unsubscribe() {
        active = false;
        listeners.delete(listener);
      },
    };
  }

  private assertFilter(filter: KernelEventFilter): void {
    if (!filter.types || filter.types.length === 0) return;
    const known = KERNEL_EVENT_TYPES as readonly string[];
    const unknown = (filter.types as readonly string[]).filter((type) => !known.includes(type));
    if (unknown.length > 0) {
      throw new KernelEventStreamError('invalid_filter', `unknown event type(s): ${unknown.join(', ')}`);
    }
  }

  private assertResumable(since: number): void {
    if (!Number.isInteger(since) || since < 0) {
      throw new KernelEventStreamError('invalid_cursor', `since must be a non-negative integer, got ${String(since)}`);
    }
    if (since > this.head) {
      throw new KernelEventStreamError(
        'cursor_expired',
        `cursor ${since} is beyond this stream's head ${this.head}`,
        { oldestCursor: this.oldestCursor, headCursor: this.head },
      );
    }
    if (since < this.oldestCursor - 1) {
      throw new KernelEventStreamError(
        'cursor_expired',
        `cursor ${since} predates the oldest buffered event ${this.oldestCursor}`,
        { oldestCursor: this.oldestCursor, headCursor: this.head },
      );
    }
  }
}
