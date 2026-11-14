/**
 * The TuiApp's key-level action that is not editing: waking a dreaming resident. No socket and no
 * terminal — the attached client and the TTY streams are fakes, so this is the key mapping and the
 * state it leaves behind.
 */
import { describe, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { ReadStream, WriteStream } from 'node:tty';
import { AttachClient } from '../src/attach/client.ts';
import type { AttachSnapshot } from '../src/attach/server.ts';
import { TuiApp } from '../src/tui/app.ts';
import type { Lifecycle, TuiView, TranscriptEntry } from '../src/tui/view.ts';

class FakeInput extends EventEmitter {
  setRawMode(): void {}
  resume(): void {}
  pause(): void {}
}

class FakeOutput extends EventEmitter {
  columns = 100;
  rows = 30;
  write(): boolean {
    return true;
  }
}

interface Started {
  app: TuiApp;
  input: FakeInput;
  sent: unknown[];
  view: TuiView;
  exits: string[];
}

async function started(lifecycle: Lifecycle, entries: TranscriptEntry[] = []): Promise<Started> {
  const input = new FakeInput();
  const sent: unknown[] = [];
  const exits: string[] = [];
  const client = {
    send: (message: unknown) => void sent.push(message),
    close: () => {},
  } as unknown as AttachClient;
  const snapshot = { status: { lifecycle }, entries, queued: [], work: {}, commands: [] } as unknown as AttachSnapshot;
  const app = new TuiApp({
    socketPath: '/nonexistent/attach.sock',
    input: input as unknown as ReadStream,
    output: new FakeOutput() as unknown as WriteStream,
    env: { TERM: 'dumb', LANG: 'C' } as NodeJS.ProcessEnv,
    connect: async () => ({ client, snapshot }),
    onExit: (reason) => void exits.push(reason),
  });
  await app.start();
  return { app, input, sent, view: (app as unknown as { view: TuiView }).view, exits };
}

describe('the wake key on the sleep screen (#197)', () => {
  test('the first ordinary key sends wake, leaves DREAMING, and is not typed', async () => {
    const { app, input, sent, view } = await started('DREAMING');
    try {
      input.emit('data', 'x');
      expect(sent).toEqual([{ t: 'wake' }]);
      expect(view.lifecycle).toBe('WAKING');

      // The swallowed key is not in the input buffer: the next line is "hi", not "xhi".
      input.emit('data', 'hi\r');
      expect(sent).toEqual([{ t: 'wake' }, { t: 'submit', text: 'hi' }]);
    } finally {
      app.stop('test');
    }
  });

  test('Ctrl+C keeps its detach meaning during DREAMING and does not wake', async () => {
    const { app, input, sent, view, exits } = await started('DREAMING');
    try {
      input.emit('data', '\u0003');
      expect(sent).toEqual([]);
      expect(view.lifecycle).toBe('DREAMING');
      input.emit('data', '\u0003');
      expect(exits).toEqual(['ctrl_c']);
    } finally {
      app.stop('test');
    }
  });
});
