import { expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { KernelAgentMemoryBackend } from '../src/agent/AgentMemoryBackend.js';
import { createMemoryKernel } from '../src/factory.js';
import { callCogmemMcpTool } from '../src/mcp/CoreMcpTools.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const memoryBin = join(coreRoot, 'src/bin/memory.ts');

test('collection routing keeps Theseus creative memory out of default agent recall', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-collection-routing-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-creative',
    collection: 'theseus',
    userText: 'Theseus draft: MoneyPrinterTurbo should become a cinematic short-video prompt library.',
    assistantText: 'Store this as a creative artifact, not default operational memory.',
    ingestMode: 'raw_archive_only',
  });
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-anchor',
    collection: 'anchor',
    userText: 'Anchor decision: MoneyPrinterTurbo recall must keep raw ledger fallback available.',
    assistantText: 'Store this in default operational memory.',
    ingestMode: 'raw_archive_only',
  });

  const defaultRecall = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'MoneyPrinterTurbo',
    limit: 5,
  });
  const theseusRecall = backend.recall({
    agentId: 'openclaw',
    projectId: 'demo',
    collection: 'theseus',
    query: 'MoneyPrinterTurbo cinematic',
    limit: 5,
  });

  expect(defaultRecall.items.some((item) => item.text.includes('cinematic short-video prompt'))).toBe(false);
  expect(defaultRecall.items.some((item) => item.text.includes('raw ledger fallback'))).toBe(true);
  expect(theseusRecall.items.some((item) => item.text.includes('cinematic short-video prompt'))).toBe(true);

  kernel.close();
});

test('recall pack combines direct recall with activation, belief, and entity touches', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-recall-pack-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  const direct = await kernel.ingest({
    projectId: 'demo',
    content: 'MoneyPrinterTurbo uses a durable raw ledger fallback when vectors are empty.',
    tags: ['agent:openclaw', 'collection:anchor'],
  });
  const neighbor = await kernel.ingest({
    projectId: 'demo',
    content: 'Maintenance docs should mention the downstream smoke test receipt.',
    tags: ['agent:openclaw', 'collection:anchor'],
  });
  kernel.memoryGraph.addSynapse(direct.id, { targetId: neighbor.id, type: 'Referenced', weight: 0.9 });
  kernel.entityStore.upsertEntity({
    canonicalName: 'MoneyPrinterTurbo',
    type: 'project',
    aliases: ['MPT'],
    createdFrom: direct.id,
    metadata: { projectId: 'demo' },
  });
  kernel.entityStore.recordMention({
    entityId: kernel.entityStore.findByAlias('MoneyPrinterTurbo')!.entityId,
    neuronId: direct.id,
    projectId: 'demo',
    mentionType: 'declared',
  });
  kernel.beliefStore.upsert({
    projectId: 'demo',
    scope: 'project',
    subject: 'MoneyPrinterTurbo',
    predicate: 'constraint',
    objectValue: { raw: 'Keep raw ledger fallback available.', normalized: 'keep_raw_ledger_fallback', type: 'string' },
    confidence: 0.91,
    sourceNeuronId: direct.id,
    sourceType: 'user_input',
    explanation: 'User requested fallback parity.',
    extractionReason: 'decision_statement',
  });

  const pack = backend.recallPack({
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'MoneyPrinterTurbo fallback',
    limit: 3,
  });

  expect(pack.items.some((item) => item.text.includes('raw ledger fallback'))).toBe(true);
  expect(pack.slots.direct.length).toBeGreaterThan(0);
  expect(pack.slots.associative.some((item) => item.text.includes('downstream smoke test'))).toBe(true);
  expect(pack.slots.entityCards.some((card) => card.canonicalName === 'MoneyPrinterTurbo')).toBe(true);
  expect(pack.slots.beliefTouches.some((belief) => belief.subject === 'MoneyPrinterTurbo')).toBe(true);
  expect(pack.chargeVector.direct).toBeGreaterThan(0);
  expect(pack.chargeVector.associative).toBeGreaterThan(0);

  kernel.close();
});

test('memory self map exposes anatomy, data lanes, bounds, and manual commands', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-memory-map-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });

  const map = kernel.buildMemoryMap({ projectId: 'demo' });

  expect(map.projectId).toBe('demo');
  expect(map.anatomy.some((section) => section.id === 'raw_ledger')).toBe(true);
  expect(map.dataLanes.some((lane) => lane.id === 'collection_routing')).toBe(true);
  expect(map.bounds.some((bound) => bound.includes('no hidden daemon'))).toBe(true);
  expect(map.manual.commands).toContain('cogmem memory map --project <id> --json');
  expect(map.manual.commands).toContain('cogmem memory tick --project <id> --json');

  kernel.close();
});

test('maintenance tick reports host-owned charge without running a hidden daemon', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-maintenance-tick-'));
  const kernel = createMemoryKernel({ dbPath: join(dir, 'memory.db'), vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);

  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-maintenance',
    userText: 'Raw event waiting for Dream Curator promotion.',
    assistantText: 'This should show up as dream backlog pressure.',
    ingestMode: 'raw_then_dream',
  });

  const tick = kernel.runMaintenanceTick({ projectId: 'demo' });

  expect(tick.projectId).toBe('demo');
  expect(tick.hostOwned).toBe(true);
  expect(tick.executed.hiddenDaemonStarted).toBe(false);
  expect(tick.chargeVector.dreamBacklog).toBeGreaterThan(0);
  expect(tick.suggestedActions.some((action) => action.command.includes('cogmem memory dream'))).toBe(true);

  kernel.close();
});

test('memory CLI and MCP expose map, tick, and collection routing', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-memory-map-tick-cli-'));
  const configPath = join(dir, '.cogmem', 'config.toml');
  mkdirSync(join(dir, '.cogmem'), { recursive: true });
  writeFileSync(configPath, '[core]\ndb_path = "memory.db"\nvector_backend = "sqlite-vec"\n');

  const dbPath = join(dir, '.cogmem', 'memory.db');
  const kernel = createMemoryKernel({ dbPath, vectorBackend: 'sqlite-vec' });
  const backend = new KernelAgentMemoryBackend(kernel);
  await backend.rememberTurnWithResult({
    agentId: 'openclaw',
    projectId: 'demo',
    sessionId: 'session-cli',
    collection: 'theseus',
    userText: 'Theseus artifact: MoneyPrinterTurbo visual storyboard.',
    assistantText: 'Creative artifact stored outside default recall.',
    ingestMode: 'raw_archive_only',
  });
  kernel.close();

  const mapProc = Bun.spawn({
    cmd: ['bun', memoryBin, 'map', '--config', configPath, '--project', 'demo', '--json'],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const mapOutput = await new Response(mapProc.stdout).text();
  const mapError = await new Response(mapProc.stderr).text();
  expect(await mapProc.exited).toBe(0);
  expect(mapError).toBe('');
  expect(JSON.parse(mapOutput).manual.commands).toContain('cogmem memory tick --project <id> --json');

  const tickProc = Bun.spawn({
    cmd: ['bun', memoryBin, 'tick', '--config', configPath, '--project', 'demo', '--json'],
    cwd: coreRoot,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const tickOutput = await new Response(tickProc.stdout).text();
  const tickError = await new Response(tickProc.stderr).text();
  expect(await tickProc.exited).toBe(0);
  expect(tickError).toBe('');
  expect(JSON.parse(tickOutput).hostOwned).toBe(true);

  const defaultRecall = await callCogmemMcpTool('cogmem_recall', {
    agentId: 'openclaw',
    projectId: 'demo',
    query: 'MoneyPrinterTurbo storyboard',
    limit: 5,
  }, { dbPath });
  const collectionRecall = await callCogmemMcpTool('cogmem_recall', {
    agentId: 'openclaw',
    projectId: 'demo',
    collection: 'theseus',
    query: 'MoneyPrinterTurbo storyboard',
    limit: 5,
  }, { dbPath });

  expect(JSON.stringify(defaultRecall.structuredContent)).not.toContain('visual storyboard');
  expect(JSON.stringify(collectionRecall.structuredContent)).toContain('visual storyboard');
});
