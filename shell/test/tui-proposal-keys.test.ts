/**
 * The TuiApp's key-level half of the proposal answer (spec §7, #165 round 23). Round 22 covered the
 * socket route (`command-confirm` / `command-discard` in `attach/server.ts`) and the view element,
 * but not the two lines in `TuiApp.handleKey` that decide which one a keystroke sends. Remove either
 * `client.send` there and one of these goes red.
 *
 * No socket and no terminal: the attached client and the TTY streams are fakes, so this is the key
 * mapping and nothing else.
 */
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ReadStream, WriteStream } from 'node:tty';
import { AttachClient } from '../src/attach/client.ts';
import type { AttachSnapshot } from '../src/attach/server.ts';
import type { CommandProposal } from '../src/proposals.ts';
import { TuiApp } from '../src/tui/app.ts';

class FakeInput extends EventEmitter {
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
}

class FakeOutput extends EventEmitter {
  columns = 120;
  rows = 40;
  write(): boolean {
    return true;
  }
}

const pending: CommandProposal = { id: 'proposal-key-1', command: 'pause', args: '', reason: '你刚说今天很累', status: 'pending', createdAt: 1 };

/** A started app whose attach snapshot already carries one pending proposal, with every send recorded. */
async function started(sent: unknown[]): Promise<{ app: TuiApp; input: FakeInput }> {
  const input = new FakeInput();
  const client = {
    send: (message: unknown) => void sent.push(message),
    close: () => {},
  } as unknown as AttachClient;
  const snapshot = {
    status: { lifecycle: 'IDLE' },
    entries: [{ kind: 'proposal', id: `proposal-${pending.id}`, proposal: pending }],
    queued: [],
    work: {},
    commands: [],
  } as unknown as AttachSnapshot;
  const app = new TuiApp({
    socketPath: '/nonexistent/attach.sock',
    input: input as unknown as ReadStream,
    output: new FakeOutput() as unknown as WriteStream,
    env: { TERM: 'dumb', LANG: 'C' } as NodeJS.ProcessEnv,
    connect: async () => ({ client, snapshot }),
  });
  await app.start();
  return { app, input };
}

describe('the TUI key that answers a proposal (round 23)', () => {
  test('Enter sends a confirm for the pending proposal', async () => {
    const sent: unknown[] = [];
    const { app, input } = await started(sent);
    try {
      input.emit('data', '\r');
      expect(sent).toEqual([{ t: 'command-confirm', id: pending.id }]);
    } finally {
      app.stop('test');
    }
  });

  test('a lone Esc sends a discard once the sequence window closes', async () => {
    const sent: unknown[] = [];
    const { app, input } = await started(sent);
    try {
      input.emit('data', '\u001b');
      expect(sent).toEqual([]); // a lone Esc waits to see whether an arrow key follows
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 80));
      expect(sent).toEqual([{ t: 'command-discard', id: pending.id }]);
    } finally {
      app.stop('test');
    }
  });
});
