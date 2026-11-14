import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import type { Database } from 'bun:sqlite';

import { createMemoryKernel, type MemoryKernel } from '../src/factory.js';
import { MemoryObservatory } from '../src/observatory/MemoryObservatory.js';
import { makeTempDir } from './helpers/tmp.js';

/**
 * #204: the agent scope is applied to the whole project, then the star map's node budget.
 *
 * The fixture is the ticket's shape at a test-sized budget: six `pi` nodes fill the top five and a
 * `hermes` node sits outside it. The old read took the project's top N first and filtered the kept
 * rows afterwards, so hermes's map was empty and the roster said it owned nothing. The assertions
 * are the discriminator: hermes's node is present, its truncation is its own, and the roster counts
 * are per-view counts rather than survivors of the project's budget.
 */

const scratch = makeTempDir('cogmem-observatory-scope-limit-');
const dbPath = join(scratch, 'memory.db');
const PROJECT = 'project-limit';
const NODE_LIMIT = 5;
const T0 = Date.UTC(2026, 10, 13, 9, 0, 0);

let kernel: MemoryKernel;
let db: Database;
let observatory: MemoryObservatory;

function event(input: { id: string; sourceId: string; agent: string; day: number }): void {
  kernel.eventStore.append({
    eventId: input.id,
    streamId: `s-${input.id}`,
    streamType: 'thread',
    eventType: 'MESSAGE',
    rawEventType: 'message',
    projectId: PROJECT,
    sessionId: `s-${input.id}`,
    threadId: `s-${input.id}`,
    role: 'user',
    occurredAt: T0 + input.day * 1000,
    sourceId: input.sourceId,
    payload: { text: `evidence ${input.id}`, metadata: { sourceAgent: input.agent } },
  } as never);
}

beforeAll(() => {
  kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  event({ id: 'evt-pi', sourceId: 'pi:s', agent: 'pi', day: 10 });
  event({ id: 'evt-hermes', sourceId: 'hermes:s', agent: 'hermes', day: 1 });
  for (let i = 0; i < 6; i += 1) {
    kernel.memoryAtlasStore.upsertDocument({
      id: `raw_event:pi-${i}`,
      projectId: PROJECT,
      nodeType: 'raw_event',
      sourceId: `pi-${i}`,
      label: `pi node ${i}`,
      confidence: 1,
      supportCount: 10,
      status: 'active',
      occurredAt: T0 + 10_000 + i,
      evidenceEventIds: ['evt-pi'],
    });
  }
  kernel.memoryAtlasStore.upsertDocument({
    id: 'raw_event:hermes-target',
    projectId: PROJECT,
    nodeType: 'raw_event',
    sourceId: 'hermes-target',
    label: 'hermes target',
    confidence: 1,
    supportCount: 1,
    status: 'active',
    occurredAt: T0,
    evidenceEventIds: ['evt-hermes'],
  });
  db = kernel.memoryAtlasStore.db;
  observatory = new MemoryObservatory({
    db,
    nodeLimit: NODE_LIMIT,
    nodeDetail: (nodeId, projectId) => ({
      id: nodeId, projectId, nodeType: 'raw_event', sourceId: nodeId, label: nodeId,
      confidence: 1, supportCount: 1, status: 'active', activation: 0, score: 0,
      evidenceCount: 0, evidenceTotal: 0, evidence: [], neighbors: [],
    }),
  });
});

afterAll(() => {
  kernel.close();
});

describe('the agent view is filtered before the node budget (#204)', () => {
  test('a target agent node outside the project top N is still on its map', () => {
    const hermes = observatory.snapshot({ projectId: PROJECT, agent: 'hermes' });
    expect(hermes.nodes.map((node) => node.id)).toEqual(['raw_event:hermes-target']);
    // The project view is still the top N, so the fixture really does put the target outside it.
    expect(observatory.snapshot({ projectId: PROJECT }).nodes.map((node) => node.id)).not.toContain('raw_event:hermes-target');
  });

  test('truncation reports the view it belongs to, not the project it was borrowed from', () => {
    const hermes = observatory.snapshot({ projectId: PROJECT, agent: 'hermes' });
    expect(hermes.truncation).toBeNull();
    const pi = observatory.snapshot({ projectId: PROJECT, agent: 'pi' });
    expect(pi.truncation).toEqual({ limit: NODE_LIMIT, returned: 5, omitted: 1, byType: { raw_event: { total: 6, returned: 5 } } });
    const project = observatory.snapshot({ projectId: PROJECT });
    expect(project.truncation).toEqual({ limit: NODE_LIMIT, returned: 5, omitted: 2, byType: { raw_event: { total: 7, returned: 5 } } });
  });

  test('the roster counts each identity over the whole project, not over the survivors', () => {
    const roster = observatory.snapshot({ projectId: PROJECT }).agents;
    const byId = Object.fromEntries(roster.map((agent) => [agent.id, agent]));
    expect(byId.hermes!.nodes).toBe(1);
    expect(byId.pi!.nodes).toBe(6);
  });

  test('one node detail follows the same scope', () => {
    expect(observatory.node('raw_event:hermes-target', { projectId: PROJECT, agent: 'hermes' })).not.toBeNull();
    expect(observatory.node('raw_event:hermes-target', { projectId: PROJECT, agent: 'pi' })).toBeNull();
  });
});
