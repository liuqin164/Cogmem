import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ChecksumError,
  DimensionMismatchError,
  KernelRunningError,
  SnapshotImporter,
  createMemoryKernel,
} from '../src/public.js';
import { makeTempDir } from './helpers/tmp.js';

function tempDir(): string {
  const dir = makeTempDir('core-snapshot-');
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readSnapshotHeader(snapshotPath: string): { header: any; dbBytes: Buffer } {
  const bytes = readFileSync(snapshotPath);
  const headerLength = bytes.readUInt32LE(0);
  const header = JSON.parse(bytes.subarray(4, 4 + headerLength).toString('utf8'));
  return { header, dbBytes: bytes.subarray(4 + headerLength) };
}

function rewriteSnapshotHeader(snapshotPath: string, patch: Record<string, unknown>): void {
  const { header, dbBytes } = readSnapshotHeader(snapshotPath);
  const nextHeader = Buffer.from(JSON.stringify({ ...header, ...patch }), 'utf8');
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(nextHeader.length, 0);
  writeFileSync(snapshotPath, Buffer.concat([prefix, nextHeader, dbBytes]));
}

describe('MemorySnapshot v1.9.7', () => {
  test('exportSnapshot writes a checksummed header and import restores recallable memory', async () => {
    const dir = tempDir();
    const sourceDb = join(dir, 'source.db');
    const targetDb = join(dir, 'target.db');
    const snapshotPath = join(dir, 'memory.snap');
    const source = createMemoryKernel({ dbPath: sourceDb });

    await source.ingest({
      projectId: 'snapshot-user',
      content: 'Snapshot test memory: Qwen embedding config lives in the memory kernel.',
      sourceType: 'chat',
    });
    const meta = await source.exportSnapshot(snapshotPath);
    source.close();

    expect(existsSync(snapshotPath)).toBe(true);
    expect(meta.header.version).toBe(1);
    expect(meta.header.schemaVersion).toBeGreaterThanOrEqual(11);
    expect(meta.header.neuronCount).toBe(1);
    expect(meta.header.checksum).toMatch(/^[a-f0-9]{64}$/);

    const dryRun = await new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension })
      .import(snapshotPath, targetDb, { dryRun: true });
    expect(dryRun.skipped).toBe(true);
    expect(existsSync(targetDb)).toBe(false);

    await new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension })
      .import(snapshotPath, targetDb);
    const restored = createMemoryKernel({ dbPath: targetDb });
    const recall = restored.evidenceFor('Qwen embedding config', { projectId: 'snapshot-user', limit: 5 });

    expect(recall.rawEvidence.some((item) => item.content.includes('Qwen embedding config'))).toBe(true);
    restored.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('snapshot export and import preserve chronological ledger replay order', async () => {
    const dir = tempDir();
    const sourceDb = join(dir, 'source-ledger.db');
    const targetDb = join(dir, 'target-ledger.db');
    const snapshotPath = join(dir, 'ledger.snap');
    const source = createMemoryKernel({ dbPath: sourceDb });

    source.recordRawEvent({
      projectId: 'snapshot-ledger',
      threadId: 'thread-snapshot',
      sessionId: 'session-snapshot',
      turnId: 'turn-1',
      turnSeq: 1,
      role: 'user',
      content: 'first raw ledger event',
      eventOrdinal: 1,
      occurredAt: 1_700_000_000_000,
    });
    source.recordRawEvent({
      projectId: 'snapshot-ledger',
      threadId: 'thread-snapshot',
      sessionId: 'session-snapshot',
      turnId: 'turn-1',
      turnSeq: 1,
      role: 'assistant',
      content: 'second raw ledger event',
      eventOrdinal: 2,
      occurredAt: 1_700_000_000_000,
    });

    const meta = await source.exportSnapshot(snapshotPath);
    source.close();

    await new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension })
      .import(snapshotPath, targetDb);
    const restored = createMemoryKernel({ dbPath: targetDb });
    const replay = restored.getThreadEvents('thread-snapshot');

    expect(replay.map((event) => event.payload.text)).toEqual([
      'first raw ledger event',
      'second raw ledger event',
    ]);
    expect(replay.map((event) => event.threadSeq)).toEqual([1, 2]);
    expect(replay.map((event) => event.eventOrdinal)).toEqual([1, 2]);
    expect(replay.map((event) => event.globalSeq)).toEqual([1, 2]);
    restored.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test('import rejects embedding dimension mismatches with expected and actual values', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'source.db');
    const snapshotPath = join(dir, 'memory.snap');
    const targetDb = join(dir, 'target.db');
    const kernel = createMemoryKernel({ dbPath });

    await kernel.ingest({ projectId: 'p', content: 'dimension mismatch source memory' });
    const meta = await kernel.exportSnapshot(snapshotPath);
    kernel.close();
    rewriteSnapshotHeader(snapshotPath, { embeddingDimension: meta.header.embeddingDimension + 1 });

    await expect(new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension })
      .import(snapshotPath, targetDb)).rejects.toThrow(DimensionMismatchError);
    try {
      await new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension }).import(snapshotPath, targetDb);
    } catch (error) {
      expect(error).toBeInstanceOf(DimensionMismatchError);
      expect((error as DimensionMismatchError).expected).toBe(meta.header.embeddingDimension);
      expect((error as DimensionMismatchError).actual).toBe(meta.header.embeddingDimension + 1);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('import rejects snapshots whose sqlite payload checksum was tampered with', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'source.db');
    const snapshotPath = join(dir, 'memory.snap');
    const targetDb = join(dir, 'target.db');
    const kernel = createMemoryKernel({ dbPath });

    await kernel.ingest({ projectId: 'p', content: 'checksum source memory' });
    const meta = await kernel.exportSnapshot(snapshotPath);
    kernel.close();
    const bytes = readFileSync(snapshotPath);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] ^ 0xff;
    writeFileSync(snapshotPath, bytes);

    await expect(new SnapshotImporter({ expectedEmbeddingDimension: meta.header.embeddingDimension })
      .import(snapshotPath, targetDb)).rejects.toThrow(ChecksumError);
    rmSync(dir, { recursive: true, force: true });
  });

  test('started kernels reject importSnapshot to avoid replacing a live sqlite file', async () => {
    const dir = tempDir();
    const dbPath = join(dir, 'source.db');
    const snapshotPath = join(dir, 'memory.snap');
    const targetKernel = createMemoryKernel({ dbPath: join(dir, 'target.db') });
    const source = createMemoryKernel({ dbPath });

    await source.ingest({ projectId: 'p', content: 'running kernel import source' });
    await source.exportSnapshot(snapshotPath);
    source.close();
    await targetKernel.start();

    await expect(targetKernel.importSnapshot(snapshotPath, { overwrite: true })).rejects.toThrow(KernelRunningError);
    targetKernel.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
