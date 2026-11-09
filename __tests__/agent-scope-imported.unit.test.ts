import { expect, test } from 'bun:test';
import { join } from 'node:path';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #143, route 1 (Ryu 2026-11-07): imported material is project-level public whatever `sourceAgent` says, while a
 * turn someone had stays with the agent that had it, and the project boundary is untouched.
 *
 * Two import markers are asserted separately, because they are two different paths and both are explicit facts of
 * the write rather than guesses about the text: the episode ingest path records the caller's `externalMessageId`,
 * and the CLI adapters write `metadata.imported`.
 */
function fixture() {
  const dir = makeTempDir('cogmem-agent-scope-imported-');
  const kernel = createMemoryKernel({ dbPath: join(dir, 'brain.db'), vectorBackend: 'sqlite-vec' });
  return { kernel, backend: new KernelAgentMemoryBackend(kernel) };
}

test('an episode imported by one agent is readable by another agent in the same project (#143)', async () => {
  const { kernel, backend } = fixture();
  try {
    await kernel.appendEpisodeMessageAsync({
      projectId: 'project-a', sessionId: 'ingest-1', sourceAgent: 'pi', role: 'user',
      text: 'Imported note: the deployment window is Tuesday.', externalMessageId: 'msg-1',
      metadata: { imported: true },
    });
    const other = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'deployment window Tuesday', limit: 5 });
    expect(other.items.map((item) => item.text).join(' ')).toContain('deployment window');
    // The project boundary is not what this rule moves: the same import stays invisible next door.
    const elsewhere = backend.recall({ agentId: 'hermes', projectId: 'project-b', query: 'deployment window Tuesday', limit: 5 });
    expect(elsewhere.items).toHaveLength(0);
  } finally {
    kernel.close();
  }
});

/**
 * #153: `externalMessageId` is the replay key, not an import marker.
 *
 * Reading it as an import made a turn somebody had project-public. Measured on the box before this
 * guard existed: the same write handed `hermes`'s appended turn to `pi`, and four Atlas candidates
 * with it; the build before the marker was widened handed over nothing.
 */
test('a turn one agent appended stays with that agent, message id and all (#153)', async () => {
  const { kernel, backend } = fixture();
  try {
    await kernel.appendEpisodeMessageAsync({
      projectId: 'project-a', sessionId: 'hermes-s1', sourceAgent: 'hermes', role: 'user',
      text: 'Private note: the on-call number is 010-8888-1234.', externalMessageId: 'hermes-own-msg-1',
    });
    const stranger = backend.recall({ agentId: 'pi', projectId: 'project-a', query: 'on-call number 010', limit: 5 });
    expect(stranger.items).toHaveLength(0);
    // The owner still reads its own turn: this is scoping, not withholding.
    const owner = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'on-call number 010', limit: 5 });
    expect(owner.items.map((item) => item.text).join(' ')).toContain('010-8888-1234');
  } finally {
    kernel.close();
  }
});

test('a CLI-imported record is readable by another agent, and an ordinary turn is not (#143)', async () => {
  const { kernel, backend } = fixture();
  const occurredAt = Date.UTC(2026, 0, 10);
  try {
    // The CLI adapters mark their rows this way (`src/bin/import-support.ts`).
    kernel.eventStore.append({
      eventId: 'evt-imported-md', streamId: 's-import', streamType: 'thread', eventType: 'MESSAGE',
      rawEventType: 'message', projectId: 'project-a', sessionId: 's-import', threadId: 's-import',
      localDate: '2026-01-10', role: 'user', occurredAt, sourceId: 'openclaw',
      payload: { text: 'Imported fact: the archiving retention period is seven years.', metadata: { imported: true, sourceAgent: 'openclaw' } },
    } as never);
    const imported = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'archiving retention period seven years', limit: 5 });
    expect(imported.items.map((item) => item.text).join(' ')).toContain('seven years');

    // Strict isolation, unchanged by the rule above: a turn hermes had is not pi's to read.
    await backend.rememberTurnWithResult({
      agentId: 'hermes', projectId: 'project-a', sessionId: 's-turn',
      userText: 'Private note: the migration rehearsal happens on Friday.', assistantText: 'Noted.',
      ingestMode: 'raw_archive_only',
    });
    const stranger = backend.recall({ agentId: 'pi', projectId: 'project-a', query: 'migration rehearsal Friday', limit: 5 });
    expect(stranger.items.map((item) => item.text).join(' ')).not.toContain('migration rehearsal');
    const owner = backend.recall({ agentId: 'hermes', projectId: 'project-a', query: 'migration rehearsal Friday', limit: 5 });
    expect(owner.items.map((item) => item.text).join(' ')).toContain('migration rehearsal');
  } finally {
    kernel.close();
  }
});
