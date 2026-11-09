import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

import type { Database } from 'bun:sqlite';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #136 §g, Ryu's second decision: the observatory shows one agent's view as *its own records plus the
 * project's public material* (#143 route 1). The discriminator is the acceptance point — A's private
 * entry appears in A's view and in the merged view, never in B's; imported material appears in both.
 *
 * The rule is not re-implemented here. `isAgentRawEvent` / `isImportedMaterial` are the same functions
 * the recall lanes call, which is the whole point of the test: agreement has to be structural, or the
 * two surfaces drift and this suite says everything is fine.
 */

const scratch = makeTempDir('cogmem-observatory-scope-');
const dbPath = join(scratch, 'memory.db');
let kernel: MemoryKernel;
let db: Database;
let observatory: MemoryObservatory;

const PROJECT = 'project-a';

function message(input: { id: string; sourceId?: string; agent?: string; imported?: boolean; day: number; text: string }): void {
  kernel.eventStore.append({
    eventId: input.id,
    streamId: `s-${input.id}`, streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message',
    projectId: PROJECT, sessionId: `s-${input.id}`, threadId: `s-${input.id}`, role: 'user',
    occurredAt: Date.UTC(2026, 0, input.day),
    ...(input.sourceId ? { sourceId: input.sourceId } : {}),
    payload: {
      text: input.text,
      metadata: {
        ...(input.agent ? { sourceAgent: input.agent } : {}),
        ...(input.imported ? { imported: true } : {}),
      },
    },
  } as never);
}

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  // hermes's own turn, pi's own turn, an imported record that names openclaw, and a record nobody owns.
  message({ id: 'evt-hermes-private', sourceId: 'hermes:s-1', agent: 'hermes', day: 10, text: 'hermes private: the on-call rotation is weekly' });
  message({ id: 'evt-pi-private', sourceId: 'pi:s-1', agent: 'pi', day: 11, text: 'pi private: the build cache lives on the second host' });
  message({ id: 'evt-imported', sourceId: 'openclaw', agent: 'openclaw', imported: true, day: 12, text: 'imported: the archiving retention period is seven years' });
  message({ id: 'evt-unowned', day: 13, text: 'a record written before anyone had an identity' });
  for (const [id, evidence, label] of [
    ['raw_event:evt-hermes-private', 'evt-hermes-private', 'on-call rotation'],
    ['raw_event:evt-pi-private', 'evt-pi-private', 'build cache host'],
    ['raw_event:evt-imported', 'evt-imported', 'retention seven years'],
    ['raw_event:evt-unowned', 'evt-unowned', 'pre-identity record'],
  ] as const) {
    kernel.memoryAtlasStore.upsertDocument({
      id, projectId: PROJECT, nodeType: 'raw_event', sourceId: label, label,
      confidence: 1, supportCount: 1, status: 'active', occurredAt: Date.UTC(2026, 0, 10),
      evidenceEventIds: [evidence],
    });
  }
  // A stored recall decision per agent, written the shape `RecallTraces` reads. The product has no
  // producer for these yet (#187); the fixture does, so the scope rules are still exercised.
  db = kernel.memoryAtlasStore.db;
  db.exec(`CREATE TABLE trace_events (
    id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, task_id TEXT, project_id TEXT,
    event_type TEXT NOT NULL, payload TEXT NOT NULL, parent_event_id TEXT)`);
  const insertTrace = db.prepare(`INSERT INTO trace_events (id, timestamp, task_id, project_id, event_type, payload, parent_event_id) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  insertTrace.run('trace-hermes', 1_700_000_000_000, 'task-hermes', PROJECT, 'recall.result', JSON.stringify({ query: 'hermes question', agentId: 'hermes' }), null);
  insertTrace.run('trace-pi', 1_700_000_100_000, 'task-pi', PROJECT, 'recall.result', JSON.stringify({ query: 'pi question', agentId: 'pi' }), null);
  insertTrace.run('trace-unowned', 1_700_000_200_000, 'task-unowned', PROJECT, 'recall.result', JSON.stringify({ query: 'nobody question' }), null);
  observatory = new MemoryObservatory({
    db,
    // The evidence-and-neighbour answer belongs to the atlas service; this suite is about scope.
    nodeDetail: (nodeId, projectId) => (observatory.snapshot({ projectId }).nodes.some((node) => node.id === nodeId)
      ? { id: nodeId, projectId, nodeType: 'raw_event', sourceId: nodeId, label: nodeId, confidence: 1, supportCount: 1, status: 'active', activation: 0, score: 0, evidenceCount: 0, evidenceTotal: 0, evidence: [], neighbors: [] }
      : null),
  });
});

afterAll(() => {
  kernel.close();
  rmSync(scratch, { recursive: true, force: true });
});

const idsFor = (agent: string | null) => observatory
  .snapshot({ projectId: PROJECT, agent: agent ?? undefined })
  .nodes.map((node) => node.id)
  .sort();

describe('one agent view is its own records plus the project public ones (#143, #136 §g)', () => {
  test("A's private entry is in A's view and the merged view, never in B's", () => {
    expect(idsFor('hermes')).toContain('raw_event:evt-hermes-private');
    expect(idsFor('hermes')).not.toContain('raw_event:evt-pi-private');
    expect(idsFor('pi')).toContain('raw_event:evt-pi-private');
    expect(idsFor('pi')).not.toContain('raw_event:evt-hermes-private');
    expect(idsFor(null)).toEqual([
      'raw_event:evt-hermes-private', 'raw_event:evt-imported', 'raw_event:evt-pi-private', 'raw_event:evt-unowned',
    ]);
  });

  test('imported material appears in A and in B; a record with no owner appears everywhere', () => {
    expect(idsFor('hermes')).toContain('raw_event:evt-imported');
    expect(idsFor('pi')).toContain('raw_event:evt-imported');
    expect(idsFor('hermes')).toContain('raw_event:evt-unowned');
    expect(idsFor('pi')).toContain('raw_event:evt-unowned');
  });

  test('the roster is the identities the corpus names, with per-identity counts', () => {
    const roster = observatory.snapshot({ projectId: PROJECT }).agents;
    const byId = Object.fromEntries(roster.map((agent) => [agent.id, agent]));
    expect(Object.keys(byId).sort()).toEqual(['hermes', 'openclaw', 'pi']);
    // Each identity sees its own record, the import, and the record nobody owns; openclaw has no
    // record of its own, so the import and the unowned row are its two.
    expect(byId.hermes!.nodes).toBe(3);
    expect(byId.pi!.nodes).toBe(3);
    expect(byId.openclaw!.nodes).toBe(2);
    expect(byId.hermes!.events).toBe(3);
    expect(byId.pi!.events).toBe(3);
    expect(byId.openclaw!.events).toBe(2);
  });

  test('the timeline filters by the same scope as the star map', () => {
    const all = observatory.timeline({ projectId: PROJECT }).histogram.totals.MESSAGE;
    const hers = observatory.timeline({ projectId: PROJECT, agent: 'hermes' }).histogram.totals.MESSAGE;
    const his = observatory.timeline({ projectId: PROJECT, agent: 'pi' }).histogram.totals.MESSAGE;
    expect(all).toBe(4);
    expect(hers).toBe(3);
    expect(his).toBe(3);
  });

  test('a node in another agent scope is refused, not served with a warning', () => {
    expect(observatory.node('raw_event:evt-hermes-private', { projectId: PROJECT, agent: 'pi' })).toBeNull();
    expect(observatory.node('raw_event:evt-hermes-private', { projectId: PROJECT, agent: 'hermes' })).not.toBeNull();
    expect(observatory.node('raw_event:evt-hermes-private', { projectId: PROJECT })?.visibleToAgent).toBe(true);
  });

  test('the timeline honours a date range instead of echoing it', () => {
    expect(observatory.timeline({ projectId: PROJECT }).histogram.totals.MESSAGE).toBe(4);
    expect(observatory.timeline({ projectId: PROJECT, from: '2026-01-11', to: '2026-01-11' }).histogram.totals.MESSAGE).toBe(1);
    expect(observatory.timeline({ projectId: PROJECT, from: '2026-01-13' }).histogram.totals.MESSAGE).toBe(1);
    expect(observatory.timeline({ projectId: PROJECT, from: '2026-02-01' }).histogram.totals.MESSAGE).toBeUndefined();
  });

  test('the recall list and one recall by id are filtered by the same scope', () => {
    const all = observatory.recalls({ projectId: PROJECT });
    expect(all.available).toBe(true);
    expect(all.recalls.map((recall) => recall.recallId).sort()).toEqual(['trace-hermes', 'trace-pi', 'trace-unowned']);
    const hers = observatory.recalls({ projectId: PROJECT, agent: 'hermes' });
    expect(hers.recalls.map((recall) => recall.recallId).sort()).toEqual(['trace-hermes', 'trace-unowned']);
    // An id the list hides must not open through the detail endpoint.
    expect(observatory.recall('trace-pi', { projectId: PROJECT, agent: 'hermes' })).toBeNull();
    expect(observatory.recall('trace-hermes', { projectId: PROJECT, agent: 'hermes' })?.recallId).toBe('trace-hermes');
    expect(observatory.recall('trace-pi', { projectId: PROJECT })?.recallId).toBe('trace-pi');
  });

  test('the merged view is the default when no agent is named', () => {
    const snapshot = observatory.snapshot({ projectId: PROJECT });
    expect(snapshot.agent).toBeNull();
    expect(snapshot.nodes).toHaveLength(4);
    const scoped = observatory.snapshot({ projectId: PROJECT, agent: 'hermes' });
    expect(scoped.agent).toBe('hermes');
    expect(scoped.nodes).toHaveLength(3);
    expect(scoped.counts.nodesTotal).toBe(4);
  });
});
