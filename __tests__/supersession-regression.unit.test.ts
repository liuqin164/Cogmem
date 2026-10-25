import { describe, expect, test } from 'bun:test';
import { createMemoryKernel } from '../src/factory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * Regression test for Issue #72: superseded value leakage in raw_evidence recall.
 *
 * The default recall path (rule_only mode) should not return superseded values
 * when a newer statement about the same canonical key exists. This test
 * verifies the fix for: stale value leaked ≤ 10%, current truth found ≥ 87.5%.
 */
describe('Issue #72: supersession detection in raw_evidence recall', () => {
  test('raw_evidence recall does not leak superseded value when newer statement exists', async () => {
    const dir = makeTempDir('cogmem-supersession-test-');
    const kernel = createMemoryKernel({ dbPath: `${dir}/memory.db` });
    const projectId = 'test-project';

    // Ingest a stale statement from agent bot-a
    await kernel.ingest({
      content: 'The deployment window for beacon is scheduled on day 3. Ticket OLD-123.',
      projectId,
      tags: ['agent:bot-a', 'turn-1'],
    });

    // Ingest a newer correction/superseding statement from same agent
    await kernel.ingest({
      content: 'Correction: the deployment window for beacon is now scheduled on day 17. Ticket NEW-456.',
      projectId,
      tags: ['agent:bot-a', 'turn-2'],
    });

    // Recall with a query that matches both statements
    const result = kernel.recall('When is the deployment window for beacon now scheduled?', {
      projectId,
      includeRawEvidence: true,
    });

    // Collect all text from rawEvidence and compiledMemory
    const allText = [
      ...result.rawEvidence.map((n) => n.content),
      ...result.compiledMemory.facts.map((f) => String(f.statement)),
      ...result.compiledMemory.events.map((e) => String(e.summary)),
    ].join('\n');

    // The current truth (NEW-456) should be found
    expect(allText).toContain('NEW-456');

    // The superseded value (OLD-123) should NOT appear in the returned context
    // This is the key assertion: stale value leaked should be false
    expect(allText).not.toContain('OLD-123');

    kernel.close();
  });

  test('different hostId statements do not supersede each other (#65 isolation)', async () => {
    const dir = makeTempDir('cogmem-supersession-isolation-');
    const kernel = createMemoryKernel({ dbPath: `${dir}/memory.db` });
    const projectId = 'shared-project';

    // Agent A states a fact
    await kernel.ingest({
      content: 'The deployment window for atlas is on day 5. Ticket A-100.',
      projectId,
      tags: ['agent:A', 'turn-1'],
    });

    // Agent B states a different fact about the same topic
    await kernel.ingest({
      content: 'The deployment window for atlas is on day 10. Ticket B-200.',
      projectId,
      tags: ['agent:B', 'turn-2'],
    });

    // Recall - both should be present since they're from different agents
    const result = kernel.recall('When is the deployment window for atlas?', {
      projectId,
      includeRawEvidence: true,
    });

    const allText = [
      ...result.rawEvidence.map((n) => n.content),
      ...result.compiledMemory.facts.map((f) => String(f.statement)),
      ...result.compiledMemory.events.map((e) => String(e.summary)),
    ].join('\n');

    // Both agents' statements should be present (no cross-agent supersession)
    expect(allText).toContain('A-100');
    expect(allText).toContain('B-200');

    kernel.close();
  });

  test('same hostId newer statement supersedes older one', async () => {
    const dir = makeTempDir('cogmem-same-agent-supersession-');
    const kernel = createMemoryKernel({ dbPath: `${dir}/memory.db` });
    const projectId = 'test-project';

    // Same agent states a fact
    await kernel.ingest({
      content: 'The backup vault rotation for cinder is scheduled on day 8. Ticket OLD-777.',
      projectId,
      tags: ['agent:bot-a', 'turn-1'],
    });

    // Same agent corrects it later
    await kernel.ingest({
      content: 'Correction: the backup vault rotation for cinder is now on day 22. Ticket NEW-888.',
      projectId,
      tags: ['agent:bot-a', 'turn-2'],
    });

    const result = kernel.recall('When is the backup vault rotation for cinder scheduled?', {
      projectId,
      includeRawEvidence: true,
    });

    const allText = [
      ...result.rawEvidence.map((n) => n.content),
      ...result.compiledMemory.facts.map((f) => String(f.statement)),
      ...result.compiledMemory.events.map((e) => String(e.summary)),
    ].join('\n');

    // Current truth should be found
    expect(allText).toContain('NEW-888');

    // Superseded value should not leak
    expect(allText).not.toContain('OLD-777');

    kernel.close();
  });
});