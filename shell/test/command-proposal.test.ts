/**
 * Command proposals (spec §7, #165 round 22): the agent hands the user a command to run and the user
 * decides. The discriminators are the three the round names — a `/pause` offer becomes an executable
 * element and only a confirmation runs it; a `/forget` offer is refused on the spot and traced; and
 * the execution entry refuses an unconfirmed proposal object outright.
 *
 * Red-first: this file was run against the tree before `src/proposals.ts`'s confirmation gate
 * existed (the gate temporarily removed) and the three tests below failed exactly where they should.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { AttachClient } from '../src/attach/client.ts';
import type { AttachServerMessage, AttachSnapshot } from '../src/attach/server.ts';
import { availableCoreCommand } from '../src/commands.ts';
import {
  CommandProposals,
  MAX_SETTLED_PROPOSALS,
  SETTLED_PROPOSAL_TTL_MS,
  executeProposal,
  type CommandProposal,
  type ProposalConfirmation,
} from '../src/proposals.ts';
import { TuiView, flattenEntry, type TranscriptEntry } from '../src/tui/view.ts';
import { defaultRenderEnv } from '../src/tui/frame.ts';
import { paletteCommands } from '../src/tui/commands.ts';
import { ScriptedProvider, makeShell, makeTempDir, recordEvents } from './helpers.ts';

const NO_DREAM = { windowStartHour: 0, windowEndHour: 0, runKernelNight: false, maxEpisodes: 5 };

function offering(command: string, reason: string, args = ''): ScriptedProvider {
  return new ScriptedProvider([
    { text: '', toolCalls: [{ toolCallId: 'c1', toolName: 'propose_command', input: { command, args, reason } }] },
    { text: '我把这个命令递给你。', toolCalls: [] },
  ]);
}

function proposalsIn(view: TuiView): Array<Extract<TranscriptEntry, { kind: 'proposal' }>> {
  return view.entries.filter((entry): entry is Extract<TranscriptEntry, { kind: 'proposal' }> => entry.kind === 'proposal');
}

function rendered(entry: TranscriptEntry, width = 80): string {
  return flattenEntry(entry, width, defaultRenderEnv({ TERM: 'dumb', LANG: 'C' } as NodeJS.ProcessEnv))
    .map((row) => row.map((segment) => segment.text).join(''))
    .join('\n');
}

function traceKinds(shell: ReturnType<typeof makeShell>, kind: string): Array<Record<string, unknown>> {
  return shell.trace.read().filter((record) => record.kind === kind);
}

describe('an agent-offered command is an executable element, not a message', () => {
  test('a /pause offer renders as a proposal; only the confirmation pauses; a second confirm is refused', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, offering('pause', '你刚说今天很累'), { dream: NO_DREAM });
    const events = recordEvents(shell.host.bus, ['companion_command_proposal']);
    await shell.start();
    try {
      await shell.submit('我累了');

      // The offer exists, is pending, and has not run anything.
      const pending = shell.currentProposals();
      expect(pending).toHaveLength(1);
      expect(pending[0].command).toBe('pause');
      expect(pending[0].reason).toBe('你刚说今天很累');
      expect(shell.capturePaused).toBe(false);
      const proposalId = pending[0].id;

      // It reaches the view as its own entry kind (the receipt family), not as assistant text.
      const view = new TuiView();
      for (const event of events) view.applyEvent({ name: event.name, payload: event.payload });
      const element = proposalsIn(view);
      expect(element).toHaveLength(1);
      expect(view.pendingProposal()?.proposal.id).toBe(proposalId);
      const text = rendered(element[0]);
      expect(text).toContain('提议 /pause');
      expect(text).toContain('你刚说今天很累');
      expect(text).toContain('Enter 执行');
      expect(text).toContain('尚未执行');
      // The assistant said nothing about a command in its own message; the offer is not a message.
      expect(view.entries.some((entry) => entry.kind === 'assistant' && entry.text.includes('/pause'))).toBe(false);

      // The confirmation is the only thing that runs it, and it runs through the same dispatch.
      const confirmed = await shell.confirmProposal(proposalId);
      expect(confirmed.ok).toBe(true);
      expect(shell.capturePaused).toBe(true);
      expect(traceKinds(shell, 'command_proposal_confirmed')).toHaveLength(1);
      expect(traceKinds(shell, 'command_proposal_executed')).toHaveLength(1);
      expect(traceKinds(shell, 'capture_paused_command')).toHaveLength(1);

      // One-shot: the same proposal cannot run a second time.
      const again = await shell.confirmProposal(proposalId);
      expect(again.ok).toBe(false);
      expect(again.reason).toBe('proposal_not_pending: executed');
      expect(traceKinds(shell, 'capture_paused_command')).toHaveLength(1);
      expect(traceKinds(shell, 'command_proposal_executed')).toHaveLength(1);

      // The element now reads as a settled receipt with the command's own answer.
      view.applyEvent({ name: 'companion_command_proposal', payload: { proposal: again.proposal } });
      expect(rendered(proposalsIn(view)[0])).toContain('已执行');
    } finally {
      await shell.stop();
    }
  });

  test('discarding an offer does nothing and can never be confirmed afterwards', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, offering('pause', '随便提一句'), { dream: NO_DREAM });
    await shell.start();
    try {
      await shell.submit('好');
      const id = shell.currentProposals()[0].id;
      const discarded = shell.discardProposal(id);
      expect(discarded?.status).toBe('discarded');
      expect(shell.capturePaused).toBe(false);
      expect(traceKinds(shell, 'command_proposal_discarded')).toHaveLength(1);

      const refused = await shell.confirmProposal(id);
      expect(refused.ok).toBe(false);
      expect(refused.reason).toBe('proposal_not_pending: discarded');
      expect(shell.capturePaused).toBe(false);
      expect(traceKinds(shell, 'capture_paused_command')).toHaveLength(0);
    } finally {
      await shell.stop();
    }
  });
});

describe('the availability table is shared with the panel (spec §7)', () => {
  test('a /forget offer is refused on the spot and traced, and nothing enters the pending state', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, offering('forget', '清掉这段'), { dream: NO_DREAM });
    const events = recordEvents(shell.host.bus, ['companion_command_proposal']);
    await shell.start();
    try {
      await shell.submit('把刚才那段忘了');
      expect(shell.currentProposals()).toHaveLength(0);
      const rejected = traceKinds(shell, 'command_proposal_rejected');
      expect(rejected).toHaveLength(1);
      expect(rejected[0].command).toBe('forget');
      expect(traceKinds(shell, 'command_proposed')).toHaveLength(0);
      // The refusal is visible too, so the user sees the agent tried and was told no.
      const view = new TuiView();
      for (const event of events) view.applyEvent({ name: event.name, payload: event.payload });
      expect(rendered(proposalsIn(view)[0])).toContain('已拒绝');
    } finally {
      await shell.stop();
    }
  });

  test('reserved-unimplemented names are unavailable on both faces, and /model waits for two routes', () => {
    for (const name of ['forget', 'pin', 'unpin']) {
      expect(availableCoreCommand(name, 'palette')).toBeUndefined();
      expect(availableCoreCommand(name, 'resident')).toBeUndefined();
      expect(paletteCommands(new TuiView()).some((command) => command.name === name)).toBe(false);
    }
    // Proposable iff the palette offers it, asked on the face a confirmation executes on.
    for (const name of ['pause', 'resume', 'sleep', 'status', 'why', 'help']) {
      expect(availableCoreCommand(name, 'resident')).toBeDefined();
      expect(availableCoreCommand(name, 'palette')).toBeDefined();
    }
    expect(availableCoreCommand('model', 'palette')).toBeUndefined();
    expect(availableCoreCommand('model', 'palette', { multipleRoutes: true })).toBeDefined();
  });

  test('a /model offer is refused while only one route exists', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, offering('model', '换个更快的模型'), { dream: NO_DREAM });
    await shell.start();
    try {
      await shell.submit('换模型');
      expect(shell.currentProposals()).toHaveLength(0);
      expect(traceKinds(shell, 'command_proposal_rejected')).toHaveLength(1);
    } finally {
      await shell.stop();
    }
  });
});

describe('the execution entry is gated on a user-confirmation event', () => {
  const deps = () => {
    const calls: Array<{ command: string; args: string }> = [];
    const traced: string[] = [];
    return {
      calls,
      traced,
      deps: {
        dispatch: async (command: string, args: string) => {
          calls.push({ command, args });
          return { text: 'ran' };
        },
        trace: { append: (kind: string) => void traced.push(kind) },
        now: () => 1_760_000_000_000,
      },
    };
  };

  function bare(status: CommandProposal['status'] = 'pending'): CommandProposal {
    return { id: 'proposal-x', command: 'pause', args: '', reason: 'test', status, createdAt: 1 };
  }

  test('a hand-built proposal with no confirmation is refused and never dispatches', async () => {
    const harness = deps();
    const outcome = await executeProposal(bare(), undefined, harness.deps);
    expect(outcome.ok).toBe(false);
    expect(outcome.reason).toBe('user_confirmation_required');
    expect(harness.calls).toHaveLength(0);
    expect(harness.traced).toContain('command_proposal_execution_refused');
  });

  test('a confirmation for another proposal, and an already-spent proposal, are both refused', async () => {
    const harness = deps();
    const wrong: ProposalConfirmation = { kind: 'user-confirm', proposalId: 'proposal-other', at: 2 };
    expect((await executeProposal(bare(), wrong, harness.deps)).reason).toBe('confirmation_id_mismatch');
    const spent = bare('executed');
    expect((await executeProposal(spent, { kind: 'user-confirm', proposalId: spent.id, at: 2 }, harness.deps)).reason).toBe('proposal_not_pending: executed');
    expect(harness.calls).toHaveLength(0);
  });

  test('the matching confirmation dispatches once and flips the latch', async () => {
    const harness = deps();
    const proposal = bare();
    const outcome = await executeProposal(proposal, { kind: 'user-confirm', proposalId: proposal.id, at: 2 }, harness.deps);
    expect(outcome.ok).toBe(true);
    expect(harness.calls).toEqual([{ command: 'pause', args: '' }]);
    expect(proposal.status).toBe('executed');
    expect(proposal.resultText).toBe('ran');
  });
});

describe('the user answer crosses the control socket', () => {
  test('a confirm sent by the TUI process runs the offer through the resident dispatcher', async () => {
    const dir = makeTempDir();
    const shell = makeShell(dir, offering('pause', '跨进程确认'), { dream: NO_DREAM, attach: { enabled: true } });
    await shell.start();
    try {
      await shell.submit('我累了');
      const id = shell.currentProposals()[0].id;
      const client = new AttachClient();
      const seen: AttachServerMessage[] = [];
      const snapshot: AttachSnapshot = await client.connect(join(dir, 'data', 'attach.sock'));
      client.onEvent = (message) => seen.push(message);
      // The offer survives the reconnect as a transcript element, pending.
      const mirrored = snapshot.entries.find((entry) => entry.kind === 'proposal');
      expect(mirrored?.kind === 'proposal' && mirrored.proposal.id).toBe(id);

      client.send({ t: 'command-confirm', id });
      const started = Date.now();
      const settled = () =>
        seen.some(
          (message) =>
            message.t === 'event' &&
            message.name === 'companion_command_proposal' &&
            (message.payload as { proposal?: { status?: string } }).proposal?.status === 'executed',
        );
      while (!settled()) {
        if (Date.now() - started > 5_000) throw new Error('timeout waiting for the confirmation');
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
      }
      expect(shell.capturePaused).toBe(true);
      client.close();
    } finally {
      await shell.stop();
    }
  });
});

/**
 * Round 23's retention discipline, at the registry level. Both tests inject the clock, so the TTL is
 * exercised without waiting, and both keep a pending offer alive across the sweep that must not
 * touch it — the "never executed, never discarded, never dropped" half of the rule.
 */
describe('settled proposals are retained under a bound (round 23)', () => {
  function registryAt(clock: { at: number }): CommandProposals {
    return new CommandProposals(() => true, { append: () => {} }, () => clock.at);
  }

  test('the cap drops the oldest settled entries and keeps every pending one', () => {
    const clock = { at: 1_000_000 };
    const registry = registryAt(clock);
    const waiting = registry.propose({ command: 'pause', reason: '还没回答' }).proposal;
    const settledIds: string[] = [];
    for (let index = 0; index < MAX_SETTLED_PROPOSALS + 5; index += 1) {
      clock.at += 1_000;
      const { proposal } = registry.propose({ command: 'status', reason: `第 ${index} 条` });
      registry.discard(proposal.id);
      settledIds.push(proposal.id);
    }

    const alive = settledIds.filter((id) => registry.get(id) !== undefined);
    expect(alive).toHaveLength(MAX_SETTLED_PROPOSALS);
    expect(alive[0]).toBe(settledIds[5]); // the five oldest settled entries are the ones that went
    expect(registry.get(settledIds.at(-1)!)).toBeDefined();
    // The pending offer predates all of them and is still exactly as it was.
    expect(registry.get(waiting.id)?.status).toBe('pending');
    expect(registry.pending()).toHaveLength(1);
  });

  test('a settled entry expires once its TTL passes, and the sweep can never touch a pending one', () => {
    const clock = { at: 2_000_000 };
    const registry = registryAt(clock);
    const old = registry.propose({ command: 'pause', reason: '很久以前' }).proposal;
    const waiting = registry.propose({ command: 'resume', reason: '没人回答' }).proposal;
    registry.discard(old.id);
    expect(registry.get(old.id)?.status).toBe('discarded');

    clock.at += SETTLED_PROPOSAL_TTL_MS + 1;
    // The lookup itself is the sweep: this is a late confirm asking about an old offer.
    expect(registry.get(old.id)).toBeUndefined();
    expect(registry.get(waiting.id)?.status).toBe('pending');
    expect(registry.pending()).toHaveLength(1);
  });
});
