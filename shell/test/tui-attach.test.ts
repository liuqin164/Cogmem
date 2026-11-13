/**
 * §10 items 2, 3 and 6 over a real socket: `cog` is a separate process, so the test is a real client
 * against the resident's control socket, including an abrupt disconnection that must not take the
 * resident down.
 */
import { describe, expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { AttachClient } from '../src/attach/client.ts';
import type { AttachServerMessage, AttachSnapshot } from '../src/attach/server.ts';
import { openProbeSession } from '../src/install/attach.ts';
import { ScriptedProvider, makeShell, makeTempDir } from './helpers.ts';

const NO_DREAM = { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 };

function attachShell(dir: string, provider: ScriptedProvider, now?: () => number) {
  return makeShell(dir, provider, { attach: { enabled: true }, dream: NO_DREAM }, now ? { now } : {});
}

function socketPathOf(dir: string): string {
  return join(dir, 'data', 'attach.sock');
}

async function connect(path: string, events?: AttachServerMessage[]): Promise<{ client: AttachClient; snapshot: AttachSnapshot }> {
  const client = new AttachClient();
  const snapshot = await client.connect(path);
  if (events) client.onEvent = (message) => events.push(message);
  return { client, snapshot };
}

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
  }
}

/** A completed commitment has to exist in the kernel before the away report can read one back. */
async function seedCompletedCommitment(shell: ReturnType<typeof makeShell>, title: string): Promise<void> {
  const { agentId, projectId, sessionId } = shell.config;
  const first = await shell.backend.rememberTurnWithResult({
    agentId,
    projectId,
    sessionId,
    threadId: 'companion-day:2026-11-10',
    turnId: 'commitment-proposal',
    userText: '我们约好明天去看医生，别忘了',
    assistantText: '记下了：明天去看医生。',
    ingestMode: 'immediate_compile',
  });
  const second = await shell.backend.rememberTurnWithResult({
    agentId,
    projectId,
    sessionId,
    threadId: 'companion-day:2026-11-10',
    turnId: 'commitment-confirm',
    userText: '确认',
    assistantText: '好，我记住了。',
    ingestMode: 'immediate_compile',
  });
  const service = shell.kernel.prospectiveMemoryService;
  const proposed = service.propose({
    projectId,
    candidateType: 'commitment',
    canonicalKey: 'doctor-visit',
    title,
    evidenceEventIds: [first.rawEventIds[0]],
    proposedBy: 'deterministic',
  });
  service.resolve(proposed.candidateId, { action: 'confirm', confirmationEvidenceEventId: second.rawEventIds[0] }, projectId);
  service.resolve(proposed.candidateId, { action: 'complete' }, projectId);
}

describe('attach over the socket (spec §0, §6)', () => {
  test('the first attach gets a snapshot; a re-attach gets "你不在时" that matches the ledger', async () => {
    const base = Date.now();
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '在。', toolCalls: [] }]);
    const shell = attachShell(dir, provider, () => base);
    await shell.start();
    try {
      const socketPath = socketPathOf(dir);
      expect(statSync(socketPath).mode & 0o777).toBe(0o600);

      const first = await connect(socketPath);
      expect(first.snapshot.status.lifecycle).toBe('IDLE');
      expect(first.snapshot.status.name).toBe(shell.config.agentId);
      expect(first.snapshot.presence?.awaySince).toBeUndefined();
      first.client.close();
      await waitFor(() => shell.attachedClients === 0);

      // While nobody was attached: a night integration, a fulfilled commitment, an accumulated emergence.
      shell.trace.append('dream_complete', { localDate: '2026-11-10', eventCount: 7 });
      await shell.backend.ingestTaskEvent({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        workspaceId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        threadId: 'companion-dream:2026-11-10',
        taskId: 'dream-2026-11-10',
        title: '夜间整合 2026-11-10',
        content: '夜间整合 2026-11-10：当日共 7 条事件（用户 3、助手 3、工具 1、其它 0）。',
        metadata: { kind: 'dream-integration' },
      });
      await seedCompletedCommitment(shell, '明天去看医生');
      await shell.backend.rememberTurnWithResult({
        agentId: shell.config.agentId,
        projectId: shell.config.projectId,
        sessionId: shell.config.sessionId,
        turnId: 'low-1',
        userText: '我常去街角那家蓝色遮阳篷的面包店买可颂',
        assistantText: '记下了：蓝色遮阳篷的面包店。',
        ingestMode: 'immediate_compile',
      });
      shell.machine.updateRuntime({ lastInteractionText: '蓝色遮阳篷 面包店' });
      await shell.tick(base + 1_000);
      expect(shell.machine.runtime.awayQueue?.length).toBe(1);

      const second = await connect(socketPath);
      const report = second.snapshot.presence!;
      expect(report.awaySince).toBe(base);
      expect(report.dreams[0].localDate).toBe('2026-11-10');
      expect(report.dreams[0].summary).toContain('7 条事件');
      expect(report.emergence.some((item) => item.text.includes('面包店'))).toBe(true);

      // The broadcast's fulfilled commitment is the ledger row, by id and title.
      const ledger = shell.kernel.prospectiveMemoryService.list({ projectId: shell.config.projectId, statuses: ['completed'] });
      expect(ledger).toHaveLength(1);
      expect(report.commitments[0].candidateId).toBe(ledger[0].candidateId);
      expect(report.commitments[0].title).toBe(ledger[0].title);
      expect(report.commitments[0].status).toBe('completed');

      // The away queue is reported once, not on every later attach.
      expect(shell.machine.runtime.awayQueue ?? []).toHaveLength(0);
      second.client.close();
      await waitFor(() => shell.attachedClients === 0);
      const third = await connect(socketPath);
      expect(third.snapshot.presence?.emergence).toHaveLength(0);
      third.client.close();
    } finally {
      await shell.stop();
    }
  });
});

describe('TUI crash isolation (spec §9)', () => {
  test('an abruptly killed client leaves the resident running and attachable', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '我还在。', toolCalls: [] }]);
    const shell = attachShell(dir, provider);
    await shell.start();
    try {
      const socketPath = socketPathOf(dir);
      const { client } = await connect(socketPath);

      // A TUI that dies mid-read: the socket is destroyed with no detach message.
      (client as unknown as { socket?: { destroy(): void } }).socket?.destroy();
      await waitFor(() => shell.attachedClients === 0);

      // The resident is untouched: same state, still able to run a turn, still listening.
      expect(shell.state).toBe('IDLE');
      const summary = await shell.submit('还在吗');
      expect(summary?.assistantText).toBe('我还在。');
      const again = await connect(socketPath);
      expect(again.snapshot.status.name).toBe(shell.config.agentId);
      again.client.close();
    } finally {
      await shell.stop();
    }
  });
});

describe('steering over the wire (spec §10.2)', () => {
  test('a line sent during RUNNING queues, is visible, withdraws on Esc, and never reaches the model', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: '开始长任务', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'sleep 0.4; printf long-tool-done' } }] },
      { text: '继续。', toolCalls: [] },
    ]);
    const shell = attachShell(dir, provider);
    await shell.start();
    try {
      const events: AttachServerMessage[] = [];
      const { client } = await connect(socketPathOf(dir), events);
      client.send({ t: 'submit', text: '开始长任务' });
      await waitFor(() => shell.state === 'RUNNING');

      client.send({ t: 'submit', text: '顺便说一句，别忘了我喜欢蓝色' });
      await waitFor(() => shell.runtimeInstance?.pendingMessages === 1);
      await waitFor(() => events.some((message) => message.t === 'event' && message.name === 'companion_steering' && message.payload.queued.length === 1));

      client.send({ t: 'withdraw' });
      await waitFor(() => shell.runtimeInstance?.pendingMessages === 0);
      await waitFor(() => events.some((message) => message.t === 'event' && message.name === 'companion_steering' && message.payload.queued.length === 0));

      await waitFor(() => shell.state === 'IDLE');
      const requests = provider.calls.map((call) => call.messages.map((message) => message.content).join('\n'));
      expect(requests.join('\n')).not.toContain('别忘了我喜欢蓝色');
      client.close();
    } finally {
      await shell.stop();
    }
  });

  test('a line that is not withdrawn reaches the next turn', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([
      { text: '开始长任务', toolCalls: [{ toolCallId: 'c1', toolName: 'bash', input: { command: 'sleep 0.4; printf long-tool-done' } }] },
      { text: '顺手回了你刚才那句。', toolCalls: [] },
    ]);
    const shell = attachShell(dir, provider);
    await shell.start();
    try {
      const { client } = await connect(socketPathOf(dir));
      client.send({ t: 'submit', text: '开始长任务' });
      await waitFor(() => shell.state === 'RUNNING');
      client.send({ t: 'submit', text: '别忘了我喜欢蓝色' });
      await waitFor(() => shell.runtimeInstance?.pendingMessages === 1);
      await waitFor(() => shell.state === 'IDLE', 10_000);
      const injected = shell.trace.read().find((record) => record.kind === 'steering_injected');
      expect(injected?.count).toBe(1);
      expect(provider.calls[1].messages.map((message) => message.content).join('\n')).toContain('别忘了我喜欢蓝色');
      client.close();
    } finally {
      await shell.stop();
    }
  });
});

describe('sleep and wake (spec §0, §8)', () => {
  test('/sleep is DORMANT; closing the socket is not; a message wakes it back', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '我醒了。', toolCalls: [] }]);
    const shell = attachShell(dir, provider);
    await shell.start();
    try {
      const socketPath = socketPathOf(dir);
      const first = await connect(socketPath);
      first.client.send({ t: 'command', name: 'sleep' });
      await waitFor(() => shell.state === 'DORMANT');
      // Disconnecting from DORMANT does not change the state: the window closing is only a detach.
      first.client.close();
      await waitFor(() => shell.attachedClients === 0);
      expect(shell.state).toBe('DORMANT');

      const second = await connect(socketPath);
      expect(second.snapshot.status.lifecycle).toBe('DORMANT');
      second.client.send({ t: 'submit', text: '醒醒' });
      await waitFor(() => shell.state === 'IDLE');
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);
      expect(provider.calls).toHaveLength(1);
      expect(provider.calls[0].messages.map((message) => message.content)).toContain('醒醒');
      second.client.close();
    } finally {
      await shell.stop();
    }
  });

  test('a message during DREAMING wakes through the legal edge and is not lost', async () => {
    const dir = makeTempDir();
    const provider = new ScriptedProvider([{ text: '我醒了，先回你。', toolCalls: [] }]);
    const shell = attachShell(dir, provider);
    await shell.start();
    try {
      await shell.machine.dispatch('dream_window_open', { reason: 'test_dream' });
      expect(shell.state).toBe('DREAMING');

      const { snapshot, client } = await connect(socketPathOf(dir));
      expect(snapshot.status.lifecycle).toBe('DREAMING');

      client.send({ t: 'submit', text: '做梦时来消息了' });
      await waitFor(() => shell.state === 'IDLE');
      const kinds = shell.trace.read().filter((record) => record.kind === 'transition').map((record) => `${record.from}->${record.to}:${record.trigger}`);
      expect(kinds).toContain('DREAMING->WAKING:message_received');
      expect(kinds).toContain('WAKING->IDLE:context_injected');
      expect(shell.trace.read().some((record) => record.kind === 'illegal_transition')).toBe(false);
      // The waking message became the run's user text, and it reached the ledger.
      expect(provider.calls[0].messages.map((message) => message.content)).toContain('做梦时来消息了');
      const clock = shell.host.getService<{ localDate(at?: number): string }>('clock');
      const events = shell.kernel.getThreadEvents(`companion-day:${clock.localDate()}`, { projectId: shell.config.projectId, limit: 50 });
      expect(events.some((event) => JSON.stringify(event.payload).includes('做梦时来消息了'))).toBe(true);
      client.close();
    } finally {
      await shell.stop();
    }
  });
});

/**
 * The install's first-wake probe (#203) over a real socket: the installer is out of process, and the
 * resident must stay the only writer, so both halves go through the control channel the probe added.
 */
describe('the install first-wake probe (spec §0)', () => {
  test('remember then recall over the control socket, with the resident as the only writer', async () => {
    const dir = makeTempDir();
    const shell = attachShell(dir, new ScriptedProvider([{ text: 'unused', toolCalls: [] }]));
    await shell.start();
    try {
      const probe = await openProbeSession(socketPathOf(dir));
      try {
        const token = 'install-probe-test-token';
        const wrote = await probe.remember(`安装自检记忆：口令 ${token}，备用钥匙放在蓝色花盆下面。`, token);
        expect(wrote.ok).toBe(true);
        // The snapshot the resident sends first is not the reply; the probe matches its own message type.
        const recalled = await probe.recall(token);
        expect(recalled.ok).toBe(true);
        expect(recalled.text).toContain(token);
      } finally {
        probe.close();
      }
    } finally {
      await shell.stop();
    }
  }, 30_000);
});
