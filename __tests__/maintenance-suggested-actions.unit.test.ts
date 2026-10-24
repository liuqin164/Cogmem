import { describe, expect, test } from 'bun:test';
import Database from 'bun:sqlite';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createMemoryKernel } from '../src/factory.js';

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const reEmbedBin = join(coreRoot, 'src/bin/re-embed.ts');
const cogmemBin = join(coreRoot, 'src/bin/cogmem.ts');

class FakeEmbeddingProvider {
  modelId = 'model/new';
  dimensions = 2;
  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([1, 1]));
  }
  async embed(text: string): Promise<Float32Array> {
    return new Float32Array([1, 1]);
  }
}

// The tick only reports stale embeddings when the host supplied a provider, because
// only then does a different model id mean "the vectors are behind".
function staleVectorFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cogmem-suggested-actions-'));
  const dbPath = join(dir, 'memory.db');
  const kernel = createMemoryKernel({
    dbPath,
    projectTimeZone: 'Asia/Tokyo',
    embeddingProvider: new FakeEmbeddingProvider() as never,
  });
  const db = new Database(dbPath);
  db.exec([
    'INSERT INTO neuron_embeddings',
    '(neuron_id, model_id, vector_blob, dimensions, project_id, status, updated_at)',
    "VALUES ('n1', 'model/old', x'00000000', 1, 'p', 'pending', 1)",
  ].join(' '));
  db.close();
  return { kernel, dbPath };
}

describe('maintenance tick suggested actions point at commands that run', () => {
  test('the stale-embedding action names the executable status command, not a run subcommand', () => {
    const { kernel, dbPath } = staleVectorFixture();
    try {
      const tick = kernel.runMaintenanceTick({ projectId: 'p' });
      expect(tick.chargeVector.staleVectors).toBe(1);
      const action = tick.suggestedActions.find((item) => item.kind === 're_embed');
      expect(action).toBeDefined();
      expect(action?.executable).toBe('cogmem-re-embed');
      expect(action?.args).toEqual(['status']);
      expect(action?.command).toBe('cogmem-re-embed status');
      // The command cannot re-embed on its own; the reason has to name the real path.
      expect(action?.reason).toContain('ReEmbeddingPipeline.run()');
      expect(action?.command).not.toContain(' run');
      // The db the tick ran against stays readable by that command.
      const probe = Bun.spawnSync({
        cmd: ['bun', reEmbedBin, 'status', '--db', dbPath],
        cwd: coreRoot,
        stdout: 'pipe',
        stderr: 'pipe',
      });
      expect(probe.exitCode).toBe(0);
      expect(JSON.parse(new TextDecoder().decode(probe.stdout)).command).toBe('re-embed.status');
    } finally {
      kernel.close();
    }
  });

  test('cogmem-re-embed rejects the retired run subcommand and names the one it supports', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cogmem-reembed-usage-'));
    const dbPath = join(dir, 'memory.db');
    const run = Bun.spawnSync({
      cmd: ['bun', reEmbedBin, 'run', '--project', 'p', '--db', dbPath],
      cwd: coreRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(run.exitCode).toBe(1);
    const stderr = new TextDecoder().decode(run.stderr);
    expect(stderr).toContain('cogmem-re-embed status');
    expect(stderr).not.toContain('run');
  });

  test('every suggested action names an executable that exists as a bin', () => {
    const packageJson = JSON.parse(readFileSync(join(coreRoot, 'package.json'), 'utf8')) as {
      bin: Record<string, string>;
    };
    const known = new Set(['cogmem', ...Object.keys(packageJson.bin)]);
    const source = readFileSync(join(coreRoot, 'src/factory.ts'), 'utf8');
    const callSites = [...source.matchAll(/suggestedAction\(\s*'([a-z_]+)',\s*'([^']+)'/g)].map((match) => ({
      kind: match[1],
      executable: match[2],
    }));
    // Eight kinds can be emitted; a silent drop to fewer means the scan lost the call sites.
    expect(callSites.length).toBeGreaterThanOrEqual(8);
    const unknown = callSites.filter((site) => !known.has(site.executable));
    expect(unknown).toEqual([]);
  });

  test('cogmem --help does not promise a CLI re-embed run', () => {
    const help = Bun.spawnSync({
      cmd: ['bun', cogmemBin, '--help'],
      cwd: coreRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const text = new TextDecoder().decode(help.stdout) + new TextDecoder().decode(help.stderr);
    expect(text).toContain('inspect re-embedding progress');
    expect(text).not.toContain('or run re-embedding');
  });
});
