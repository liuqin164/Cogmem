import { expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMemoryKernel } from '../src/factory.js';

const memoryBin = join(import.meta.dir, '..', 'src', 'bin', 'memory.ts');

async function run(args: string[]): Promise<Record<string, unknown>> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(stderr).toBe(''); expect(exitCode).toBe(0);
  return JSON.parse(stdout) as Record<string, unknown>;
}

async function runHuman(args: string[]): Promise<string> {
  const proc = Bun.spawn({ cmd: ['bun', memoryBin, ...args], stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  expect(stderr).toBe(''); expect(exitCode).toBe(0); return stdout;
}

test('memory graph CLI commands use the shared JSON contract and source drilldowns', async () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'cogmem-atlas-cli-')), 'memory.db');
  const kernel = createMemoryKernel({ dbPath });
  const event = kernel.eventStore.append({ eventId: 'evt-cli-hermes', streamId: 't', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message', projectId: 'cogmem', role: 'user', occurredAt: Date.UTC(2025, 3, 1), payload: { text: '给 Hermes 配置 MCP' } });
  const entity = kernel.memoryBindingStore.upsertEntity({ projectId: 'cogmem', canonicalName: 'Hermes', entityType: 'project' });
  kernel.memoryBindingStore.insertBinding({ eventId: event.eventId, projectId: 'cogmem', role: 'user', entityId: entity.entityId, entityName: 'Hermes', entityType: 'project', topicPath: 'cogmem/hermes', bindingType: 'about', confidence: 1, source: 'deterministic', signal: 'Hermes', claimKey: 'mcp' });
  const second = kernel.eventStore.append({ eventId: 'evt-cli-hermes-2', streamId: 't2', streamType: 'thread', eventType: 'MESSAGE', rawEventType: 'message', projectId: 'cogmem', role: 'user', occurredAt: Date.UTC(2025, 4, 1), payload: { text: '更新 Hermes 配置' } });
  kernel.memoryBindingStore.insertBinding({ eventId: second.eventId, projectId: 'cogmem', role: 'user', entityId: entity.entityId, entityName: 'Hermes', entityType: 'project', topicPath: 'cogmem/hermes', bindingType: 'about', confidence: 1, source: 'deterministic', signal: 'Hermes', claimKey: 'mcp-update' });
  kernel.close();

  const search = await run(['graph-search', '--query', 'Hermes', '--project', 'cogmem', '--db', dbPath, '--json']);
  expect(search.schemaVersion).toBe('cogmem.cli.v1');
  expect(search.command).toBe('memory.graph-search');
  const searchNode = (search.nodes as Array<Record<string, any>>).find((node) => node.label === 'Hermes');
  expect(searchNode).toBeDefined();
  expect(searchNode?.evidenceReturned).toBeGreaterThanOrEqual(1);
  expect(searchNode?.evidence[0].sourceLocator.command).toContain('cogmem memory show --event evt-cli-hermes');
  expect(searchNode?.evidence[0].sourceLocator.command).toContain('--project cogmem');
  expect(searchNode?.evidence[0].sourceLocator.command).toContain('--json');
  expect(searchNode?.evidence[0].sourceLocator.contextCommand).toContain('--before 3 --after 3 --json');

  const node = await run(['graph-node', '--id', `entity:${entity.entityId}`, '--project', 'cogmem', '--db', dbPath, '--json']);
  expect(((node.evidence as Array<Record<string, unknown>>)[0]?.drilldown as string)).toContain('memory show --event evt-cli-hermes');

  const human = await runHuman(['graph-node', '--id', `entity:${entity.entityId}`, '--project', 'cogmem', '--db', dbPath]);
  expect(human).toContain('Hermes');
  expect(human).toContain('cogmem memory show --event evt-cli-hermes');

  const boundedNode = await run(['graph-node', '--id', `entity:${entity.entityId}`, '--evidence-limit', '1', '--project', 'cogmem', '--db', dbPath, '--json']);
  expect((boundedNode.evidence as unknown[])).toHaveLength(1);

  const timeline = await run(['graph-timeline', '--query', '去年 Hermes 操作', '--now', String(Date.UTC(2026, 4, 1)),
    '--evidence-limit', '1', '--project', 'cogmem', '--db', dbPath, '--json']);
  expect(timeline.range).toEqual(expect.objectContaining({ label: '2025' }));
  expect((timeline.actions as Array<{ evidence: unknown[] }>).every((action) => action.evidence.length <= 1)).toBe(true);
});
