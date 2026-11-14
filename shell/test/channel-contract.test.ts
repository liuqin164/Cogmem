import { describe, expect, test } from 'bun:test';
import { PassThrough } from 'node:stream';
import { ChannelContract, OccasionScope } from 'cogmem';
import { unknownCommandReply } from '../src/commands.ts';
import { TerminalChannel } from '../src/channels/terminal.ts';

function outputCollector() {
  let text = '';
  return {
    stream: {
      write(chunk: string | Uint8Array) {
        text += chunk.toString();
        return true;
      },
    } as NodeJS.WritableStream,
    text: () => text,
  };
}

function terminalWithContract() {
  const submitted: string[] = [];
  const output = outputCollector();
  const contract = new ChannelContract(new OccasionScope());
  const session = contract.register({
    channelId: 'terminal',
    occasion: 'private',
    accounts: [{ accountId: 'terminal-owner', role: 'owner' }],
    reachability: 'online',
    interruptibility: 'high',
  });
  const channel = new TerminalChannel({
    shell: {
      state: 'IDLE',
      async submit(text: string) {
        submitted.push(text);
        return undefined;
      },
      async runCommand(name: string) {
        return unknownCommandReply(name);
      },
    },
    input: new PassThrough(),
    output: output.stream,
    contract,
    session,
    accountId: 'terminal-owner',
  });
  return { channel, contract, session, submitted, output };
}

describe('the terminal channel consumes F12 strengths', () => {
  test('silence prints nothing; proactive and incidental print; offline silences', () => {
    const { channel, contract, session, output } = terminalWithContract();
    channel.start();
    try {
      const silent = channel.deliverSurfacing({
        candidateId: 'surfacing:profile:p1',
        strength: 'silence',
        text: '这条绝不能出站',
      });
      expect(silent?.outcome).toBe('silenced');
      expect(output.text()).toBe('');

      const proactive = channel.deliverSurfacing({
        candidateId: 'surfacing:profile:p1',
        strength: 'proactive',
        text: '主动提醒',
      });
      expect(proactive?.outcome).toBe('delivered');
      expect(output.text()).toContain('主动提醒');

      const beforeOffline = output.text();
      contract.presence(session, { reachability: 'offline', ownerActivity: 'away' });
      const offline = channel.deliverSurfacing({
        candidateId: 'surfacing:profile:p1',
        strength: 'proactive',
        text: '离线时不该出现',
      });
      expect(offline?.outcome).toBe('silenced');
      expect(output.text()).toBe(beforeOffline);

      contract.presence(session, { reachability: 'online', ownerActivity: 'active' });
      channel.deliverSurfacing({
        candidateId: 'surfacing:profile:p1',
        strength: 'incidental',
        text: '附带提及',
      });
      expect(output.text()).toContain('（想起）附带提及');
    } finally {
      channel.stop();
    }
  });

  test('a typed line enters through ingest and a slash line still reaches the command table', async () => {
    const { channel, submitted, output } = terminalWithContract();
    channel.start();
    try {
      await channel.handleLine('你好');
      expect(submitted).toEqual(['你好']);

      await channel.handleLine('/nope');
      expect(submitted).toEqual(['你好']);
      expect(output.text()).toContain('unknown command');
    } finally {
      channel.stop();
    }
  });
});
